#!/usr/bin/env node
/*
 * local-h5st-server.cjs —— 本地 h5st 签名服务
 *
 * 背景：上游 jd_try.js 需要一个外部 h5st 签名服务（env H5ST_SERVER，POST /h5st）。
 * 仓库自带 function/h5st41.js（本地 h5st 3.0/3.1/4.0/4.1 实现），但它取 tk 时
 * 请求 https://cactus.jd.com/request_algo 的 payload 缺 appId 字段，京东恒回 400。
 * 本进程在 https.request 上打补丁，只给 cactus.jd.com 的 payload 补 appId，再调用
 * h5st41 生成签名，从而完全离线地对外提供 /h5st 接口。
 *
 * 用法：
 *   node tools/local-h5st-server.cjs            # 监听 127.0.0.1:9527
 *   node tools/local-h5st-server.cjs --port 9600
 *   H5ST_PORT=9601 node tools/local-h5st-server.cjs
 * 然后设置 set H5ST_SERVER=http://127.0.0.1:9527 再跑 jd_try.js。
 * 一般不用直接运行，双击 try.cmd 即可（它会自动起停本服务）。
 */
const http = require('http');
const https = require('https');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PORT = Number(process.env.H5ST_PORT || process.argv[process.argv.indexOf('--port') + 1] || 9527) || 9527;
const HOST = '127.0.0.1';
const DEFAULT_UA =
  process.env.JD_USER_AGENT ||
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 Edg/126.0.0.0';

// h5st41 内部依赖，缺失时给出人话
let qs, H5ST;
try {
  qs = require(path.join(ROOT, 'node_modules', 'qs'));
  H5ST = require(path.join(ROOT, 'function', 'h5st41.js'));
} catch (e) {
  console.error('[h5st] 依赖缺失：', e.message);
  console.error('[h5st] 先在项目根目录装依赖：pnpm install');
  process.exit(1);
}

/* ---------- 给 cactus.jd.com 的 request_algo 请求补 appId ---------- */
function patchCactus() {
  const orig = https.request;
  https.request = function (...args) {
    const opt = typeof args[0] === 'string' ? new URL(args[0]) : args[0] || {};
    const host = String(opt.hostname || opt.host || '');
    const req = orig.apply(this, args);
    if (!host.includes('cactus.jd.com')) return req;

    const chunks = [];
    const ow = req.write.bind(req);
    const oe = req.end.bind(req);

    req.write = (chunk, enc, cb) => {
      if (typeof enc === 'function') {
        cb = enc;
        enc = undefined;
      }
      if (chunk != null) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk), enc || 'utf8'));
      if (cb) process.nextTick(cb);
      return true;
    };
    req.end = (chunk, enc, cb) => {
      if (typeof chunk === 'function') {
        cb = chunk;
        chunk = undefined;
      }
      if (chunk != null) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
      let body = Buffer.concat(chunks).toString('utf8');
      try {
        const json = JSON.parse(body);
        if (!json.appId) json.appId = 'newtry';
        body = JSON.stringify(json);
        req.setHeader('content-length', Buffer.byteLength(body));
      } catch (_) {
        /* 不是 JSON 就原样放行 */
      }
      if (process.env.H5ST_DEBUG) console.log('[h5st] request_algo ->', body.slice(0, 160));
      ow(body);
      return oe(cb);
    };
    return req;
  };
}

/* ---------- 取 cookie 里的 pin（上游 jd_try 会传，兜底用 .env） ---------- */
function cookiePin(fallback) {
  if (fallback) return fallback;
  try {
    const fs = require('fs');
    const env = fs.readFileSync(path.join(ROOT, '.env'), 'utf8');
    const line = (env.match(/^JD_COOKIE=(.*)$/m) || [])[1] || '';
    const ck = line.replace(/^["']|["']$/g, '');
    return (ck.match(/pt_pin=(.+?);/) || ck.match(/(?:^|[;\s])pin=([^;]+)/) || [])[1] || '';
  } catch (_) {
    return '';
  }
}

/* ---------- 签名 ---------- */
async function sign(payload) {
  let params = payload.body;
  if (!params || typeof params !== 'object') throw new Error('body 必须是对象');
  params = { ...params };
  // 京东接口要求 body 是 JSON 字符串；上游 jd_try 直接传对象，这里统一串化后再签名
  if (params.body && typeof params.body === 'object') params.body = JSON.stringify(params.body);
  const ua = payload.ua || DEFAULT_UA;
  // 只接受像「普通 appId」的值（newtry / 35fa0 …）；上游会塞一整个旧 h5st 串，忽略它
  const declared = String(params.appid || '');
  const rawAppId = String(payload.appId || '');
  // 签名用的 appid 必须和请求参数里的 appid 一致；payload.appId 只是上游的附加字段（可能是 35fa0 或旧 h5st 串），仅作兜底
  const appid = /^[A-Za-z0-9_-]{2,32}$/.test(declared)
    ? declared
    : (/^[A-Za-z0-9_-]{2,32}$/.test(rawAppId) ? rawAppId : 'newtry');
  const version = typeof payload.version === 'string' && /^[34]\.\d$/.test(payload.version) ? payload.version : '3.1';

  const h = new H5ST({ pin: cookiePin(payload.pin), appid, ua });
  const h5st = await h.genH5st(params, version);
  if (typeof h5st !== 'string') throw new Error('genH5st 未返回字符串：' + JSON.stringify(h5st).slice(0, 200));

  const parts = h5st.split(';');
  const full = { ...params, t: parts[6] || String(Date.now()), h5st };
  return { body: full, qs: qs.stringify(full), h5st };
}

/* ---------- HTTP 服务 ---------- */
function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

patchCactus();

const server = http.createServer(async (req, res) => {
  const send = (code, obj) => {
    res.writeHead(code, { 'content-type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(obj));
  };
  if (req.method === 'GET' && (req.url === '/' || req.url === '/health')) {
    return send(200, { status: 0, msg: 'local h5st server alive', pid: process.pid });
  }
  if (req.method !== 'POST' || !req.url.startsWith('/h5st')) {
    return send(404, { status: 1, msg: 'POST /h5st only' });
  }
  try {
    const raw = await readBody(req);
    const payload = JSON.parse(raw || '{}');
    const result = await sign(payload);
    if (process.env.H5ST_DEBUG) {
      console.log(`[h5st] ${payload.body && payload.body.functionId} ok -> ${result.h5st.slice(0, 60)}...`);
    }
    return send(200, { status: 0, body: { body: result.body, qs: result.qs } });
  } catch (e) {
    console.error('[h5st] 签名失败：', e && e.message);
    return send(500, { status: 1, msg: String((e && e.message) || e) });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`[h5st] 本地 h5st 签名服务已启动： http://${HOST}:${PORT}`);
  console.log(`[h5st] 用法： set H5ST_SERVER=http://${HOST}:${PORT}  然后跑 jd_try.js`);
  console.log('[h5st] Ctrl+C 结束');
});

process.on('SIGINT', () => {
  server.close(() => process.exit(0));
});
process.on('SIGTERM', () => {
  server.close(() => process.exit(0));
});
