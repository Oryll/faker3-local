#!/usr/bin/env node
/**
 * get-cookie.mjs —— 自动获取京东 Cookie 并写入 .env
 *
 * 背景（2026-10 起）：京东网页版登录不再下发传统的 pt_key / pt_pin，
 * 而是改用 pin / thor / light_key / sdtoken 这一整套新 cookie。
 * faker3 的脚本本身只要求「请求里带上登录 cookie」，实测整套新 cookie 可以正常取数
 * （jd_CheckCK.js 例外，它按老格式判定，会误报「已失效」）。
 *
 * 本脚本的做法：
 *   1. 用项目内的独立浏览器配置目录 .jd-profile 启动 Edge（不碰你日常用的浏览器配置）；
 *   2. 打开京东首页 —— 如果这个配置里已登录，直接读 cookie；
 *      如果没登录，会自动打开登录页，你用京东 App 扫码（或账号密码）登录一次即可；
 *   3. 通过 CDP(Network.getAllCookies) 读出 HttpOnly cookie 的明文值；
 *   4. 拼成 JD_COOKIE=... 写进 .env（保留 .env 里其它配置），并追加 pt_pin=<你的pin>; 兼容脚本。
 *
 * 用法：
 *   node tools/get-cookie.mjs               直接执行（默认等 300 秒）
 *   node tools/get-cookie.mjs --wait 600    最多等 600 秒
 *   node tools/get-cookie.mjs --keep        抓完不关闭浏览器
 *   node tools/get-cookie.mjs --print       只打印 cookie 串，不写 .env
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const PROFILE_DIR = path.join(ROOT, '.jd-profile');
const ENV_FILE = path.join(ROOT, '.env');
const PORT = Number(process.env.JD_CDP_PORT || 9222);
const HOME_URL = 'https://www.jd.com/';
const LOGIN_URL = 'https://passport.jd.com/new/login.aspx';

const argv = process.argv.slice(2);
const argVal = (name, def) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : def;
};
const WAIT_SECONDS = Number(argVal('--wait', 300));
const KEEP_OPEN = argv.includes('--keep');
const PRINT_ONLY = argv.includes('--print');
const HEADLESS = argv.includes('--headless');

const C = {
  reset: '\x1b[0m', dim: '\x1b[2m', red: '\x1b[31m', green: '\x1b[32m',
  yellow: '\x1b[33m', blue: '\x1b[36m',
};
const log = (...a) => console.log(...a);
const ok = (...a) => log(`${C.green}✓${C.reset}`, ...a);
const warn = (...a) => log(`${C.yellow}!${C.reset}`, ...a);
const bad = (...a) => log(`${C.red}✗${C.reset}`, ...a);

function findEdge() {
  const cands = [
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    path.join(process.env.LOCALAPPDATA || '', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
  ];
  return cands.find((p) => p && fs.existsSync(p));
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function cdpAvailable() {
  try {
    const r = await fetch(`http://127.0.0.1:${PORT}/json/version`);
    return r.ok ? await r.json() : null;
  } catch {
    return null;
  }
}

class Cdp {
  constructor(wsUrl) {
    this.ws = new WebSocket(wsUrl);
    this.seq = 0;
    this.pending = new Map();
    this.closed = false;
    this.ws.addEventListener('message', (ev) => {
      let m;
      try { m = JSON.parse(ev.data); } catch { return; }
      if (m.id && this.pending.has(m.id)) {
        const { resolve, reject } = this.pending.get(m.id);
        this.pending.delete(m.id);
        m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result);
      }
    });
    this.ws.addEventListener('close', () => { this.closed = true; });
  }
  ready() {
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('CDP websocket timeout')), 8000);
      this.ws.addEventListener('open', () => { clearTimeout(t); resolve(); }, { once: true });
    });
  }
  send(method, params = {}, sessionId) {
    return new Promise((resolve, reject) => {
      if (this.closed) return reject(new Error('CDP websocket closed'));
      const id = ++this.seq;
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`CDP ${method} timeout`));
        }
      }, 20000);
    });
  }
  close() { try { this.ws.close(); } catch {} }
}

const AUTH_MIN = (cookies) => {
  const pin = cookies.find((c) => c.name === 'pin' || c.name === 'pt_pin');
  const token = cookies.find((c) => ['thor', 'light_key', 'pt_key'].includes(c.name));
  return pin && token ? pin.value : null;
};

function dumpCookieLine(cookies) {
  // 一次请求到 www.jd.com 会带上的域名集合
  const domains = new Set(['.jd.com', 'www.jd.com', 'passport.jd.com', '.www.jd.com', 'order.jd.com', '.order.jd.com']);
  const picked = cookies.filter((c) => domains.has(c.domain));
  const byName = new Map();
  for (const c of picked) {
    const prev = byName.get(c.name);
    if (!prev || (c.domain === '.jd.com' && prev.domain !== '.jd.com')) byName.set(c.name, c);
  }
  const items = [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
  let line = items.map((c) => `${c.name}=${c.value}`).join('; ') + ';';
  const pin = byName.get('pin')?.value || byName.get('pt_pin')?.value || '';
  if (pin && !/pt_pin=/.test(line)) line += ` pt_pin=${pin};`;
  return { line, count: items.length, pin };
}

function writeEnv(line) {
  const header = [
    '# 由 tools/get-cookie.mjs 自动生成 / 更新；JD_COOKIE 之外的自定义配置会保留。',
    '# 说明：2026 起京东网页登录不再下发 pt_key，这里保存的是整套新 cookie（pin/thor/light_key/sdtoken…）',
    '#       末尾追加的 pt_pin=... 只为兼容脚本里对账号名的解析，不影响鉴权。',
  ];
  let kept = [];
  if (fs.existsSync(ENV_FILE)) {
    kept = fs.readFileSync(ENV_FILE, 'utf8')
      .split(/\r?\n/)
      .filter((l) => !/^\s*JD_COOKIE\s*=/.test(l) && !/^\s*#\s*(由 tools\/get-cookie|说明：2026 起京东网页登录|末尾追加的 pt_pin)/.test(l));
  }
  const body = [...header, '', `JD_COOKIE=${line}`, '', ...kept].join('\n');
  fs.writeFileSync(ENV_FILE, body.endsWith('\n') ? body : body + '\n', 'utf8');
}

async function main() {
  const edge = findEdge();
  if (!edge) {
    bad('没找到 Microsoft Edge（msedge.exe）。请先安装 Edge，或手动按 LOCAL-README 第 9 节的办法取 cookie。');
    process.exit(2);
  }
  fs.mkdirSync(PROFILE_DIR, { recursive: true });

  let version = await cdpAvailable();
  let browserProc = null;
  if (version) {
    warn(`端口 ${PORT} 上已有 Edge 可用，直接复用。`);
  } else {
    const args = [
      `--user-data-dir=${PROFILE_DIR}`,
      `--remote-debugging-port=${PORT}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-features=msEdgeSidebarV2',
      ...(HEADLESS ? ['--headless=new', '--disable-gpu'] : []),
      'about:blank',
    ];
    log(`${C.dim}启动 Edge（独立配置：.jd-profile），调试端口 ${PORT}…${C.reset}`);
    browserProc = spawn(edge, args, { stdio: 'ignore', windowsHide: HEADLESS });
    browserProc.on('error', (e) => bad(`启动 Edge 失败：${e.message}`));
    for (let i = 0; i < 60 && !version; i++) {
      await sleep(500);
      version = await cdpAvailable();
    }
  }
  if (!version) {
    bad('Edge 调试端口没有起来。请关掉所有 Edge 窗口后重试。');
    process.exit(2);
  }
  ok(`浏览器就绪：${version.Browser}`);

  const cdp = new Cdp(version.webSocketDebuggerUrl);
  await cdp.ready();

  const { targetId } = await cdp.send('Target.createTarget', { url: HOME_URL });
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
  await cdp.send('Network.enable', {}, sessionId);

  const readCookies = async () => (await cdp.send('Network.getAllCookies', {}, sessionId)).cookies;
  const started = Date.now();
  let loginTabOpened = false;
  let lastHint = 0;

  for (;;) {
    const elapsed = Math.round((Date.now() - started) / 1000);
    let cookies = [];
    try { cookies = await readCookies(); } catch (e) { warn(`读取 cookie 失败：${e.message}`); }
    const pin = AUTH_MIN(cookies.filter((c) => c.domain.includes('jd.com')));

    if (pin) {
      const { line, count } = dumpCookieLine(cookies);
      log('');
      ok(`已登录：pin=${pin}`);
      ok(`抓到 ${count} 条 .jd.com cookie，拼成 JD_COOKIE（长度 ${line.length}）`);
      if (PRINT_ONLY) {
        log('');
        log(line);
      } else {
        writeEnv(line);
        ok(`已写入 ${ENV_FILE}`);
        log(`  下一步： check-cookie.cmd 或 daily.cmd（.env 已生效）`);
      }
      if (!KEEP_OPEN) {
        await cdp.send('Browser.close').catch(() => {});
        try { cdp.close(); } catch {}
        await sleep(800);
      } else {
        warn('已保留浏览器不关闭（--keep）。');
      }
      process.exit(0);
    }

    if (!loginTabOpened && Date.now() - started > 5000) {
      loginTabOpened = true;
      await cdp.send('Target.createTarget', { url: LOGIN_URL }).catch(() => {});
      log('');
      warn('这个配置目录里还没有京东登录态，已打开登录页：');
      log(`  请在弹出的 Edge 窗口里用 ${C.blue}京东 App 扫码${C.reset}，或点「账号登录」用账号密码/短信登录。`);
      log(`  ${C.dim}登录成功后我会自动抓取（这个窗口只是专用配置，不影响你平时用的浏览器）${C.reset}`);
    }
    if (Date.now() - started - lastHint > 30000 && loginTabOpened) {
      lastHint = Date.now() - started;
      log(`${C.dim}… 等待扫码/登录中（已等 ${elapsed} 秒 / 上限 ${WAIT_SECONDS} 秒）${C.reset}`);
    }
    if (Date.now() - started > WAIT_SECONDS * 1000) {
      bad(`等待超时（${WAIT_SECONDS} 秒），没有检测到登录态。`);
      log('  可重试： get-cookie.cmd --wait 600');
      log('  也可以按 LOCAL-README 第 9 节手动从 DevTools 复制整串 cookie 填进 .env');
      if (!KEEP_OPEN) await cdp.send('Browser.close').catch(() => {});
      process.exit(2);
    }
    await sleep(2500);
  }
}

main().catch((e) => {
  bad(`出错了：${e && e.stack ? e.stack : e}`);
  process.exit(1);
});
