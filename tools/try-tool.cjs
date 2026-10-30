/**
 * 京东试用：自动读商品 + 按额度提交申请（本地签名，不需要外挂 H5ST 服务）。
 *
 * 原理：
 *  1) 试用活动页（prodev Babel 页）是服务端渲染的，商品列表直接内嵌在 HTML 的
 *     window.__react_data__ 里（含每个商品的 activityId / sku / supplyNum / applyNum）。
 *     上游 jd_try.js 走的 qryH5BabelFloors 接口对新登录态恒 403，所以这里改成「解析页面」。
 *  2) 提交申请用 api.m.jd.com 的 try_apply 接口（新登录态可用），签名交给本仓库
 *     tools/local-h5st-server.cjs 在本地生成（h5st 3.1）。
 *
 * 用法：
 *   node tools/try-tool.cjs             # 读商品 + 按今日剩余额度申请
 *   node tools/try-tool.cjs --dry-run   # 只看商品/额度，不申请
 *   node tools/try-tool.cjs --force     # 额度为 0 也尝试（用于验证接口链路）
 *   node tools/try-tool.cjs --max 2     # 本次最多申请 2 个
 *   node tools/try-tool.cjs --url <活动页 URL>
 *   node tools/try-tool.cjs --category 手机        # 只申请手机类（按京东类目 cid1=9987 手机通讯）
 *   node tools/try-tool.cjs --keyword 一加,OPPO    # 只申请标题/品牌/店铺含这些词的商品
 *   node tools/try-tool.cjs --cid1 9987,652        # 自定义类目 id 过滤
 *
 * 支持的 --category 名称：手机/phone（cid1=9987 手机通讯）、耳机/audio（652）、
 * 电脑/computer（670）、母婴/baby（1319 的部分 cid2，不精确、建议用 --keyword）、
 * 也可直接写数字 cid1。
 *
 * 环境变量（.env 里的 JD_COOKIE 必须有效；可用 get-cookie.cmd 刷新）：
 *   JD_TRY_TITLEFILTERS  关键词黑白名单，逗号分隔，'-' 前缀表示排除
 *   JD_TRY_CATEGORY      等同于 --category（如 手机）
 *   JD_TRY_KEYWORD       等同于 --keyword
 *   JD_TRY_CID1          等同于 --cid1
 *   JD_TRY_APPLYNUMFILTER 申请人数超过该值就不申请（默认 200000，基本等于不限制）
 *   JD_TRY_GAP           两次申请之间等待秒数（默认 8）
 */
const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const zlib = require('zlib');
const { spawn } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36 Edg/149.0.0.0';
const TRIAL_URL = 'https://prodev.m.jd.com/mall/active/3C751WNneAUaZ8Lw8xYN7cbSE8gm/index.html';
// 京东一级类目 id（cid1）。手机通讯=9987，影音娱乐=652，电脑办公=670，母婴=1319，食品饮料=12259(部分)…
const CATEGORY_PRESETS = {
  手机: ['9987'],
  phone: ['9987'],
  手机通讯: ['9987'],
  耳机: ['652'],
  audio: ['652'],
  电脑: ['670'],
  computer: ['670'],
  母婴: ['1319'],
  baby: ['1319'],
  食品: ['12259'],
  food: ['12259'],
};
const H5ST_PORT = Number(process.env.H5ST_PORT || 9527);
const ENABLE_LOG = true;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- 基础工具 ----------
function log(line) {
  const t = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const stamp = `${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())} ${pad(t.getHours())}:${pad(t.getMinutes())}:${pad(t.getSeconds())}`;
  const text = `[${stamp}] ${line}`;
  console.log(line);
  if (!ENABLE_LOG) return;
  try {
    const dir = path.join(ROOT, 'logs');
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `try-${stamp.slice(0, 10)}.log`);
    fs.appendFileSync(file, text + '\n', 'utf8');
  } catch {}
}

function loadEnv() {
  const envFile = path.join(ROOT, '.env');
  if (!fs.existsSync(envFile)) return;
  const text = fs.readFileSync(envFile, 'utf8');
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if (val.length >= 2 && ((val[0] === '"' && val[val.length - 1] === '"') || (val[0] === "'" && val[val.length - 1] === "'"))) val = val.slice(1, -1);
    val = val.replace(/\\n/g, '\n');
    if (!(key in process.env)) process.env[key] = val;
  }
}

