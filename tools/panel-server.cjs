/**
 * 京东脚本本地管理面板（零依赖，仅本机 127.0.0.1 可访问）
 *
 * 启动：双击 panel.cmd，或 node tools/panel-server.cjs
 * 浏览器：http://127.0.0.1:7373
 *
 * 环境变量：
 *   PANEL_PORT  默认 7373
 */
const fs = require('fs');
const path = require('path');
const http = require('http');
const { spawn, execFile } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const PORT = Number(process.env.PANEL_PORT || 7373);
const NODE = process.execPath;
const TASK_NAME = 'Faker3-Daily';
const TRY_TASK_NAME = 'Faker3-Try-Phone';

const state = {
  current: null, // { id, target, label, child, output: [], startedAt, finishedAt, exitCode }
  history: [],
  saved: {}, // { beans, beanChange, tryApplied, tryRemaining, updatedAt } 持久化到 logs/panel-state.json
};

const STATE_FILE = path.join(ROOT, 'logs', 'panel-state.json');

function loadSaved() {
  try {
    state.saved = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')) || {};
  } catch {
    state.saved = {};
  }
}
loadSaved();

function parseOutput(text) {
  const out = {};
  const beanMatches = [...text.matchAll(/【当前京豆】\s*(\d+)\s*豆/g)];
  if (beanMatches.length) out.beans = Number(beanMatches[beanMatches.length - 1][1]);
  const beanChange = [...text.matchAll(/【京豆变动】\s*(-?\d+)\s*豆/g)];
  if (beanChange.length) out.beanChange = Number(beanChange[beanChange.length - 1][1]);
  const quota = [...text.matchAll(/今日额度：已申请\s*(\d+)\s*次\s*\/\s*剩余\s*(\d+)\s*次/g)];
  if (quota.length) {
    out.tryApplied = Number(quota[quota.length - 1][1]);
    out.tryRemaining = Number(quota[quota.length - 1][2]);
  }
  return out;
}

function saveParsed(fields) {
  if (!fields || !Object.keys(fields).length) return;
  state.saved = { ...state.saved, ...fields, updatedAt: Date.now() };
  try {
    fs.writeFileSync(STATE_FILE, JSON.stringify(state.saved, null, 2), 'utf8');
  } catch {}
}

// ---------- 基础 ----------
function readEnvFile() {
  const out = {};
  const file = path.join(ROOT, '.env');
  if (!fs.existsSync(file)) return { out: {}, mtime: null };
  const text = fs.readFileSync(file, 'utf8');
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const i = line.indexOf('=');
    if (i < 0) continue;
    let v = line.slice(i + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    out[line.slice(0, i).trim()] = v;
  }
  return { out, mtime: fs.statSync(file).mtimeMs };
}

function cookieInfo() {
  const { out, mtime } = readEnvFile();
  const ck = String(out.JD_COOKIE || '');
  const pin =
    (ck.match(/pt_pin=([^;]+)/) || ck.match(/(?:^|[;\s])pin=([^;]+)/) || [])[1] || '';
  const accounts = ck ? ck.split(/[&\n]/).filter((s) => s.trim()).length : 0;
  const segCount = ck ? ck.split(';').map((s) => s.trim()).filter(Boolean).length : 0;
  return {
    hasCookie: !!ck,
    pin: pin.trim(),
    accounts: accounts || (ck ? 1 : 0),
    segments: segCount,
    length: ck.length,
    envMtime: mtime,
    legacy: /pt_key=/.test(ck) && /pt_pin=/.test(ck),
    fresh: /(?:^|[;\s])pin=/.test(ck) && /(?:thor|light_key)=/.test(ck),
  };
}

function listLogs() {
  const dir = path.join(ROOT, 'logs');
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => /\.log$/i.test(f))
    .map((f) => {
      const p = path.join(dir, f);
      const st = fs.statSync(p);
      return { name: f, size: st.size, mtime: st.mtimeMs };
    })
    .sort((a, b) => b.mtime - a.mtime);
}

function tail(file, lines) {
  try {
    const text = fs.readFileSync(file, 'utf8');
    const arr = text.split(/\r?\n/);
    return arr.slice(-lines).join('\n');
  } catch {
    return '';
  }
}

