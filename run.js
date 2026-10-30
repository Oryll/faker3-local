#!/usr/bin/env node
/**
 * faker3 本地运行器（非青龙环境）
 *
 * 用法：
 *   node run.js --list                     列出所有脚本（含中文名）与分组
 *   node run.js --group daily              跑「每日」组
 *   node run.js --group daily --dry-run    只打印将要执行什么，不真跑
 *   node run.js jd_bean_change.js           跑单个脚本
 *   node run.js jd_bean_change.js jd_ttgd.js
 *   node run.js --group daily --gap 10 --timeout 300
 *
 * 规则：
 *   - .env 由本运行器读取（jdCookie.js 本身只读 process.env，不会自动加载 .env）
 *   - .env 中的变量不会覆盖已存在的系统环境变量（系统环境变量优先）
 *   - 每个脚本独立子进程执行，记录耗时/退出码，日志写入 logs/
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

const ROOT = __dirname;
const ENV_FILE = path.join(ROOT, '.env');
const CONFIG_FILE = path.join(ROOT, 'scripts.json');
const LOG_DIR = path.join(ROOT, 'logs');

// ---------- 参数 ----------
function parseArgs(argv) {
  const opts = {
    group: null,
    scripts: [],
    list: false,
    dryRun: false,
    gap: null,
    timeout: null,
    stopOnError: false,
    compat: true, // 默认开启兼容层（tools/compat-shim.cjs），可用 --no-compat 关闭
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--list' || a === '-l') opts.list = true;
    else if (a === '--dry-run') opts.dryRun = true;
    else if (a === '--stop-on-error') opts.stopOnError = true;
    else if (a === '--no-compat') opts.compat = false;
    else if (a === '--group' || a === '-g') opts.group = argv[++i];
    else if (a === '--gap') opts.gap = Number(argv[++i]);
    else if (a === '--timeout') opts.timeout = Number(argv[++i]);
    else if (a === '--help' || a === '-h') opts.help = true;
    else if (a.startsWith('-')) {
      console.error(`未知参数: ${a}`);
      process.exit(2);
    } else opts.scripts.push(a);
  }
  return opts;
}

function help() {
  console.log(`
faker3 本地运行器

  node run.js --list                        列出脚本与分组
  node run.js <脚本.js> [...]               运行指定脚本（可多个）
  node run.js --group <组名>                运行整组（daily / weekly / extra / help / stale / tools / all）
  node run.js --group daily --dry-run       预览，不执行

可选参数：
  --gap <秒>          脚本之间的间隔，默认取 scripts.json
  --timeout <秒>      单个脚本超时，超时后强制结束，默认取 scripts.json
  --stop-on-error     某个脚本失败后立即停止
  --no-compat         关闭兼容层（默认开启；兼容层作用见 LOCAL-README 第 9 节）
`);
}

// ---------- .env ----------
function loadEnv() {
  if (!fs.existsSync(ENV_FILE)) return false;
  const text = fs.readFileSync(ENV_FILE, 'utf8');
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    // 支持用字面量 \n 表示多账号换行
    val = val.replace(/\\n/g, '\n');
    if (!Object.prototype.hasOwnProperty.call(process.env, key)) process.env[key] = val;
  }
  return true;
}

function cookieState() {
  const ck = process.env.JD_COOKIE || '';
  if (!ck.trim()) return { ok: false, reason: '未设置 JD_COOKIE' };
  // 老格式：pt_key + pt_pin（2026 年之前京东网页登录下发）
  const legacy = /pt_key=/.test(ck) && /pt_pin=/.test(ck);
  // 新格式：pin / thor / light_key / sdtoken 整套 cookie（2026 年起京东网页登录不再下发 pt_key）
  const fresh = /(?:^|[;\s])pin=/.test(ck) && /(?:thor|light_key)=/.test(ck);
  if (!legacy && !fresh) {
    return { ok: false, reason: 'JD_COOKIE 格式不认识：既没有 pt_key/pt_pin，也不像 pin+thor 的新版 cookie；建议用 get-cookie.cmd 自动获取' };
  }
  if (!legacy && !/pt_pin=/.test(ck)) {
    return {
      ok: false,
      reason: '新版 cookie 还需要补一段 pt_pin=<你的pin>;（get-cookie.cmd 会自动补；原因见 LOCAL-README 第 9 节）',
    };
  }
  const parts = ck.split(/[&\n]/).filter((s) => s.trim());
  return { ok: true, accounts: parts.length, legacy };
}

// ---------- 配置 ----------
const DEFAULT_CONFIG = {
  settings: { gapSeconds: 6, timeoutSeconds: 240 },
  groups: {
    daily: [
      'jd_bean_change.js',
      'jd_daka_bean.js',
      'jd_signbeanact_.js',
      'jd_bean_home.js',
      'jd_plantBean.js',
      'jd_plantBean_friend.js',
      'jd_fruit_new.js',
      'jd_water_new.js',
      'jd_newfarmlottery.js',
      'jd_AutoEval.js',
      'jd_mall.js',
      'jd_ttgd.js',
      'jd_qy_sign.js',
    ],
    weekly: ['jd_clean_coupon.js'],
    extra: [
      'jd_jrttlqy.js',
      'jd_pkabeans.js',
      'jd_jrddzjd.js',
      'jd_hdyxzd.js',
      'jd_weGameLottery.js',
      'jd_superRedBagDraw.js',
      'jd_lmdraw.js',
      'jd_sldraw.js',
      'jd_ifdraw.js',
      'jd_luckyDraw.js',
      'jd_xqmh.js',
      'jd_vu50.js',
      'jd_wduoyu.js',
      'jd_jingpai.js',
      'jd_rankVote.js',
      'jd_joypark_leave.js',
      'jd_dpqd_sign.js',
      'jd_dwapp.js',
      'jd_OnceApply.js',
      'jd_hssign.js',
      'jd_yssign.js',
      'jd_zjindan.js',
      'jd_ksjsb.js',
    ],
    help: [
      'jd_farmnew_ck_help.js',
      'jd_farmnew_code_help.js',
      'jd_fish_help.js',
      'jd_plantBean_help.js',
      'jd_sx_help.js',
    ],
    stale: [
      'jd_dplh0408.js',
      'jd_dplh0420.js',
      'jd_dplh0509.js',
      'jd_dplh0523.js',
      'jd_dplh0609.js',
      'jd_lhgz0408.js',
    ],
    tools: ['jd_indeps.js', 'jd_autock.js', 'jd_proxy_check.js'],
    // 需要额外服务/参数的脚本：jd_try.js 需要 H5ST_SERVER
    special: ['jd_try.js'],
  },
};

function loadConfig() {
  if (!fs.existsSync(CONFIG_FILE)) return DEFAULT_CONFIG;
  try {
    const user = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
    const cfg = {
      settings: Object.assign({}, DEFAULT_CONFIG.settings, user.settings || {}),
      groups: {},
    };
    for (const [k, v] of Object.entries(DEFAULT_CONFIG.groups)) {
      cfg.groups[k] = Array.isArray(user.groups && user.groups[k]) ? user.groups[k] : v;
    }
    for (const [k, v] of Object.entries((user && user.groups) || {})) {
      if (!cfg.groups[k] && Array.isArray(v)) cfg.groups[k] = v;
    }
    return cfg;
  } catch (e) {
    console.error(`[warn] scripts.json 解析失败，使用内置配置: ${e.message}`);
    return DEFAULT_CONFIG;
  }
}

function readTitles() {
  const titles = {};
  for (const f of fs.readdirSync(ROOT)) {
    if (!/^jd_.+\.js$/.test(f)) continue;
    try {
      const head = fs.readFileSync(path.join(ROOT, f), 'utf8').slice(0, 6000);
      const m = head.match(/new Env\(\s*["']([^"']{1,40})["']\s*\)/);
      if (m) titles[f] = m[1];
    } catch (_) {}
  }
  return titles;
}

function resolveScripts(opts, cfg) {
  if (opts.scripts.length) return opts.scripts;
  if (!opts.group) return [];
  if (opts.group === 'all') {
    const out = [];
    for (const g of ['daily', 'weekly', 'extra']) out.push(...(cfg.groups[g] || []));
    return [...new Set(out)];
  }
  const list = cfg.groups[opts.group];
  if (!list) {
    console.error(`没有名为 "${opts.group}" 的分组。可用分组: ${Object.keys(cfg.groups).join(', ')}, all`);
    process.exit(2);
  }
  return list;
}

// ---------- 执行 ----------
const COMPAT_SHIM = path.join(ROOT, 'tools', 'compat-shim.cjs');

function runOne(file, timeoutSeconds, compat) {
  return new Promise((resolve) => {
    const abs = path.join(ROOT, file);
    if (!fs.existsSync(abs)) {
      return resolve({ file, code: -1, ms: 0, logLine: '文件不存在', missing: true });
    }
    const t0 = Date.now();
    const useCompat = compat !== false && fs.existsSync(COMPAT_SHIM);
    const nodeArgs = useCompat ? ['--require', COMPAT_SHIM, abs] : [abs];
    const child = spawn(process.execPath, nodeArgs, {
      cwd: ROOT,
      env: process.env,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let tail = '';
    const keep = (chunk) => {
      tail = (tail + chunk.toString('utf8')).slice(-4000);
    };
    child.stdout.on('data', (d) => {
      keep(d);
      process.stdout.write(d);
    });
    child.stderr.on('data', (d) => {
      keep(d);
      process.stderr.write(d);
    });
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      try {
        spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true });
      } catch (_) {
        child.kill('SIGKILL');
      }
    }, timeoutSeconds * 1000);

    child.on('close', (code) => {
      clearTimeout(timer);
      const lines = tail.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
      resolve({
        file,
        code: timedOut ? 124 : code === null ? 1 : code,
        ms: Date.now() - t0,
        timedOut,
        logLine: timedOut ? `超时 ${timeoutSeconds}s 被强制结束` : lines[lines.length - 1] || '',
      });
    });
  });
}

function fmtMs(ms) {
  return `${(ms / 1000).toFixed(1)}s`;
}

const MARK = { ok: '✓', fail: '✗', skip: '-' };

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) return help();

  const cfg = loadConfig();
  const titles = readTitles();
  const envLoaded = loadEnv();
  const dryRun = opts.dryRun || opts.list;

  if (opts.list) {
    console.log(`工作目录: ${ROOT}`);
    console.log(`Node: ${process.version}    .env: ${envLoaded ? '已加载' : '不存在'}`);
    console.log('\n分组：');
    for (const [g, files] of Object.entries(cfg.groups)) {
      if (g === 'all') continue;
      console.log(`  ${g} (${files.length} 个)`);
      for (const f of files) {
        const exists = fs.existsSync(path.join(ROOT, f)) ? ' ' : ' (缺失)';
        console.log(`      ${f.padEnd(28)} ${titles[f] || ''}${exists}`);
      }
    }
    console.log('\n用法: node run.js --group daily');
    return;
  }

  const files = resolveScripts(opts, cfg);
  const gap = Number.isFinite(opts.gap) ? opts.gap : cfg.settings.gapSeconds;
  const timeout = Number.isFinite(opts.timeout) ? opts.timeout : cfg.settings.timeoutSeconds;

  if (!files.length) {
    help();
    process.exit(2);
  }

  const ck = cookieState();
  console.log('='.repeat(60));
  console.log(`faker3 本地运行   Node ${process.version}   普通环境（非青龙）`);
  console.log(`工作目录: ${ROOT}`);
  console.log(`脚本数: ${files.length}   间隔: ${gap}s   单脚本超时: ${timeout}s`);
  console.log(`Cookie: ${ck.ok ? `已配置 ${ck.accounts} 个账号` : `未配置（${ck.reason}）`}`);
  console.log(`.env: ${envLoaded ? '已加载' : '不存在，使用系统环境变量'}`);
  const compatOn = opts.compat !== false && fs.existsSync(COMPAT_SHIM);
  console.log(`兼容层: ${compatOn ? '开启（tools/compat-shim.cjs，让新 cookie 通过旧版 CK 检测）' : '关闭'}`);
  console.log('='.repeat(60));

  if (!ck.ok) {
    console.error(`
[错误] 没有可用的 JD_COOKIE，脚本跑起来也只会报 401/403。

处理方式（推荐第 0 种）：
  0) 直接双击运行 get-cookie.cmd（会自动开一个专用 Edge 窗口让你扫码登录，
     然后把整套 cookie 写进 .env；这是 2026 年之后最省事的办法）
  1) 手工新建 .env，写入一行（参考 .env.example）：
       老格式（旧账号可能还有）： JD_COOKIE=pt_key=AAJxxxx; pt_pin=jd_xxxx;
       新格式（现在京东网页登录只给这套）：JD_COOKIE=pin=jd_xxxx; thor=...; light_key=...; ...; pt_pin=jd_xxxx;
     多个账号用 & 连接，或写成字面量 \\n 分隔
  2) 在 PowerShell 里临时设置：
       $env:JD_COOKIE='...'
     （注意：这样设置后运行器会自动读到，不需要 .env）
  3) 直接编辑 jdCookie.js 顶部 CookieJDs 数组
`);
    process.exit(2);
  }

  if (dryRun) {
    console.log('\n[dry-run] 将要按顺序执行：');
    files.forEach((f, i) => console.log(`  ${i + 1}. ${f.padEnd(28)} ${titles[f] || ''}`));
    return;
  }

  fs.mkdirSync(LOG_DIR, { recursive: true });
  const logFile = path.join(LOG_DIR, `run-${new Date().toISOString().slice(0, 10)}.log`);
  const results = [];
  const startedAll = Date.now();

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const t0 = Date.now();
    console.log(`\n──────── [${i + 1}/${files.length}] ${file} ${titles[file] || ''} ────────`);
    const r = await runOne(file, timeout, opts.compat);
    results.push(r);
    const line = `[${new Date().toISOString()}] ${r.code === 0 ? 'OK' : 'FAIL'} ${file} ${fmtMs(r.ms)} ${r.logLine}`;
    fs.appendFileSync(logFile, line + '\n');
    console.log(`${MARK[r.code === 0 ? 'ok' : 'fail']} ${file}  ${fmtMs(r.ms)}${r.code === 0 ? '' : `  (exit ${r.code})`}`);
    if (r.code !== 0 && opts.stopOnError) break;
    if (i < files.length - 1 && gap > 0) await new Promise((r2) => setTimeout(r2, gap * 1000));
  }

  const ok = results.filter((r) => r.code === 0).length;
  const failed = results.filter((r) => r.code !== 0);
  console.log('\n' + '='.repeat(60));
  console.log(`完成: ${ok} 成功 / ${failed.length} 失败 / 共 ${results.length} 个，总耗时 ${fmtMs(Date.now() - startedAll)}`);

  if (failed.length) {
    console.log('\n失败脚本：');
    for (const r of failed) console.log(`  ✗ ${r.file}  (exit ${r.code} ${fmtMs(r.ms)})  ${r.logLine}`);
  }
  console.log(`日志: ${logFile}`);
  process.exit(failed.length ? 1 : 0);
}

main().catch((e) => {
  console.error('[fatal]', e && e.stack ? e.stack : e);
  process.exit(1);
});