function request(urlStr, { method = 'GET', headers = {}, body = null, timeout = 20000 } = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(urlStr);
    const mod = u.protocol === 'http:' ? http : https;
    const h = { 'user-agent': UA, ...headers };
    if (body != null) h['content-length'] = Buffer.byteLength(body);
    const req = mod.request(
      { hostname: u.hostname, port: u.port || (u.protocol === 'http:' ? 80 : 443), path: u.pathname + u.search, method, headers: h },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          let buf = Buffer.concat(chunks);
          const enc = String(res.headers['content-encoding'] || '').toLowerCase();
          try {
            if (enc === 'gzip') buf = zlib.gunzipSync(buf);
            else if (enc === 'deflate') buf = zlib.inflateSync(buf);
            else if (enc === 'br') buf = zlib.brotliDecompressSync(buf);
          } catch {}
          resolve({ status: res.statusCode, headers: res.headers, body: buf.toString('utf8') });
        });
      },
    );
    req.setTimeout(timeout, () => req.destroy(new Error('timeout')));
    req.on('error', reject);
    if (body != null) req.write(body);
    req.end();
  });
}

// ---------- 页面 HTML -> 商品列表 ----------
function extractReactData(html) {
  const marker = 'window.__react_data__ = ';
  const at = html.indexOf(marker);
  if (at < 0) throw new Error('页面里没找到 __react_data__（活动页结构可能变了）');
  const start = at + marker.length;
  let depth = 0;
  let ins = false;
  let esc = false;
  for (let i = start; i < html.length; i++) {
    const c = html[i];
    if (ins) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') ins = false;
      continue;
    }
    if (c === '"') ins = true;
    else if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) return JSON.parse(html.slice(start, i + 1));
    }
  }
  throw new Error('__react_data__ JSON 不完整');
}

function findFeeds(node, out = []) {
  if (!node || typeof node !== 'object') return out;
  if (Array.isArray(node)) {
    for (const v of node) findFeeds(v, out);
    return out;
  }
  if (node.feedsComponent && Array.isArray(node.feedsComponent.feedList)) out.push(node.feedsComponent);
  for (const v of Object.values(node)) findFeeds(v, out);
  return out;
}

function parseEndTime(s) {
  // "2026-10-30 23:59:59" 按北京时间解析
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec(String(s || ''));
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6])).getTime();
}

function titleMatch(title, filters) {
  if (!filters.length) return true;
  const positives = filters.filter((f) => !f.startsWith('-'));
  const negatives = filters.filter((f) => f.startsWith('-')).map((f) => f.slice(1));
  if (negatives.some((n) => n && title.includes(n))) return false;
  if (!positives.length) return true;
  return positives.some((p) => p && title.includes(p));
}

// 类目名/数字 → cid1 数组；未知名称返回 null（调用方报错提示）
function resolveCid1(names) {
  const ids = [];
  for (const raw of names) {
    const name = String(raw).trim();
    if (!name) continue;
    if (/^\d+$/.test(name)) {
      ids.push(name);
      continue;
    }
    const preset = CATEGORY_PRESETS[name] || CATEGORY_PRESETS[name.toLowerCase()];
    if (!preset) return null;
    ids.push(...preset);
  }
  return ids;
}

// 商品匹配：cid1 命中 + 关键词命中（关键词同时匹配 标题/品牌/店铺）
function itemMatch(item, opts) {
  const { cid1s = [], keywords = [], titleFilters = [] } = opts;
  if (cid1s.length && !cid1s.includes(String(item.cid1))) return false;
  if (keywords.length) {
    const hay = `${item.title} ${item.brand} ${item.shop}`.toLowerCase();
    const positives = keywords.filter((k) => !k.startsWith('-'));
    const negatives = keywords.filter((k) => k.startsWith('-')).map((k) => k.slice(1));
    if (negatives.some((n) => n && hay.includes(n.toLowerCase()))) return false;
    if (positives.length && !positives.some((p) => p && hay.includes(p.toLowerCase()))) return false;
  }
  if (!titleMatch(item.title, titleFilters)) return false;
  return true;
}

