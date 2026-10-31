# faker3 本地化运行版（Windows）

把 [shufflewzc/faker3](https://github.com/shufflewzc/faker3) 这套**青龙面板脚本**，做成 Windows 上双击就能跑的本地版：
不用装青龙、不用 Docker，补上了依赖、配置、运行器、Cookie 自动获取、图形面板和几个修好的功能。

> **说明**：本仓库是个人学习/自用备份，上游代码版权归原作者所有，且上游**没有开源许可证**。
> 公开此仓库仅为便于个人备份与查看，**请勿商用、请勿大范围传播**；如果原作者要求，会立即删除。

---

## 为什么有这么一个仓库

上游仓库是给青龙面板用的，直接克隆下来跑会遇到三个坑：

1. **没有 `package.json`** —— 直接 `node jd_xxx.js` 报 `Cannot find module 'got'`，要手工装 25 个依赖；
2. **不读 `.env`** —— 它靠环境变量 `JD_COOKIE`，本地跑要自己注入；
3. **2026 年京东网页登录不再下发 `pt_key`** —— 很多脚本开头用老接口自检 Cookie，直接判定「CK 已失效」，0.3 秒空转退出，看起来什么都没干。

本仓库把这三件事都解决了，并且**没有改动任何一个上游 `jd_*.js`**（`git diff upstream/main -- 'jd_*.js'` 为空）。

## 加了哪些东西

| 文件 | 作用 |
| --- | --- |
| `run.js` / `run.cmd` / `scripts.json` | 本地运行器：读 `.env`、按分组跑、超时控制、结果汇总、写日志 |
| `tools/compat-shim.cjs` | **兼容层**：绕过 `pt_key` 时代遗留的 `islogin` 自检，让脚本继续跑真实业务接口 |
| `tools/get-cookie.mjs` / `get-cookie.cmd` | **自动取 Cookie**：弹一个专用 Edge 窗口扫码登录，把整套 cookie（含 HttpOnly）写进 `.env` |
| `tools/panel-server.cjs` / `panel.cmd` | **本地管理面板**：<http://127.0.0.1:7373> 看账号/京豆/试用额度，点按钮跑任务、看日志、查看试用申请记录 |
| `tools/try-tool.cjs` / `try.cmd` / `try-phone.cmd` | **京东试用**：解析活动页 SSR 商品数据 + 本地 h5st 签名 + 提交申请（可只申请手机类） |
| `tools/local-h5st-server.cjs` | 本地 h5st 签名服务（试用脚本需要，自动拉起） |
| `tools/check-deps.js` / `tools/analyze-deps.js` | 依赖检查/分析小工具 |
| `package.json` / `pnpm-lock.yaml` | 25 个依赖，一条命令装齐 |
| `.env.example` | 配置模板（Cookie、通知、代理、试用参数） |
| `LOCAL-README.md` | 详细文档（12 节，含每个功能的原理、实测与限制） |

## 环境要求

- Windows 10 / 11
- Node.js 18+（实测 v24.21.0）；没装也行，`run.cmd` / `panel.cmd` 会自动探测常见安装路径
- 一个京东账号（扫码或账号密码登录）

## 五分钟上手

```bat
:: 1) 安装依赖（只需一次；pnpm / npm 都行）
pnpm install

:: 2) 取 Cookie：弹出专用 Edge 窗口，用京东 App 扫码登录，自动写进 .env
get-cookie.cmd

:: 3) 验证 Cookie：能打印出京豆/会员信息就说明有效
check-cookie.cmd

:: 4) 跑每日组（13 个脚本，约 2 分钟）
run.cmd --group daily
```

也可以直接双击 `panel.cmd` 打开管理面板，所有操作都有按钮。

## 管理面板

面板里还有一个「试用商品」表：直接列出活动页在架的试用商品和**活动 ID**，可以「复制ID」或点「申请」直接定向申请。
试用商品卡片顶部还有 **在架商品 / 已申请 / 申请成功（已中选）** 三个页签：「已申请」列出全部申请记录与状态，「申请成功」只看已中选的；在架商品中申请过的会自动标「已申请」。

双击 `panel.cmd` → 自动打开 <http://127.0.0.1:7373>（只监听本机，零依赖，页面内嵌在 Node 里）。

- 账号卡：`pin`、Cookie 段数/长度、`.env` 更新时间、登录态类型（新式 / 老式）
- 数据：当前京豆、今日变动、试用额度（已申请 / 剩余）
- 按钮：检查账号、跑日常、跑额外、跑周末、手机试用（只看 / 申请）、刷新 Cookie（扫码）、停止
- 实时运行输出、日志查看、试用申请记录（在架/已申请/已中选）

## 常用命令

| 命令 | 说明 |
| --- | --- |
| `run.cmd --list` | 列出所有分组和脚本（带中文名） |
| `run.cmd --group daily` | 每日组（13 个） |
| `run.cmd --group extra` | 额外组（24 个，活动类，受京东档期影响） |
| `run.cmd --group weekly` | 每周组（清券） |
| `run.cmd jd_bean_change.js` | 跑单个脚本 |
| `run.cmd --group daily --dry-run` | 只预览不执行 |
| `run.cmd --group daily --no-compat` | 关闭兼容层（回到上游原始行为） |
| `get-cookie.cmd` | 重新扫码获取 Cookie |
| `try-phone.cmd` | 申请试用（只筛手机类，`--dry-run` 只看不申请） |
| `try.cmd --aid <ID>` | 定向申请：直接给试用商品的活动 ID（App 里看到想要的，复制 ID 即可） |
| `panel.cmd` | 打开管理面板 |

分组一览：`daily` 13、`weekly` 1、`extra` 24、`help` 5、`stale` 6、`tools` 3、`special` 1（`jd_try` 上游版，需外部签名服务，本仓库用 `try.cmd` 替代）。

## 已知限制

- **2026 年起京东网页登录不再下发 `pt_key`**：上游按老格式写的自检接口会恒判 Cookie 失效，
  已由 `tools/compat-shim.cjs` 绕过；`jd_ttgd` / `jd_qy_sign` / `jd_dwapp` 等脚本背后的接口仍不认新 Cookie。
- `jd_CheckCK.js` 恒定误报「已失效」（它只认 `pt_key`），已从每日组移出，用 `check-cookie.cmd` 代替。
- 上游 `jd_try.js` 依赖的试用列表接口返回 **403**，本仓库改用「解析活动页服务端渲染数据 + 本地 h5st 签名」实现，见 `try.cmd`。
- 试用每天有申请次数上限（通常 5 次），超额会返回「您的申请次数已超过上限」。
- 活动类脚本依赖京东活动档期，过期的统一放在 `stale` 组。
- 京东风控/接口随时可能变化，**不保证任何收益**。

## 安全提醒

- `.env` 和 `.jd-profile/` 里是**完整登录凭证**（`thor` / `light_key` / `sdtoken` / `pin`），
  已加入 `.gitignore`，**永远不要提交、截图或发给别人**。
- 本仓库上传前已清空 `.env`、删除浏览器配置目录，仓库内不含任何 Cookie。
- 管理面板只监听 `127.0.0.1`，不对外网开放；但同一台电脑上的人可以打开它。

## 免责声明

本项目仅为个人学习、自动化脚本研究之用。上游代码版权归 [shufflewzc/faker3](https://github.com/shufflewzc/faker3) 作者所有；
使用自动化脚本可能违反京东用户协议并带来账号风险（限流、风控、黑号等），**一切后果自负**。
如原作者认为本仓库不妥，请联系删除。

## 详细文档

- [`LOCAL-README.md`](LOCAL-README.md) —— 安装、Cookie、分组、定时任务、兼容层原理、试用实现、面板说明、排错
