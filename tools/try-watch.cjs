/**
 * 京东试用「盯盘」：定时抓活动页首屏，发现新的目标类目试用商品，就用当天剩余额度自动申请。
 *
 * 为什么要盯盘：
 *   试用活动页是服务端渲染的，首屏一次只给十几个商品，而页面全天会陆续上新品
 *   （例：2026-10-30 早先 12 个，晚上多出「KTC闺蜜机」变成 13 个）。
 *   列表接口 qryH5BabelFloors 对新登录态恒 403（换 tab/翻页都走它），所以只能靠
 *   「反复抓首屏 + 记录已申请 aid」来捡新上架的。手机类一天通常 1~3 部，
 *   盯一天就能把每天 5 次额度尽量用满。
 *
 * 用法（一般双击 try-watch.cmd，或命令行）：
 *   node tools/try-watch.cjs                     # 手机类，每 10 分钟看一次，最多盯 12 小时
 *   node tools/try-watch.cjs --dry-run           # 只看会申请哪些，不提交
 *   node tools/try-watch.cjs --once              # 只抓一轮就退出（适合手动抽查）
 *   node tools/try-watch.cjs --interval 300      # 每 5 分钟看一次
 *   node tools/try-watch.cjs --hours 6           # 只盯 6 小时
 *   node tools/try-watch.cjs --max 3             # 本次最多提交 3 个
 *   node tools/try-watch.cjs --category 手机,耳机  # 盯多个类目
 *   node tools/try-watch.cjs --keyword 一加,OPPO  # 盯关键词
 *   node tools/try-watch.cjs --cid1 9987,652     # 直接给 cid1
 *
 * 环境变量：
 *   JD_TRY_WATCH_INTERVAL  轮询间隔秒数（默认 600）
 *   JD_TRY_WATCH_HOURS     最多盯多少小时（默认 12）
 *   JD_TRY_GAP             两次申请之间的等待秒数（默认 8）
 *   JD_TRY_MAXLENGTH       本次最多提交几个（默认 5）
 *
 * 已申请记录保存在 logs/try-applied.json（同一天内不会重复提交同一个 aid）。
 */
const fs = require('fs');
const path = require('path');
const t = require('./try-tool.cjs');

const APPLIED_FILE = path.join(t.ROOT, 'logs', 'try-applied.json');

function splitList(s) {
  return String(s || '')
    .split(/[,，\s]+/)
    .map((x) => x.trim())
    .filter(Boolean);
}

function parseArgs(argv) {
  const get = (name) => {
    const i = argv.indexOf(name);
    return i >= 0 && argv[i + 1] != null ? argv[i + 1] : '';
  };
  const has = (name) => argv.includes(name);
  return {
    cid1s: [],
    category: splitList(get('--category') || process.env.JD_TRY_CATEGORY || 'phone'),
    cid1Arg: splitList(get('--cid1') || process.env.JD_TRY_CID1 || ''),
    keywords: splitList(get('--keyword') || process.env.JD_TRY_KEYWORD || ''),
    titleFilters: splitList(process.env.JD_TRY_TITLEFILTERS || ''),
    interval: Math.max(30, Number(get('--interval') || process.env.JD_TRY_WATCH_INTERVAL || 600)) * 1000,
    hours: Number(get('--hours') || process.env.JD_TRY_WATCH_HOURS || 12),
    maxApply: Number(get('--max') || process.env.JD_TRY_MAXLENGTH || 5),
    gap: Number(process.env.JD_TRY_GAP || 8) * 1000,
    url: get('--url') || t.TRIAL_URL,
    dryRun: has('--dry-run'),
    once: has('--once'),
  };
}

function loadApplied() {
  try {
    const j = JSON.parse(fs.readFileSync(APPLIED_FILE, 'utf8'));
    return j && typeof j === 'object' ? j : {};
  } catch {
    return {};
  }
}

function saveApplied(applied) {
  try {
    fs.mkdirSync(path.dirname(APPLIED_FILE), { recursive: true });
    fs.writeFileSync(APPLIED_FILE, JSON.stringify(applied, null, 2), 'utf8');
  } catch (e) {
    t.log(`  (已申请记录写入失败：${e.message})`);
  }
}

function markApplied(applied, item, ok) {
  applied[item.aid] = {
    title: item.title,
    date: new Date().toISOString().slice(0, 10),
    ok,
    at: new Date().toISOString(),
  };
  saveApplied(applied);
}

function humanLeft(ms) {
  if (ms <= 0) return '0秒';
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h) return `${h}小时${m}分`;
  if (m) return `${m}分${s % 60}秒`;
  return `${s}秒`;
}