async function fetchTrialFeed(url, opts = {}) {
  const res = await request(url, { headers: { accept: 'text/html,application/xhtml+xml', 'accept-language': 'zh-CN,zh;q=0.9' } });
  if (res.status !== 200) throw new Error(`活动页 HTTP ${res.status}`);
  const data = extractReactData(res.body);
  const comps = findFeeds(data);
  if (!comps.length) throw new Error('页面里没找到商品列表（活动可能已结束或改版）');
  const list = comps[0].feedList;
  const filters = opts.titleFilters || String(process.env.JD_TRY_TITLEFILTERS || '').split(',').map((s) => s.trim()).filter(Boolean);
  const maxApplyNum = Number(process.env.JD_TRY_APPLYNUMFILTER || 200000);
  const now = Date.now();
  const items = [];
  let skippedByFilter = 0;
  for (const f of list) {
    const ms = String(f.mSchema || '');
    const aidMatch = /activityId=(\d+)/.exec(ms);
    if (!aidMatch) continue;
    const end = parseEndTime(f.endTime);
    const title = String(f.skuTitle || f.wareName || '');
    const item = {
      aid: aidMatch[1],
      sku: String(f.sku || ''),
      title,
      brand: String(f.brandName || ''),
      shop: String(f.shopName || ''),
      cid1: String(f.cid1 || ''),
      cid2: String(f.cid2 || ''),
      supplyNum: Number(f.supplyNum || 0),
      applyNum: Number(f.applyNum || 0),
      jdPrice: f.jdPrice,
      endTime: f.endTime,
      end,
      stock: f.skuHasStock !== false,
    };
    if (end != null && end < now) continue; // 已结束
    if (!item.stock) continue;
    if (item.applyNum > maxApplyNum) continue;
    if (!itemMatch(item, { ...opts, titleFilters: filters })) {
      skippedByFilter++;
      continue;
    }
    items.push(item);
  }
  const seen = new Set();
  const uniq = items.filter((it) => (seen.has(it.aid) ? false : (seen.add(it.aid), true)));
  uniq.sort((a, b) => a.applyNum - b.applyNum); // 抢的人少的先申请
  uniq.skippedByFilter = skippedByFilter;
  return uniq;
}

// ---------- 请求签名（本地 h5st 服务） ----------
async function h5stAlive() {
  try {
    const r = await request(`http://127.0.0.1:${H5ST_PORT}/health`, { timeout: 2000 });
    return r.status === 200 && /alive|ok/i.test(r.body || '') === true || r.status === 200;
  } catch {
    return false;
  }
}

async function ensureH5stServer() {
  if (await h5stAlive()) return { procs: [], started: false };
  log('启动本地 h5st 签名服务…');
  const child = spawn(process.execPath, [path.join(__dirname, 'local-h5st-server.cjs'), '--port', String(H5ST_PORT)], {
    cwd: ROOT,
    stdio: 'ignore',
    windowsHide: true,
  });
  for (let i = 0; i < 40; i++) {
    await sleep(300);
    if (await h5stAlive()) {
      log('h5st 服务已就绪');
      return { procs: [child], started: true };
    }
  }
  child.kill();
  throw new Error('本地 h5st 服务没起来（端口被占用？可设 H5ST_PORT 换端口）');
}

function cookieOf() {
  const ck = String(process.env.JD_COOKIE || '').trim();
  if (!ck) throw new Error('没有 JD_COOKIE，请先运行 get-cookie.cmd');
  const pin = (ck.match(/pt_pin=([^;]+)/) || ck.match(/(?:^|[;\s])pin=([^;]+)/) || [])[1] || '';
  const parts = ck.split(';').map((s) => s.trim()).filter(Boolean);
  // 补一个 pt_pin 片段，老脚本/接口都认
  if (pin && !parts.some((p) => p.startsWith('pt_pin='))) parts.push(`pt_pin=${pin}`);
  return { cookie: parts.join('; ') + ';', pin };
}

