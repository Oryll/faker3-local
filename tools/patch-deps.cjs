#!/usr/bin/env node
/**
 * 依赖垫片：上游 utils/baseUtils.js 会 require('http-cookie-agent/http')，
 * 但 http-cookie-agent 1.0.6 既没有 http.js 文件、exports 里也只导出 . 和 ./undici，
 * 直接 require 会报 ERR_PACKAGE_PATH_NOT_EXPORTED。
 *
 * pnpm 会在安装后执行 package.json 的 postinstall，这里幂等地补一个转发文件，
 * 让 `require('http-cookie-agent/http')` 可用。重复执行无副作用。
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const candidates = [
  path.join(ROOT, 'node_modules', 'http-cookie-agent'),
  path.join(ROOT, 'node_modules', '.pnpm', 'node_modules', 'http-cookie-agent'),
];

let fixed = 0;
let missing = 0;

for (const dir of candidates) {
  if (!fs.existsSync(dir)) {
    missing++;
    continue;
  }
  const shim = path.join(dir, 'http.js');
  if (!fs.existsSync(shim)) {
    fs.writeFileSync(shim, "module.exports = require('./dist/index.js');\n", 'utf8');
    fixed++;
  }
  // dist/index.js 是 CommonJS 产物；没有就跳过（安装可能失败）
  const dist = path.join(dir, 'dist', 'index.js');
  if (!fs.existsSync(dist)) {
    console.warn(`[patch-deps] 警告：${dist} 不存在，http-cookie-agent 可能没装好`);
  }
}

if (fixed > 0) console.log(`[patch-deps] 已补 http-cookie-agent/http.js（${fixed} 处）`);
else console.log('[patch-deps] 垫片已存在，无需修改');
if (missing === candidates.length) {
  console.warn('[patch-deps] 没找到 http-cookie-agent，请先执行 pnpm install');
}
