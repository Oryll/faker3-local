#!/usr/bin/env node
/**
 * 京东试用一键运行器（try.cmd 的实现）
 *
 * 默认走本仓库的新方案 tools/try-tool.cjs：
 *   解析试用活动页里服务端渲染的商品列表 -> 本地 h5st 签名 -> 调 try_apply 申请。
 *   （上游 jd_try.js 依赖的 qryH5BabelFloors 接口对新登录态恒 403，已不可用。）
 *
 * 用法：
 *   try.cmd                     # 按今日剩余额度申请
 *   try.cmd --dry-run           # 只看商品和额度
 *   try.cmd --max 3             # 最多申请 3 个
 *   try.cmd --force             # 额度为 0 也尝试（验证链路用）
 *   try.cmd --upstream          # 跑上游原版 jd_try.js（需要签名服务，作为对照保留）
 */
const path = require('path');
const { spawn } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const TRY_TOOL = path.join(ROOT, 'tools', 'try-tool.cjs');
const UPSTREAM_RUNNER = path.join(ROOT, 'tools', 'run-try-upstream.cjs');

const argv = process.argv.slice(2);
const upstream = argv.includes('--upstream');
const args = argv.filter((a) => a !== '--upstream');
const target = upstream ? UPSTREAM_RUNNER : TRY_TOOL;

if (argv.includes('--dry-run') && upstream) {
  console.log(`[dry-run] 会执行：node ${path.relative(ROOT, target)} ${args.join(' ')}`);
  process.exit(0);
}

const child = spawn(process.execPath, [target, ...args], { cwd: ROOT, stdio: 'inherit', windowsHide: true });
child.on('exit', (code) => process.exit(code === null ? 1 : code));
