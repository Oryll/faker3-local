/*
 * compat-shim.cjs — 本地兼容层（实验性）
 * 背景：2026 京东网页登录不再下发 pt_key，多数 faker3 脚本在开头用
 *   https://plogin.m.jd.com/cgi-bin/ml/islogin 判断 CK 是否有效，
 *   新 cookie 在该接口恒返回 {"islogin":"0"}，导致脚本 0.4 秒空转退出。
 * 做法：在 Node 进程内拦截该请求的响应，把 islogin 改成 1，让脚本继续往下跑，
 *   看它后续用的新接口（api.m.jd.com）是否认这套 cookie。
 * 只改本机进程内的响应，不发任何伪造请求、不改京东数据。
 */
const https = require('node:https');
const http = require('node:http');
const { EventEmitter } = require('node:events');
const { Readable } = require('node:stream');

const TARGET_HOST = 'plogin.m.jd.com';
const TARGET_PATH = '/cgi-bin/ml/islogin';

function normalize(args) {
  let url = '';
  let opts = {};
  if (typeof args[0] === 'string') { url = args[0]; opts = args[1] || {}; }
  else { opts = args[0] || {}; url = opts.href || ''; }
  const host = opts.hostname || opts.host || (url ? new URL(url).hostname : '');
  const path = opts.path || (url ? new URL(url).pathname + (new URL(url).search || '') : '');
  return { host: String(host || ''), path: String(path || ''), url };
}

class FakeRequest extends EventEmitter {
  constructor(body) {
    super();
    this._body = body;
    this.method = 'GET';
    this.path = TARGET_PATH;
  }
  write() { return true; }
  end() {
    setImmediate(() => {
      const res = Readable.from([Buffer.from(this._body)]);
      res.statusCode = 200;
      res.statusMessage = 'OK';
      res.headers = { 'content-type': 'text/html; charset=utf-8', 'content-length': String(Buffer.byteLength(this._body)) };
      res.rawHeaders = ['content-type', 'text/html; charset=utf-8', 'content-length', String(Buffer.byteLength(this._body))];
      res.httpVersion = '1.1';
      res.httpVersionMajor = 1;
      res.httpVersionMinor = 1;
      res.setEncoding = function () { return this; };
      this.emit('response', res);
    });
    return this;
  }
  abort() {}
  destroy() {}
  setTimeout() { return this; }
  flushHeaders() {}
  setNoDelay() {}
  setSocketKeepAlive() {}
}

function patch(mod, name) {
  const orig = mod.request;
  mod.request = function (...args) {
    const { host, path } = normalize(args);
    if (host.includes(TARGET_HOST) && path.includes(TARGET_PATH)) {
      if (process.env.COMPAT_SHIM_VERBOSE === '1') {
        console.error(`[compat-shim] 拦截 ${name} ${host}${path} -> {"islogin":"1"}`);
      }
      return new FakeRequest('{"islogin":"1"}');
    }
    return orig.apply(this, args);
  };
}
patch(https, 'https');
patch(http, 'http');

/*
 * 静默上游「京东cookie 填写不规范」告警。
 * 原因：jdCookie.js / function/jdcookie.js 只认老格式 pt_key+pt_pin，
 *   新式登录态必然触发；而且它会把整条 cookie（含登录凭证）明文打到控制台/日志里。
 * 只看不打印：设置 COMPAT_SHOW_COOKIE_WARN=1 可恢复显示。
 * 不改上游文件，只在本进程内过滤这一行输出。
 */
const RAW_LOG = console.log.bind(console);
console.log = function (...args) {
  try {
    const first = args[0];
    if (typeof first === 'string' && (first.includes('填写不规范') || first.includes('正确格式为: pt_key=xxx'))) {
      if (process.env.COMPAT_SHOW_COOKIE_WARN === '1') RAW_LOG.apply(console, args);
      return;
    }
  } catch { /* 过滤失败就照常打印 */ }
  RAW_LOG.apply(console, args);
};