let EID = '';
let PIN = '';
async function loadEid(cookie) {
  if (EID) return EID;
  try {
    process.env.JD_COOKIE = cookie;
    const mod = require(path.join(ROOT, 'utils', 'jsToken.js'));
    const r = await mod.getJsToken();
    EID = r && r.token ? r.token : '';
  } catch (e) {
    log(`  (eid 获取失败，继续不带 eid：${e.message})`);
    EID = '';
  }
  return EID;
}

async function sign(params) {
  const payload = JSON.stringify({ pin: PIN, ua: UA, body: params, appId: params.appid, version: '3.1' });
  const r = await request(`http://127.0.0.1:${H5ST_PORT}/h5st`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: payload,
  });
  let j;
  try {
    j = JSON.parse(r.body);
  } catch {
    throw new Error(`签名服务返回异常：${String(r.body).slice(0, 120)}`);
  }
  if (j.status !== 0) throw new Error('签名失败：' + JSON.stringify(j).slice(0, 160));
  return j.body.qs;
}

async function jdApi(cookie, { functionId, appid, body, useEid = true }) {
  const params = { functionId, appid, client: 'wh5', clientVersion: '13.6.1', body: JSON.stringify(body || {}) };
  const qs = await sign(params);
  const headers = {
    'content-type': 'application/x-www-form-urlencoded',
    cookie,
    origin: 'https://prodev.m.jd.com',
    referer: TRIAL_URL,
    'x-referer-page': TRIAL_URL,
    'x-rp-client': 'h5_1.0.0',
  };
  if (useEid && EID) headers['x-api-eid-token'] = EID;
  const r = await request('https://api.m.jd.com/client.action', { method: 'POST', headers, body: qs });
  let j = null;
  try {
    j = JSON.parse(r.body);
  } catch {}
  return { status: r.status, wl: r.headers['x-api-wl-message'], json: j, raw: r.body };
}

// ---------- 申请 ----------
async function quota(cookie) {
  for (const cfg of [{ functionId: 'try_rafflecount', appid: 'ysas-new' }, { functionId: 'try_rafflecount', appid: 'newtry' }]) {
    try {
      const r = await jdApi(cookie, { ...cfg, body: {}, useEid: false });
      if (r.json && r.json.code === '0' && r.json.data) return r.json.data;
    } catch {}
  }
  return null;
}

async function applyOne(cookie, item) {
  const r = await jdApi(cookie, { functionId: 'try_apply', appid: 'newtry', body: { activityId: Number(item.aid) } });
  const j = r.json || {};
  return {
    ok: j.code === '0' || j.success === true && !j.code,
    code: j.code,
    message: j.message || j.msg || '',
    wl: r.wl,
    http: r.status,
  };
}