async function main() {
  const o = parseArgs(process.argv.slice(2));
  t.loadEnv();

  const { cookie, pin } = t.cookieOf();
  t.setPin(pin);
  await t.loadEid(cookie);

  let cid1s = [];
  if (o.category.length) {
    const resolved = t.resolveCid1(o.category);
    if (!resolved) {
      t.log(`未知类目名：${o.category.join(',')}（可用：${Object.keys(t.CATEGORY_PRESETS).join('、')}，或直接写数字 cid1）`);
      return 2;
    }
    cid1s.push(...resolved);
  }
  cid1s.push(...o.cid1Arg);
  cid1s = [...new Set(cid1s)];

  t.log('京东试用盯盘');
  t.log(`  cookie pin=${pin || '(无)'}`);
  t.log(`  类目：${cid1s.length ? `cid1 = ${cid1s.join(',')}${o.category.length ? `（${o.category.join(',')}）` : ''}` : '(不限)'}`);
  if (o.keywords.length) t.log(`  关键词：${o.keywords.join(',')}（匹配标题/品牌/店铺）`);
  t.log(`  轮询间隔：${o.interval / 1000} 秒；盯盘窗口：${o.hours} 小时；本次最多提交：${o.maxApply} 个`);
  if (o.dryRun) t.log('  模式：--dry-run（只看不申请）');

  const applied = loadApplied();
  const server = await t.ensureH5stServer();
  const startedAt = Date.now();
  const deadline = startedAt + o.hours * 3600 * 1000;
  let rounds = 0;
  let lastMatched = 0;
  let doneCount = 0;
  let failCount = 0;
  let stopReason = '';

  try {
    while (true) {
      rounds++;
      const label = `[第${rounds}轮 ${new Date().toLocaleTimeString('zh-CN', { hour12: false })}]`;
      let items = [];
      try {
        items = await t.fetchTrialFeed(o.url, {
          cid1s,
          keywords: o.keywords,
          titleFilters: o.titleFilters,
        });
      } catch (e) {
        t.log(`${label} 抓取失败：${e.message}`);
      }

      lastMatched = items.length;
      const fresh = items.filter((it) => !applied[it.aid]);
      t.log(`${label} 首屏匹配 ${items.length} 个，新发现 ${fresh.length} 个`);

      if (fresh.length) {
        const q = await t.quota(cookie);
        const remaining = q ? Number(q.remainingNum) : NaN;
        if (q) t.log(`  今日额度：已申请 ${q.applyNum} 次 / 剩余 ${remaining} 次（还可领回 ${q.remainingGetNum ?? '-'}）`);

        if (o.dryRun) {
          for (const it of fresh) {
            t.log(`  [dry-run] 会申请：${it.title}（aid=${it.aid}，截止 ${it.endTime}，已 ${it.applyNum} 人）`);
          }
        } else if (!Number.isFinite(remaining)) {
          t.log('  额度查询失败，本轮跳过申请（下轮再试）');
        } else if (remaining <= 0) {
          t.log('  今日额度已用完，停止盯盘（明天 0 点后再跑）');
          stopReason = '额度用完';
          break;
        } else {
          for (const it of fresh) {
            if (doneCount + failCount >= o.maxApply) {
              stopReason = `达到本次上限 ${o.maxApply} 个`;
              break;
            }
            if (doneCount >= remaining) {
              stopReason = '额度用完';
              break;
            }
            let r;
            try {
              r = await t.applyOne(cookie, it);
            } catch (e) {
              r = { ok: false, message: '异常：' + e.message };
            }
            if (r.ok) {
              doneCount++;
              markApplied(applied, it, true);
              t.log(`  ✓ 申请成功：${it.title}（aid=${it.aid}，¥${it.jdPrice}）`);
            } else {
              failCount++;
              markApplied(applied, it, false);
              t.log(`  × 申请失败：${it.title} code=${r.code} ${r.message}`);
              if (String(r.code) === '-311') {
                stopReason = '额度用完';
                break;
              }
              if (String(r.code) === '-600') {
                t.log('  cookie 似乎失效了：请双击 get-cookie.cmd 重新扫码');
                stopReason = 'cookie失效';
                break;
              }
            }
            if (o.gap > 0) await t.sleep(o.gap);
          }
        }
      }

      if (o.once) {
        stopReason = stopReason || '单轮模式';
        break;
      }
      if (stopReason) break;
      if (Date.now() >= deadline) {
        stopReason = `窗口 ${o.hours} 小时到了`;
        break;
      }
      const left = deadline - Date.now();
      t.log(`  下一轮 ${humanLeft(o.interval)} 后（剩余窗口 ${humanLeft(left)}）`);
      await t.sleep(o.interval);
    }
  } finally {
    for (const p of server.procs) {
      try {
        p.kill();
      } catch {}
    }
    saveApplied(applied);
  }

  t.log(`盯盘结束（${stopReason || '正常退出'}）：共 ${rounds} 轮，提交成功 ${doneCount} 个，失败 ${failCount} 个`);
  if (doneCount === 0 && failCount === 0 && lastMatched === 0) {
    t.log('  没匹配到目标商品：页面全天会陆续上新品，过一会儿再跑或让它一直挂着。');
  }
  return 0;
}

main()
  .then((code) => process.exit(code || 0))
  .catch((e) => {
    console.error('盯盘出错：' + e.message);
    process.exit(2);
  });