function newestLog(filter) {
  const logs = listLogs().filter((l) => !filter || filter.test(l.name));
  return logs.length ? path.join(ROOT, 'logs', logs[0].name) : null;
}

function extractNumbers() {
  const beanLog = newestLog(/^run-/);
  const tryLog = newestLog(/^try-/);
  const beanText = beanLog ? fs.readFileSync(beanLog, 'utf8') : '';
  const tryText = tryLog ? fs.readFileSync(tryLog, 'utf8') : '';
  const beanMatches = [...beanText.matchAll(/【当前京豆】\s*(\d+)\s*豆/g)];
  const beanChange = [...beanText.matchAll(/【京豆变动】\s*(-?\d+)\s*豆/g)];
  const quota = [...tryText.matchAll(/今日额度：已申请\s*(\d+)\s*次\s*\/\s*剩余\s*(\d+)\s*次/g)];
  const done = [...beanText.matchAll(/完成:\s*(\d+)\s*成功\s*\/\s*(\d+)\s*失败/g)];
  return {
    beans: beanMatches.length ? Number(beanMatches[beanMatches.length - 1][1]) : null,
    beanChange: beanChange.length ? Number(beanChange[beanChange.length - 1][1]) : null,
    tryApplied: quota.length ? Number(quota[quota.length - 1][1]) : null,
    tryRemaining: quota.length ? Number(quota[quota.length - 1][2]) : null,
    lastDone: done.length ? { ok: Number(done[done.length - 1][1]), fail: Number(done[done.length - 1][2]) } : null,
    beanLog: beanLog ? path.basename(beanLog) : null,
    tryLog: tryLog ? path.basename(tryLog) : null,
  };
}

function queryTask(name) {
  return new Promise((resolve) => {
    execFile('schtasks', ['/Query', '/TN', name, '/FO', 'LIST'], { windowsHide: true }, (err, stdout) => {
      if (err) return resolve({ exists: false, detail: '' });
      const detail = String(stdout || '')
        .split(/\r?\n/)
        .find((l) => /下次运行时间|Next Run Time/i.test(l));
      resolve({ exists: true, detail: (detail || '').trim() });
    });
  });
}

function createTask(name, script, at) {
  return new Promise((resolve) => {
    const tr = `"${path.join(ROOT, script)}"`;
    execFile('schtasks', ['/Create', '/TN', name, '/TR', tr, '/SC', 'DAILY', '/ST', at, '/F'], { windowsHide: true }, (err, stdout, stderr) => {
      resolve({ ok: !err, message: String(stdout || stderr || '').trim() });
    });
  });
}

function deleteTask(name) {
  return new Promise((resolve) => {
    execFile('schtasks', ['/Delete', '/TN', name, '/F'], { windowsHide: true }, (err, stdout, stderr) => {
      resolve({ ok: !err, message: String(stdout || stderr || '').trim() });
    });
  });
}

// ---------- 任务定义 ----------
const TARGETS = {
  check: { label: '检查账号（京豆/会员）', cmd: [NODE, [path.join(ROOT, 'run.js'), 'jd_bean_change.js']] },
  daily: { label: '跑日常（13 个）', cmd: [NODE, [path.join(ROOT, 'run.js'), '--group', 'daily']] },
  extra: { label: '跑额外（24 个）', cmd: [NODE, [path.join(ROOT, 'run.js'), '--group', 'extra']] },
  weekend: { label: '跑周末（1 个）', cmd: [NODE, [path.join(ROOT, 'run.js'), '--group', 'weekly']] },
  'try-phone-dry': { label: '手机试用：只看不申请', cmd: [NODE, [path.join(ROOT, 'tools', 'run-try.cjs'), '--category', 'phone', '--dry-run']] },
  'try-phone': { label: '手机试用：申请', cmd: [NODE, [path.join(ROOT, 'tools', 'run-try.cjs'), '--category', 'phone']] },
  'get-cookie': { label: '刷新 Cookie（弹出京东扫码）', cmd: [NODE, [path.join(ROOT, 'tools', 'get-cookie.mjs'), '--wait', '300']] },
};

