#!/usr/bin/env node
/**
 * 上游原版 jd_try.js 的运行器（对照保留）
 *
 * 上游 jd_try.js 依赖外部 H5ST 接口（H5ST_SERVER），这里用 tools/local-h5st-server.cjs
 * 在本地签名，再通过 run.js 启动 jd_try.js。
 *
 * ⚠ 实测：jd_try.js 依赖的 qryH5BabelFloors（商品列表）对新登录态恒 403，
 *    所以这条路径基本跑不出商品；日常请用 try.cmd（默认走 tools/try-tool.cjs）。
 */
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const http = require('http');

const ROOT = path.resolve(__dirname, '..');
const SERVER = path.join(ROOT, 'tools', 'local-h5st-server.cjs');
const RUNNER = path.join(ROOT, 'run.js');
const PORT = Number(process.env.H5ST_PORT || 9527);
const SERVER_URL = `http://127.0.0.1:${PORT}`;

const argv = process.argv.slice(2);
const dryRun = argv.includes('--dry-run');
const passthrough = argv.filter((a) => a !== '--dry-run');
const runArgs = passthrough.length ? passthrough : ['jd_try.js', '--timeout', '900'];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function serverAlive() {
  return new Promise((resolve) => {
    const req = http.get(`${SERVER_URL}/health`, { timeout: 1500 }, (res) => {
      res.resume();
      resolve(res.statusCode === 200);
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
  });
}

async function main() {
  if (!fs.existsSync(SERVER)) {
    console.error('缺少 tools/local-h5st-server.cjs');
    process.exit(2);
  }
  if (dryRun) {
    console.log(`[dry-run] 会先启动：node tools/local-h5st-server.cjs（端口 ${PORT}）`);
    console.log(`[dry-run] 然后执行：node run.js ${runArgs.join(' ')}`);
    return;
  }

  let server = null;
  if (!(await serverAlive())) {
    console.log(`[try] 启动本地 h5st 签名服务（端口 ${PORT}）…`);
    server = spawn(process.execPath, [SERVER], {
      cwd: ROOT,
      env: { ...process.env, H5ST_PORT: String(PORT) },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    let serverLog = '';
    server.stdout.on('data', (d) => { serverLog += d; });
    server.stderr.on('data', (d) => { serverLog += d; });
    for (let i = 0; i < 40; i++) {
      if (await serverAlive()) break;
      if (server.exitCode !== null) {
        console.error('[try] h5st 服务启动失败：\n' + serverLog.slice(-800));
        process.exit(1);
      }
      await sleep(250);
    }
    if (!(await serverAlive())) {
      console.error('[try] h5st 服务在 10 秒内没有就绪：\n' + serverLog.slice(-800));
      try { server.kill(); } catch {}
      process.exit(1);
    }
    console.log('[try] h5st 服务已就绪');
  } else {
    console.log(`[try] 复用已在运行的 h5st 服务（${SERVER_URL}）`);
  }

  const child = spawn(process.execPath, [RUNNER, ...runArgs], {
    cwd: ROOT,
    env: { ...process.env, H5ST_SERVER: SERVER_URL, H5ST_PORT: String(PORT), JD_TRY_MAXLENGTH: process.env.JD_TRY_MAXLENGTH || '5' },
    stdio: 'inherit',
    windowsHide: true,
  });
  const cleanup = () => { if (server) { try { server.kill(); } catch {} } };
  process.on('SIGINT', () => { cleanup(); process.exit(130); });
  child.on('exit', (code) => { cleanup(); process.exit(code === null ? 1 : code); });
}

main().catch((e) => {
  console.error('[try] 失败：' + e.message);
  process.exit(1);
});
