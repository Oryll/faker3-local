# faker3 本地运行模板

基于 [shufflewzc/faker3](https://github.com/shufflewzc/faker3) 的本地（非青龙）运行环境。

原始仓库是给青龙面板用的：没有 `package.json`、没有依赖、也不会自动读 `.env`，直接
`node jd_xxx.js` 会报 `Cannot find module 'got'`。这个目录在原始克隆基础上补齐了运行所需的
一切，**没有改动任何一个原始 `jd_*.js` 脚本**：

| 新增文件 | 作用 |
| --- | --- |
| `package.json` / `pnpm-lock.yaml` / `node_modules/` | 补齐 25 个依赖并已安装好 |
| `.env.example` | Cookie / 通知 / 代理等配置模板 |
| `run.js` | 运行器：读 `.env`、按组跑脚本、超时控制、汇总结果、写日志 |
| `scripts.json` | 分组与间隔/超时配置，可自己改 |
| `run.cmd` | Windows 启动入口（自动找 Node，不需要先配 PATH） |
| `check-cookie.cmd` | 一键检测 Cookie 是否有效（跑 `jd_bean_change.js`；`jd_CheckCK.js` 在新机制下会误报，见第 9 节） |
| `get-cookie.cmd` / `tools/get-cookie.mjs` | **自动取 Cookie**：开一个专用 Edge 窗口让你扫码登录，把整套 cookie 写进 `.env` |
| `daily.cmd` | 每日组入口，供计划任务调用 |
| `install-schedule.cmd` / `remove-schedule.cmd` | 注册/删除 Windows 每日计划任务 |
| `panel.cmd` / `tools/panel-server.cjs` | **本地管理面板**：浏览器里看账号/京豆/额度、点按钮跑任务、看日志、注册计划任务（第 12 节） |
| `try.cmd` / `try-phone.cmd` / `tools/try-tool.cjs` | 京东试用：抓活动页商品 → 本地签名 → 提交申请（第 11 节） |
| `tools/analyze-deps.js` | 依赖分析小工具（看某脚本用到哪些 npm 包） |
| `tools/check-deps.js` | 静态检查所有脚本的依赖是否装齐：`node tools/check-deps.js [--all]` |
| `.gitignore` | 忽略 `node_modules/`、`.env`、`.jd-profile/`、日志、缓存 |

---

## 1. 快速开始

```bat
:: 1) 拿 Cookie（最省事：开专用 Edge 窗口扫码登录，自动写进 .env）
get-cookie.cmd
::    也可以手动：复制 .env.example 为 .env，按注释自己填 JD_COOKIE

:: 2) 验证 Cookie（跑资产统计，能出京豆就说明 cookie 有效；见第 9 节）
check-cookie.cmd

:: 3) 跑每日组（双击 run.cmd 不带参数 = 查看用法）
run.cmd --group daily
```

常用命令：

| 命令 | 说明 |
| --- | --- |
| `run.cmd --list` | 列出所有分组和脚本（带中文名） |
| `run.cmd --group daily` | 每日组（14 个脚本） |
| `run.cmd --group weekly` | 每周组（清券） |
| `run.cmd jd_bean_change.js` | 跑单个脚本 |
| `run.cmd --group daily --dry-run` | 只预览，不执行 |
| `run.cmd --group extra --gap 10 --timeout 300` | 调间隔/超时 |
| `run.cmd --group all --stop-on-error` | 出错就停 |

> 也可以在 PowerShell / Git Bash 里直接 `node run.js ...`，效果一样。

## 2. Cookie 怎么拿

### 方式一（推荐）：`get-cookie.cmd`

双击 `get-cookie.cmd` → 会弹出一个**专用的** Edge 窗口（配置目录是本目录下的 `.jd-profile`，
不影响你平时用的浏览器）→ 用京东 App 扫码、或点「账号登录」用密码/短信登录 → 脚本检测到登录后
自动把整套 cookie 写进 `.env` 的 `JD_COOKIE`。

- 第一次要扫码；之后 `.jd-profile` 里保留登录态，再跑通常几秒就能走完（登录态过期才需要重扫）。
- `get-cookie.cmd --wait 600` 可以延长等待时间；`--print` 只打印不写文件；`--keep` 抓完不关浏览器。
- 抓的是**包含 HttpOnly 的完整 cookie**（`thor` / `light_key` / `sdtoken` / `pin` 等一整串），
  不是浏览器地址栏插件能导出的那种残缺版本。

### 方式二：手动从 DevTools 复制

1. Chrome / Edge 打开 <https://www.jd.com> 并登录；
2. F12 → **Application（应用）** → **Storage → Cookies** → `https://www.jd.com`；
3. 把表格里的 cookie 名称/值拼成 `k=v; k=v; ...` 一串，末尾补一段 `pt_pin=<pin 那一行的值>;`，
   填到 `.env` 的 `JD_COOKIE=` 后面。

> **2026 年的变化**：京东网页登录已经**不再下发 `pt_key`**，现在有效的是
> `pin` / `thor` / `light_key` / `sdtoken` 这一整套。faker3 的脚本本身不关心字段名
> （只是把 cookie 原样带给京东接口），所以整套新 cookie 照常能用；末尾那段 `pt_pin=...`
> 只是为了让脚本能显示出账号名。**不要自己伪造 `pt_key=...`**，实测会让京东判定鉴权失败
> （资产查询变成 0 豆 / 未实名）。详见第 9 节。

- **多账号**：用 `&` 连接两个账号各自的整套 cookie，例如
  `JD_COOKIE=pin=jd_aaa; thor=...; pt_pin=jd_aaa;&pin=jd_bbb; thor=...; pt_pin=jd_bbb;`
  或者写成字面量 `\n`（两个字符）分隔，运行器会替换成换行。
- 只想跑某几个账号：在 `.env` 里设 `ALLOWPIN=jd_aaa,jd_bbb`；想屏蔽某账号用 `BANPIN`。
- Cookie 有效期不固定（几天到几周），失效后重新跑一次 `get-cookie.cmd` 即可。

## 3. 分组说明（`scripts.json` 可改）

| 分组 | 数量 | 内容 |
| --- | --- | --- |
| `daily` | 13 | 资产统计、打卡领豆、种豆得豆、新农场任务/浇水、自动评价、保活等（`jd_CheckCK.js` 因误报已挪到 `extra`） |
| `weekly` | 1 | 删除优惠券 |
| `extra` | 23 | 其余日常/活动类脚本，按需挑（`jd_lmdraw`、`jd_pkabeans`、`jd_ttgd` …） |
| `help` | 5 | 助力类，需要互助码或好友（`jd_farmnew_*_help`、`jd_fish_help` …） |
| `stale` | 6 | 已过期的带日期活动（`jd_dplh0408/0420/0509/0523/0609`、`jd_lhgz0408`） |
| `tools` | 3 | 工具类（依赖安装、账密更新、代理检测），一般不用跑 |
| `special` | 1 | `jd_try.js`，需要外部 H5ST 签名服务（`H5ST_SERVER`）才可用 |

脚本之间默认间隔 6 秒、单脚本超时 240 秒，在 `scripts.json` 的 `settings` 里改。
每次运行都会在 `logs/run-YYYY-MM-DD.log` 追加一行结果。

## 4. 定时运行

双击 `install-schedule.cmd`，会创建一个名为 **Faker3-Daily** 的计划任务：每天 **08:30**
运行 `daily.cmd`（= `run.cmd --group daily`）。

```bat
schtasks /Query /TN "Faker3-Daily"    :: 查看
schtasks /Run   /TN "Faker3-Daily"    :: 立刻跑一次
```

- 想改时间/组：删掉任务后用文本编辑器改 `install-schedule.cmd` 里的 `RUN_AT` 再双击；
- 删除任务：双击 `remove-schedule.cmd`；
- 默认是「仅在用户登录时运行」。要关机/未登录也跑，建议直接用青龙 Docker（青龙本来就是
  为这个场景做的），本模板主打“不想装 Docker 时也能跑”。

## 5. 依赖说明

`package.json` 里是这 25 个包，已装好：

```
axios big-integer cheerio console-table-printer crc crypto-js date-fns dotenv ds
global-agent got http-cookie-agent https-proxy-agent iconv-lite ini jsdom moment
png-js qs redis request sharp socks-proxy-agent tough-cookie tunnel
```

几个关键点：

- **`got` 必须是 11.x**：脚本是 CommonJS 的 `require('got')`，got 12+ 是纯 ESM，装了新版报
  `ERR_REQUIRE_ESM`。本模板已锁 `^11.8.6`。
- `sharp`（仅 `jd_AutoEval.js` 用）、`redis`、`ds`、`png-js` 这些是混淆代码里 require 的，
  一并装上省得跑到一半报缺模块。
- 作者自带的 `jd_indeps.sh` 是给青龙用的：装到全局目录、而且**漏了 got / dotenv / ini /
  global-agent / big-integer / console-table-printer 等**，纯本地跑不要指望它。
- 重新安装依赖：`pnpm install --prod`；没有 pnpm 就用 `npm install`（lockfile 是 pnpm 的，
  npm 会忽略）。本项目在 **Node v24.21.0** 下实测通过，Node 16/18/20 也都可以。

## 6. 已知限制 / 坑

1. `jd_try.js`（京东试用）需要外部 H5ST 签名服务，`H5ST_SERVER` 不配置跑不了。
2. `stale` 组的带日期活动脚本已经过期，跑只会报接口错误，留着仅为完整性。
3. `help` 组需要互助码/好友，单账号跑结果无意义。
4. 非青龙环境下通知**默认只打印到控制台**；要推微信/TG/Server酱，在 `.env` 里配
   `PUSH_KEY` / `PUSH_PLUS_TOKEN` / `TG_BOT_TOKEN` 等（完整列表见 `sendNotify.js` 注释）。
5. 京东经常改接口，`403 / 401 / 活动不存在` 不一定是你的配置问题，可能脚本本身已失效；
   上游每天都在推新版本，`git pull` 后重跑即可（合并时保留本模板新增的文件）。
6. 脚本会相对当前目录写缓存（`BeanCache/`、`YYYY-MM-DD.json` 等），本运行器已固定在仓库
   根目录执行，并把这些产物加入了 `.gitignore`。
7. 用**无效** cookie 试跑时，个别脚本会主动 `exit 1`（例如 `jd_daka_bean.js` 检测到 CK
   失效时），运行器会记为“失败”，这是脚本自身行为，不是模板问题。换成真实 cookie 后正常。
8. 混淆代码里夹着 `@redacted/enterprise-plugin`、`@redacted/components` 这种**并不存在的
   假包名**（混淆器生成的字符串载荷），不影响运行；`tools/check-deps.js` 已把它们排除，
   实测 60 个脚本 0 缺失依赖。

## 7. 风险提醒（务必看）

- Cookie（不管是最老的 `pt_key`，还是现在这套 `pin`/`thor`/`light_key`/`sdtoken`）=
  **账号登录态**，拿到就能操作账号。不要发给任何人，不要提交到 git。
- 这类脚本调用京东私有接口、模拟签名，**违反平台规则，存在风控/黑号/封号风险**。
  建议只用小号、不要用主账号；多账号/代理不要拉满。
- 仓库大量代码是混淆过的（`Function(...)` + 字符串数组，连依赖里都混着
  `@redacted/enterprise-plugin` 这类混淆器生成的假包名），**无法人工审计**。跑它等于把登录态
  交给一份读不懂的代码。
- 仓库无 LICENSE，作者声明“仅供测试学习、禁止商用、下载后 24 小时内删除”。

## 8. 卸载

1. 如果有注册计划任务：双击 `remove-schedule.cmd`；
2. 直接删除 `D:\gongzuoqu\faker3-local` 整个目录即可（本模板没有往系统里装任何东西）。

## 9. 关于 pt_key 消失（2026 年变化）与常见误报

2026 年起，京东网页版的登录流程**不再下发 `pt_key` / `pt_pin`** 这两个老 cookie，改成下发
`pin` / `thor` / `light_key` / `sdtoken` 一整套（HttpOnly，只对服务器可见）。这带来两个现象：

1. **网上老教程里的「F12 找 pt_key」已经找不到东西了** —— 不是你没登录，是它根本不发了；
   浏览器插件导出的 cookie 串也天然缺这些 HttpOnly 字段，所以只有整套复制才有效。
2. **`jd_CheckCK.js` 会误报「CK 已失效」**：它按老格式解析 `pt_key=` / `pt_pin=` 来判断，
   在新机制下必然判失败（实测真实有效的 cookie 也会显示「填写不规范 / 已失效」）。
   本模板的 `check-cookie.cmd` 已改为跑 `jd_bean_change.js`（资产统计）来验证登录态 ——
   能正常打出京豆 / Plus 信息就说明 cookie 有效。

实测结论（同一套新 cookie）：

| 测试 | 结果 |
| --- | --- |
| `JD_COOKIE=<整套新 cookie>` + 末尾 `pt_pin=<pin>;` | ✅ 正常：`【账号1🆔】jd_xxx(已实名)、Plus会员、459 京豆` |
| 仅 `<整套新 cookie>`（不补 `pt_pin`） | ⚠️ 能取数，但脚本里账号名显示 `null` |
| 在整套后面**自己加一个假 `pt_key=`** | ❌ 反而鉴权失败：0 豆、未实名、普通会员 |
| `jd_CheckCK.js`（老格式校验） | ❌ 恒误报失效，不代表 cookie 有问题 |

所以：**用 `get-cookie.cmd` 生成 `.env`，不要手工编造 `pt_key`**。

## 10. 兼容层 `tools/compat-shim.cjs`（默认开启）

**它解决的问题**：仓库里很多脚本（`jd_fruit_new`、`jd_plantBean`、`jd_water_new`、`jd_ttgd`、
`jd_daka_bean` …）开头会先调一个老接口判断 Cookie 是否有效：

```
GET https://plogin.m.jd.com/cgi-bin/ml/islogin
```

这个接口是 `pt_key` 时代的产物，对 2026 年这套新 Cookie **恒返回 `{"islogin":"0"}`**，
于是脚本认为「CK 已失效」，0.3~0.5 秒就打印提示退出——看起来什么都没干。
但实测它们后面真正干活的业务接口（`api.m.jd.com` 等）**是认新 Cookie 的**（能返回真实资产数据）。

**做法**：`compat-shim.cjs` 通过 Node 的 `--require` 预加载到每个子进程里，在进程内只拦截
`plogin.m.jd.com/cgi-bin/ml/islogin` 这一个请求，直接返回 `{"islogin":"1"}`；其它请求（含所有
真实业务请求）一律原样放行。它**不伪造任何登录凭据**，只是跳过「脚本自检」这一步。

**控制方式**：

```bat
run.cmd --group daily              :: 默认开启兼容层
run.cmd --group daily --no-compat   :: 关闭（回到老行为，会看到大量「CK已失效」空转）
set COMPAT_SHIM_VERBOSE=1 && run.cmd jd_plantBean.js   :: 打印每次拦截日志，便于排查
set COMPAT_SHOW_COOKIE_WARN=1 && run.cmd jd_bean_change.js  :: 恢复上游「cookie 填写不规范」告警
```

**顺手静默了一行危险输出**：上游 `jdCookie.js:102` / `function/jdcookie.js:31` 只认老格式
`pt_key + pt_pin`，新登录态必然触发下面这种提示，而且它会把**整条 Cookie（等于登录凭证）明文**打到
控制台和日志里：

```
提示:京东cookie 【__jda=...; pin=...; thor=...; pt_pin=...】填写不规范,可能会影响部分脚本正常使用。
```

兼容层默认把这一行过滤掉（只过滤这一行，不改上游文件），避免 Cookie 被截图/日志外传。
需要排查时用 `COMPAT_SHOW_COOKIE_WARN=1` 恢复显示。注意：这一层只在通过 `run.cmd` / `daily.cmd` /
面板运行时生效；直接 `node jd_bean_change.js` 仍然会打印。

**实测效果（2026-10-30，daily 组，开启兼容层）**：`12 成功 / 1 失败 / 共 13 个，约 150s`，
且出现真实动作——`jd_plantBean` 定时领取营养液成功、收好友营养液 ×5（成长值 +8）；
`jd_plantBean_friend` 收获营养液（成长值 +8）；`jd_water_new` 判断「剩余水滴 0g，不再浇水」；
`jd_fruit_new` 真实调用农场接口（提示先在京东 App/网页里选种植目标）；`jd_daka_bean` 报「已签到」
才 exit 1（脚本自身行为）。

**仍然受限的**（兼容层救不了，属于京东服务端）：

- `jd_ttgd`、`jd_qy_sign`、`jd_dwapp` 等仍被判「未登录 / F10002」——它们用的接口本身不认新 Cookie；
- `jd_fruit_new` 需要先手动选一次种植目标；`jd_ksjsb` 需要额外装 `smallfawn` 模块；
- `jd_CheckCK.js` 依旧是老逻辑，永远误报（已从 daily 移出）。

如果哪天京东把 `islogin` 这个接口彻底关掉（连拦截都不需要），或上游脚本适配了新登录态，
直接 `--no-compat` 关掉本层即可；它只是过渡用的。

## 11. 京东试用（`try.cmd`，已改成本地方案）

上游 `jd_try.js` 依赖两个外部条件：`H5ST_SERVER` 签名接口 + `qryH5BabelFloors` 商品列表接口。
实测这两条在新登录态下都走不通（列表接口恒 **403**，网关直接拒绝）。现在改成另一条路：

1. **商品列表**：试用活动页（Babel 页）是服务端渲染的，商品直接内嵌在 HTML 的
   `window.__react_data__` 里（含 `activityId`、`sku`、`skuTitle`、`supplyNum`、`applyNum`、`endTime`），
   不需要登录、不需要接口，直接抓页面解析；
2. **提交申请**：走 `api.m.jd.com` 的 `try_apply`（新登录态可用），签名由本仓库
   `tools/local-h5st-server.cjs` 用上游自带的 `function/h5st41.js` 在**本地**完成；
3. **额度**：`try_rafflecount` 显示今日已申请次数/剩余次数（京东规则：每天 5 次）。

```bat
try.cmd                    :: 读商品 + 按今日剩余额度申请（默认最多 5 个）
try.cmd --dry-run          :: 只看商品和额度，不申请
try.cmd --max 3            :: 本次最多申请 3 个
try.cmd --force            :: 额度为 0 也试一次（验证链路）
try.cmd --upstream         :: 跑上游原版 jd_try.js（对照用，基本拿不到商品）

:: 只申请手机（推荐，双击 try-phone.cmd 也一样）
try.cmd --category phone --dry-run   :: 只看今天有哪些手机试用
try-phone.cmd                        :: 把今天的额度全用在手机上
try.cmd --category phone --max 5     :: 同上，显式指定最多 5 个

:: 定向申请（在京东 App/网页看到想要的试用商品，把活动 ID 填进去直接申请）
try.cmd --aid 503744764                  :: 申请单个
try.cmd --aid 503744764,503748241        :: 一次申请多个
try.cmd --aid 503744764 --dry-run        :: 只看会不会提交
try.cmd --keyword 一加,OPPO          :: 按标题/品牌/店铺关键词过滤
try.cmd --cid1 9987,652              :: 按京东一级类目 id 过滤（9987=手机通讯，652=影音娱乐）
```

> 手机筛选按京东类目 `cid1=9987`（手机通讯），**不是**按标题里是否出现「手机」——
> 否则「小音响适用于手机」这类配件也会被算进来。类目 id 打印在每行商品的 `类目 cid1=` 后面。
> 目前活动页首屏一轮大约只有 1～2 部手机（例如 `一加 Turbo 6X 手机`、`一加 Turbo 6V 手机`），
> 由于每天只有 5 次额度，`try-phone.cmd` 会把手机全部申请掉；若某天手机多于 5 部，
> 按「已申请人数从少到多」的顺序取前 5 个。

相关文件：

| 文件 | 作用 |
| --- | --- |
| `tools/try-tool.cjs` | 试用主逻辑：抓页面 → 解析商品 → 本地签名 → 调 `try_apply` |
| `tools/run-try.cjs` | `try.cmd` 的入口（默认走 `try-tool.cjs`，`--upstream` 切回原版） |
| `tools/run-try-upstream.cjs` | 原版 `jd_try.js` 运行器（起本地签名服务 + 跑 `jd_try.js`） |
| `tools/local-h5st-server.cjs` | 本地 h5st 3.1 签名服务（`127.0.0.1:9527`，`try-tool` 会自动拉起） |
| `tools/patch-deps.cjs` | 补 `node_modules/http-cookie-agent/http.js` 垫片（`postinstall` 自动执行） |
| `try-phone.cmd` | 双击版「只申请手机」（内部就是 `run-try.cjs --category phone`） |

可调环境变量（写进 `.env` 即可）：`JD_TRY_MAXLENGTH`（默认 5）、`JD_TRY_CATEGORY`
（类目过滤，如 `phone`/`手机`，等价 `--category`）、`JD_TRY_KEYWORD`（关键词过滤，等价
`--keyword`）、`JD_TRY_CID1`（类目 id 过滤，等价 `--cid1`）、`JD_TRY_TITLEFILTERS`
（关键词黑白名单，`-` 前缀排除，例：`耳机,手机,-奶粉`）、`JD_TRY_APPLYNUMFILTER`
（申请人数超过该值就不申请，默认 200000，基本等于不限制）、`JD_TRY_GAP`（两次申请间隔秒数，默认 8）。

**注意**：

- 每天额度用完（`剩余 0 次`）时 `try.cmd` 会直接提示明天再来，不会空跑；
- 抓到的商品是活动页首屏那 12 个（不同时间会换），额度只有 5 个，够用；
- 申请是否中签由京东抽选决定，脚本只负责「提交申请」；
- 每天想自动跑：`schtasks` 里再加一条 `try-phone.cmd`（建议 00:05，额度一过 0 点就重置），例如：
  `schtasks /Create /TN "Faker3-Try-Phone" /TR "\"D:\gongzuoqu\faker3-local\try-phone.cmd\"" /SC DAILY /ST 00:05 /F`

## 12. 管理面板（`panel.cmd`，浏览器里点鼠标）

不想记命令时用这个：双击 `panel.cmd`，会自动打开浏览器到 <http://127.0.0.1:7373>（只监听本机，
外网访问不到）。想关掉就回到那个黑窗口按 `Ctrl+C`。

面板能做：

| 区域 | 说明 |
| --- | --- |
| 账号 | 显示当前 Cookie 里的 `pin`、Cookie 段数/字符数、`.env` 最后修改时间，并标注是「新式登录态」还是「老式 pt_key」 |
| 当前京豆 | 取最近一次「检查账号」的输出（`517 豆`、变动值）；数据缓存在 `logs/panel-state.json` |
| 试用额度 | 取最近一次试用任务的输出（今日已申请 / 剩余次数） |
| 操作 | 检查账号、跑日常（13 个）、跑额外（24 个）、跑周末、手机试用（只看 / 申请）、**定向申请（输入框填 ID）**、刷新 Cookie（弹出的 Edge 窗口里扫码）、停止 |
| 运行输出 | 后台任务实时输出（任务串行，一次一个），结束后保留退出码 |
| 计划任务 | 一键注册/删除 `Faker3-Daily`（08:30）和 `Faker3-Try-Phone`（00:05） |
| 日志 | 下拉选择 `logs/*.log` 直接看最近 300 行 |

实现是零依赖单文件：`tools/panel-server.cjs`（Node 内置 `http` + 内嵌 HTML），不联网、不引入前端框架；
可用环境变量 `PANEL_PORT` 换端口。面板本身不存账号密码，只是读写同目录的 `.env` 和 `logs/`。

> 注意：面板进程关掉后网页就打不开了（重新双击 `panel.cmd` 即可）；想让「每天自动跑」不依赖面板，
> 用第 4 节的计划任务或 `daily.cmd`。