function startTarget(target) {
  if (state.current && state.current.finishedAt == null) {
    return { ok: false, message: '已有任务在跑，先等它结束或点「停止」' };
  }
  const def = TARGETS[target];
  if (!def) return { ok: false, message: '未知任务：' + target };
  const [bin, args] = def.cmd;
  const child = spawn(bin, args, { cwd: ROOT, env: process.env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  const run = {
    id: Date.now(),
    target,
    label: def.label,
    child,
    output: [],
    startedAt: Date.now(),
    finishedAt: null,
    exitCode: null,
  };
  state.current = run;
  const push = (buf) => {
    const text = String(buf);
    for (const line of text.split(/\r?\n/)) {
      if (!line.trim()) continue;
      run.output.push(line);
      if (run.output.length > 400) run.output.shift();
    }
  };
  child.stdout.on('data', push);
  child.stderr.on('data', push);
  child.on('exit', (code) => {
    run.finishedAt = Date.now();
    run.exitCode = code;
    const parsed = parseOutput(run.output.join('\n'));
    saveParsed(parsed);
    state.history.unshift({ id: run.id, target: run.target, label: run.label, startedAt: run.startedAt, finishedAt: run.finishedAt, exitCode: code });
    state.history = state.history.slice(0, 10);
    const last = run.output.slice(-3).join(' / ');
    run.output.push(`[面板] 任务结束，退出码 ${code}${last ? '；末行：' + last.slice(0, 200) : ''}`);
  });
  return { ok: true, id: run.id };
}

// ---------- HTTP ----------
function json(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'));
      } catch {
        resolve({});
      }
    });
  });
}

async function apiState() {
  const cookie = cookieInfo();
  const numbers = { ...extractNumbers(), ...state.saved };
  const dailyTask = await queryTask(TASK_NAME);
  const tryTask = await queryTask(TRY_TASK_NAME);
  const cur = state.current;
  return {
    ok: true,
    now: Date.now(),
    cookie,
    numbers,
    logs: listLogs().slice(0, 12),
    run: cur
      ? {
          id: cur.id,
          target: cur.target,
          label: cur.label,
          running: cur.finishedAt == null,
          startedAt: cur.startedAt,
          finishedAt: cur.finishedAt,
          exitCode: cur.exitCode,
          output: cur.output.slice(-80),
        }
      : null,
    history: state.history,
    tasks: { daily: dailyTask, tryPhone: tryTask },
  };
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  try {
    if (url.pathname === '/api/state') return json(res, 200, await apiState());

    if (url.pathname === '/api/run' && req.method === 'POST') {
      const body = await readBody(req);
      return json(res, 200, startTarget(String(body.target || '')));
    }

    if (url.pathname === '/api/stop' && req.method === 'POST') {
      const cur = state.current;
      if (cur && cur.child && cur.finishedAt == null) {
        try {
          cur.child.kill();
        } catch {}
        return json(res, 200, { ok: true, message: '已发送停止信号' });
      }
      return json(res, 200, { ok: false, message: '当前没有在跑的任务' });
    }

    if (url.pathname === '/api/log') {
      const name = String(url.searchParams.get('name') || '');
      if (!/^[\w.-]+\.log$/.test(name)) return json(res, 400, { ok: false, message: '非法文件名' });
      const file = path.join(ROOT, 'logs', name);
      if (!fs.existsSync(file)) return json(res, 404, { ok: false, message: '日志不存在' });
      return json(res, 200, { ok: true, name, text: tail(file, 300) });
    }

    if (url.pathname === '/api/schedule' && req.method === 'POST') {
      const body = await readBody(req);
      const action = String(body.action || '');
      const which = String(body.which || 'daily');
      const name = which === 'tryPhone' ? TRY_TASK_NAME : TASK_NAME;
      const script = which === 'tryPhone' ? 'try-phone.cmd' : 'daily.cmd';
      const at = which === 'tryPhone' ? '00:05' : '08:30';
      if (action === 'install') {
        const r = await createTask(name, script, at);
        return json(res, 200, { ok: r.ok, message: r.message || (r.ok ? `已创建计划任务 ${name}（每天 ${at}）` : '创建失败') });
      }
      if (action === 'remove') {
        const r = await deleteTask(name);
        return json(res, 200, { ok: r.ok, message: r.message || (r.ok ? `已删除计划任务 ${name}` : '删除失败') });
      }
      return json(res, 400, { ok: false, message: '未知操作' });
    }

    if (url.pathname === '/') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      return res.end(HTML);
    }

    json(res, 404, { ok: false, message: 'not found' });
  } catch (e) {
    json(res, 500, { ok: false, message: e.message });
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`管理面板已启动：http://127.0.0.1:${PORT}`);
  console.log('按 Ctrl+C 停止。');
});