// ---------- main ----------
async function main() {
  const argv = process.argv.slice(2);
  const dryRun = argv.includes('--dry-run');
  const force = argv.includes('--force');
  const urlArgIdx = argv.findIndex((a) => a === '--url');
  const url = urlArgIdx >= 0 ? argv[urlArgIdx + 1] : TRIAL_URL;
  const maxIdx = argv.findIndex((a) => a === '--max');
  const maxApply = maxIdx >= 0 ? Number(argv[maxIdx + 1]) : Number(process.env.JD_TRY_MAXLENGTH || 5);
  const gap = Number(process.env.JD_TRY_GAP || 8) * 1000;

  const argList = (name) => {
    const i = argv.findIndex((a) => a === name);
    if (i >= 0 && argv[i + 1] != null) return argv[i + 1];
    return '';
  };
  const splitList = (s) => String(s || '').split(/[,，\s]+/).map((x) => x.trim()).filter(Boolean);

  loadEnv();

  // 过滤条件：--category/--cid1 走类目，--keyword 走标题/品牌/店铺
  const categoryArg = splitList(argList('--category') || process.env.JD_TRY_CATEGORY || '');
  const cid1Arg = splitList(argList('--cid1') || process.env.JD_TRY_CID1 || '');
  const keywords = splitList(argList('--keyword') || process.env.JD_TRY_KEYWORD || '');
  const titleFilters = splitList(process.env.JD_TRY_TITLEFILTERS || '');

  let cid1s = [];
  if (categoryArg.length) {
    const resolved = resolveCid1(categoryArg);
    if (!resolved) {
      log(`未知类目名：${categoryArg.join(',')}（可用：${Object.keys(CATEGORY_PRESETS).join('、')}，或直接写数字 cid1）`);
      return 2;
    }
    cid1s.push(...resolved);
  }
  if (cid1Arg.length) cid1s.push(...cid1Arg);
  cid1s = [...new Set(cid1s)];

  const { cookie, pin } = cookieOf();
  PIN = pin;
  log(`京东试用：cookie pin=${pin || '(无)'}`);
  if (cid1s.length) log(`类目过滤：cid1 = ${cid1s.join(',')}${categoryArg.length ? `（${categoryArg.join(',')}）` : ''}`);
  if (keywords.length) log(`关键词过滤：${keywords.join(',')}（匹配标题/品牌/店铺）`);
  await loadEid(cookie);

  const items = await fetchTrialFeed(url, { cid1s, keywords, titleFilters });
  log(`活动页商品：${items.length} 个（已过滤过期/无货/黑名单${items.skippedByFilter ? `，条件外 ${items.skippedByFilter} 个` : ''}）`);
  items.slice(0, 20).forEach((it, i) => {
    log(`  ${i + 1}. ${it.title} | 品牌 ${it.brand || '-'} | 类目 cid1=${it.cid1} | 价 ¥${it.jdPrice} | 份数 ${it.supplyNum} | 已申请 ${it.applyNum} 人 | 截止 ${it.endTime}`);
  });
  if (!items.length) {
    log('没有可申请的商品，结束（可能活动改版，改 --url 试试）');
    return 0;
  }

  // 额度和申请都要签名 → 先把本地 h5st 服务拉起来
  const server = await ensureH5stServer();
  try {
    const q = await quota(cookie);
    if (q) log(`今日额度：已申请 ${q.applyNum} 次 / 剩余 ${q.remainingNum} 次（还可领回 ${q.remainingGetNum ?? '-'}）`);
    else log('今日额度：查询失败（接口可能改版），仍按 --max 尝试');
    if (dryRun) {
      log('--dry-run：不提交申请');
      return 0;
    }
    if (q && Number(q.remainingNum) <= 0 && !force) {
      log('今日申请额度已用完，明天再来（或加 --force 强制尝试验证链路）');
      return 0;
    }

    let done = 0;
    let failed = 0;
    let attempts = 0;
    for (const item of items) {
      if (attempts >= maxApply) break;
      if (q && Number(q.remainingNum) > 0 && done >= Number(q.remainingNum) && !force) break;
      attempts++;
      log(`申请：${item.title}（activityId=${item.aid}）`);
      try {
        const r = await applyOne(cookie, item);
        if (r.ok) {
          done++;
          log(`  ✓ 申请成功（${item.sku}）`);
        } else if (String(r.code) === '-311') {
          log(`  × 额度已满：${r.message}`);
          if (!force) break;
        } else {
          failed++;
          log(`  × 失败 code=${r.code} msg=${r.message} http=${r.http} wl=${r.wl}`);
        }
      } catch (e) {
        failed++;
        log(`  × 异常：${e.message}`);
      }
      if (gap > 0) await sleep(gap);
    }
    log(`完成：成功 ${done} 个，失败 ${failed} 个`);
    return failed > 0 ? 1 : 0;
  } finally {
    for (const p of server.procs) {
      try {
        p.kill();
      } catch {}
    }
  }
}

if (require.main === module) {
  main()
    .then((code) => process.exit(code || 0))
    .catch((e) => {
      console.error('试用工具出错：' + e.message);
      process.exit(2);
    });
}

// 供 tools/try-watch.cjs（盯盘）复用
module.exports = {
  ROOT,
  TRIAL_URL,
  CATEGORY_PRESETS,
  loadEnv,
  log,
  sleep,
  fetchTrialFeed,
  ensureH5stServer,
  cookieOf,
  loadEid,
  quota,
  applyOne,
  resolveCid1,
  setPin(pin) {
    PIN = pin;
  },
};