// ---------- 页面 ----------
const HTML = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>京东账号管理面板</title>
<style>
  :root { --bg:#f5f6f8; --card:#fff; --line:#e6e8eb; --text:#1f2329; --sub:#8a919c; --brand:#c81d2a; --ok:#1a7f37; --warn:#b7791f; --bad:#d1242f; --btn:#f2f3f5; }
  * { box-sizing:border-box; }
  body { margin:0; background:var(--bg); color:var(--text); font:14px/1.6 -apple-system,"Segoe UI","Microsoft YaHei",sans-serif; }
  .wrap { max-width:1180px; margin:0 auto; padding:20px 20px 60px; }
  header { display:flex; align-items:baseline; gap:12px; margin-bottom:6px; }
  h1 { font-size:20px; margin:0; }
  .muted { color:var(--sub); }
  .small { font-size:12px; }
  .grid { display:grid; grid-template-columns:repeat(4,1fr); gap:12px; margin-top:16px; }
  .card { background:var(--card); border:1px solid var(--line); border-radius:10px; padding:14px 16px; }
  .card h2 { font-size:12px; color:var(--sub); font-weight:600; margin:0 0 6px; letter-spacing:.5px; }
  .big { font-size:24px; font-weight:700; }
  .badge { display:inline-block; padding:1px 8px; border-radius:20px; font-size:12px; border:1px solid transparent; }
  .badge.ok { color:var(--ok); background:#e8f5ec; border-color:#c5e6cf; }
  .badge.warn { color:var(--warn); background:#fdf5e6; border-color:#f0dfb8; }
  .badge.bad { color:var(--bad); background:#fdecee; border-color:#f5c6cb; }
  .badge.gray { color:var(--sub); background:#f2f3f5; border-color:var(--line); }
  .card.full { grid-column:1 / -1; }
  .row { display:flex; flex-wrap:wrap; gap:8px; align-items:center; }
  button { cursor:pointer; border:1px solid var(--line); background:var(--btn); color:var(--text); border-radius:8px; padding:7px 12px; font-size:13px; }
  button:hover { background:#e9ebee; }
  button.primary { background:var(--brand); border-color:var(--brand); color:#fff; }
  button.primary:hover { background:#a81722; }
  button:disabled { opacity:.5; cursor:not-allowed; }
  pre { background:#0d1117; color:#c9d1d9; padding:12px; border-radius:8px; overflow:auto; max-height:340px; font:12px/1.55 Consolas,"Cascadia Mono",monospace; white-space:pre-wrap; word-break:break-all; margin:8px 0 0; }
  table { width:100%; border-collapse:collapse; font-size:13px; }
  th, td { text-align:left; padding:6px 8px; border-bottom:1px solid var(--line); }
  th { color:var(--sub); font-weight:600; }
  select { border:1px solid var(--line); border-radius:8px; padding:6px 8px; background:#fff; }
  .toast { position:fixed; right:18px; bottom:18px; background:#1f2329; color:#fff; padding:10px 14px; border-radius:8px; opacity:0; transition:opacity .2s; max-width:420px; font-size:13px; }
  .toast.show { opacity:.95; }
  footer { margin-top:24px; color:var(--sub); font-size:12px; }
  @media (max-width:900px) { .grid { grid-template-columns:repeat(2,1fr); } }
</style>
</head>
<body>
<div class="wrap">
  <header>
    <h1>京东账号管理面板</h1>
    <span class="muted small" id="updated">加载中…</span>
  </header>
  <div class="muted small">本地页面，数据只来自本机 <code>faker3-local</code> 目录（127.0.0.1，不对外网开放）</div>

  <div class="grid">
    <div class="card">
      <h2>账号</h2>
      <div class="big" id="pin">-</div>
      <div class="small muted" id="cookieMeta">-</div>
      <div style="margin-top:8px" id="cookieBadge"></div>
    </div>
    <div class="card">
      <h2>当前京豆</h2>
      <div class="big" id="beans">-</div>
      <div class="small muted" id="beanMeta">-</div>
    </div>
    <div class="card">
      <h2>试用额度（今日）</h2>
      <div class="big" id="quota">-</div>
      <div class="small muted" id="quotaMeta">-</div>
    </div>
    <div class="card">
      <h2>最近一次运行</h2>
      <div class="big small" id="lastRun" style="font-size:15px">-</div>
      <div class="small muted" id="lastRunMeta">-</div>
    </div>
  </div>

  <div class="card full" style="margin-top:12px">
    <h2>操作</h2>
    <div class="row">
      <button class="primary" data-run="check">检查账号</button>
      <button data-run="daily">跑日常（13 个）</button>
      <button data-run="extra">跑额外（24 个）</button>
      <button data-run="weekend">跑周末</button>
      <button data-run="try-phone-dry">手机试用：只看</button>
      <button class="primary" data-run="try-phone">手机试用：申请</button>
      <button data-run="get-cookie">刷新 Cookie（扫码）</button>
      <button id="stopBtn">停止</button>
    </div>
    <div class="small muted" style="margin-top:8px">提示：任务在后台串行执行，一次只能跑一个；输出会实时显示在下面。</div>
  </div>

  <div class="card full" style="margin-top:12px">
    <h2>运行输出</h2>
    <div class="small muted" id="runMeta">当前没有运行中的任务</div>
    <pre id="runOutput">（暂无输出）</pre>
  </div>

  <div class="card full" style="margin-top:12px">
    <h2>计划任务</h2>
    <div class="row">
      <span>日常 08:30：<b id="taskDaily">-</b></span>
      <button data-task="install" data-which="daily">注册</button>
      <button data-task="remove" data-which="daily">删除</button>
      <span style="margin-left:16px">手机试用 00:05：<b id="taskTry">-</b></span>
      <button data-task="install" data-which="tryPhone">注册</button>
      <button data-task="remove" data-which="tryPhone">删除</button>
    </div>
    <div class="small muted" style="margin-top:8px">计划任务只在当前用户登录 Windows 时运行；改时间请直接编辑 install-schedule.cmd。</div>
  </div>

  <div class="card full" style="margin-top:12px">
    <h2>日志</h2>
    <div class="row">
      <select id="logSelect"></select>
      <button id="logBtn">查看</button>
      <button id="logRefresh">刷新</button>
    </div>
    <pre id="logOutput">（选择日志后点“查看”）</pre>
  </div>

  <footer>faker3-local 管理面板 · 数据来源：.env / logs/ · 不修改上游 jd_*.js</footer>
</div>
<div class="toast" id="toast"></div>
<script>
let state = null;
let timer = null;
const $ = (id) => document.getElementById(id);

function toast(msg) {
  const el = $('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove('show'), 4000);
}

function fmtTime(ts) {
  if (!ts) return '-';
  const d = new Date(ts);
  const p = (n) => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds());
}
function fmtDur(a, b) {
  if (!a || !b) return '';
  return Math.round((b - a) / 1000) + 's';
}

function render(s) {
  state = s;
  $('updated').textContent = '更新于 ' + fmtTime(s.now);

  const c = s.cookie;
  $('pin').textContent = c.pin || (c.hasCookie ? '（已配置 Cookie）' : '未配置');
  $('cookieMeta').textContent = c.hasCookie
    ? 'Cookie ' + c.length + ' 字符 / ' + c.segments + ' 段 / ' + c.accounts + ' 个账号 · .env ' + (c.envMtime ? fmtTime(c.envMtime) : '-')
    : '没有 .env 或 JD_COOKIE，请点「刷新 Cookie」';
  $('cookieBadge').innerHTML = c.hasCookie
    ? (c.fresh ? '<span class="badge ok">新式登录态（无 pt_key，正常）</span>' : (c.legacy ? '<span class="badge ok">老式 pt_key</span>' : '<span class="badge warn">格式不认识</span>'))
    : '<span class="badge bad">未配置</span>';

  $('beans').textContent = s.numbers.beans == null ? '-' : s.numbers.beans + ' 豆';
  $('beanMeta').textContent = s.numbers.beans == null
    ? '还没有京豆日志，点「检查账号」'
    : '变动 ' + (s.numbers.beanChange == null ? '-' : s.numbers.beanChange) + ' 豆 · ' + (s.numbers.beanLog || '');

  $('quota').textContent = s.numbers.tryRemaining == null ? '-' : ('剩余 ' + s.numbers.tryRemaining + ' 次');
  $('quotaMeta').textContent = s.numbers.tryApplied == null
    ? '还没有试用日志'
    : '今日已申请 ' + s.numbers.tryApplied + ' 次 · ' + (s.numbers.tryLog || '');

  const hist = s.history && s.history[0];
  if (s.run && s.run.running) {
    $('lastRun').textContent = '运行中：' + s.run.label;
    $('lastRunMeta').textContent = '已跑 ' + fmtDur(s.run.startedAt, Date.now()) + ' · 开始于 ' + fmtTime(s.run.startedAt);
    $('runMeta').textContent = '运行中：' + s.run.label + '（' + fmtTime(s.run.startedAt) + ' 开始）';
    $('runOutput').textContent = (s.run.output || []).join('\\n') || '（暂无输出）';
    $('runOutput').scrollTop = $('runOutput').scrollHeight;
  } else if (hist) {
    $('lastRun').textContent = (hist.exitCode === 0 ? '成功：' : '有失败：') + hist.label;
    $('lastRunMeta').textContent = fmtTime(hist.finishedAt) + ' · 用时 ' + fmtDur(hist.startedAt, hist.finishedAt) + ' · 退出码 ' + hist.exitCode;
    $('runMeta').textContent = '上次任务已结束：' + hist.label;
    if (s.run) $('runOutput').textContent = (s.run.output || []).join('\\n') || '（暂无输出）';
  } else {
    $('lastRun').textContent = '还没有运行记录';
    $('lastRunMeta').textContent = '点上面的按钮开始';
  }

  $('taskDaily').innerHTML = s.tasks.daily.exists ? '<span class="badge ok">已注册</span>' : '<span class="badge gray">未注册</span>';
  $('taskTry').innerHTML = s.tasks.tryPhone.exists ? '<span class="badge ok">已注册</span>' : '<span class="badge gray">未注册</span>';

  const sel = $('logSelect');
  const cur = sel.value;
  const opts = (s.logs || []).map((l) => '<option value="' + l.name + '">' + l.name + '（' + Math.round(l.size / 1024) + 'KB）</option>');
  if (opts.join('') !== sel._html) {
    sel._html = opts.join('');
    sel.innerHTML = opts.length ? opts.join('') : '<option value="">（还没有日志）</option>';
    if (cur) sel.value = cur;
  }
}

async function refresh() {
  try {
    const r = await fetch('/api/state');
    const s = await r.json();
    render(s);
    const running = s.run && s.run.running;
    clearTimeout(timer);
    timer = setTimeout(refresh, running ? 1500 : 6000);
  } catch (e) {
    $('updated').textContent = '连接面板失败：' + e.message;
    clearTimeout(timer);
    timer = setTimeout(refresh, 5000);
  }
}

async function post(url, body) {
  const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body || {}) });
  return r.json();
}

document.addEventListener('click', async (ev) => {
  const t = ev.target.closest('button');
  if (!t) return;

  if (t.dataset.run) {
    const target = t.dataset.run;
    if (target === 'get-cookie' && !confirm('会打开一个独立 Edge 窗口让你扫码；扫完点确认后会自动写回 .env。继续？')) return;
    t.disabled = true;
    const r = await post('/api/run', { target });
    toast(r.ok ? '已启动：' + target : r.message);
    t.disabled = false;
    refresh();
    return;
  }

  if (t.id === 'stopBtn') {
    const r = await post('/api/stop');
    toast(r.message);
    refresh();
    return;
  }

  if (t.dataset.task) {
    const r = await post('/api/schedule', { action: t.dataset.task, which: t.dataset.which });
    toast(r.message);
    refresh();
    return;
  }

  if (t.id === 'logBtn' || t.id === 'logRefresh') {
    const name = $('logSelect').value;
    if (!name) return toast('还没有日志');
    const r = await fetch('/api/log?name=' + encodeURIComponent(name));
    const j = await r.json();
    $('logOutput').textContent = j.ok ? j.text : j.message;
    return;
  }
});

refresh();
</script>
</body>
</html>`;
