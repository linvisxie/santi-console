# 三体控制台 · 桌面版

一个双击就能用的本地应用，把 Codex / WorkBuddy / dsh 三家放在同一个界面里：
左侧三层（代理 → 项目 → 会话），中间对话与流式输出，右侧改动与预览，另有监控台。

新增 **MCP 控制入口**（本机 stdio / HTTP）：[连接与工具说明](bridges/santi-mcp/README.md)。[本轮交付：流动玻璃、透明窗口按钮与 MCP](MCP_AND_MOTION_DELIVERY_20261102.md)。主进程有更新，首次使用需重开三体。

全部在 **D 盘**，不占 C 盘。

> **GitHub 仓库只放源码。** `runtime/` 下的 Electron 二进制（369MB 的 exe、dll、pak、locales）
> 超出 GitHub 单文件限制，已由 `.gitignore` 排除；本地会话、附件、任务快照、快照 blob、
> QA 截图与临时测试目录同样不入库。从仓库克隆到新机器时，把源码放回
> `runtime/resources/app/` 再配一份 Electron 运行时即可，见文末「从仓库恢复运行环境」。

---

## 怎么启动

| 方式 | 位置 |
|---|---|
| 桌面快捷方式 | `D:\桌面\三体控制台.lnk`（唯一入口，有专属图标） |
| 直接双击 | `D:\santi-console\runtime\三体控制台.exe` |
| 命令行 | `D:\santi-console\launch.cmd` |

启动器会先拉起本地展示服务（7788），端口通了才开窗口。2.0 的任务服务独立运行：关窗后已接收任务继续；无任务且无界面连接闲置 90 秒才退出。需要终止时请先点任务里的停止。
启动器还会自检：等 8 秒看 7788 起没起，没起来就前台运行，让你能直接看到报错。

也可以用浏览器访问 `http://127.0.0.1:7788`。

> **.cmd 文件必须存成 GBK + CRLF。** 中文版 Windows 的 cmd.exe 按 ANSI 代码页（GBK）
> 解析 .cmd，UTF-8 会让脚本里的中文路径变成乱码，`start` 直接报
> 「不是内部或外部命令」（错误码 9009）。改启动器请跑 `tools/make-launcher.py`，
> 别手工用 UTF-8 编辑。

> 启动器会先清掉 `ELECTRON_RUN_AS_NODE` / `NODE_OPTIONS`。
> 带着 `ELECTRON_RUN_AS_NODE=1` 启动，Electron 会把自己当成普通 node，秒退。

## 2.0 交付与验收

完整逐项说明见 [WORKBENCH_DELIVERY_20261026.md](WORKBENCH_DELIVERY_20261026.md)。73 项隔离断言通过；Codex、DSH 真实续接与写文件验证通过，DSH 完整界面执行链路通过；WorkBuddy 原生 CLI 未登录，真实执行受阻，界面提供原生登录入口。输入框原文案保留。

工作台新增原生连续会话、独立草稿、任务/审批抽屉、文件与差异、正文搜索、最近访问、受控队列和阅读位置保护。Ctrl+K 快捷切换；Ctrl+N 新建会话。

## 快捷键

| 键 | 作用 |
|---|---|
| F11 | 全屏 |
| Ctrl+R | 刷新界面 |
| Ctrl+Shift+R | 强制刷新（改了样式没生效时用） |
| F12 | 开发者工具 |
| Ctrl+Q | 退出 |

## 目录结构

```
D:\santi-console\
  runtime\                    Electron 运行时（369MB，别乱动）
    三体控制台.exe
    resources\app\            ← 应用本体，改代码改这里
      main.js                 桌面壳（拉起服务、开窗口、退出清进程）
      server.mjs              本地服务（采集 + SSE + 执行）
      public\                 界面（index.html / app.css / app-ui.js / monitor\）
      README.md               界面与数据源的技术说明
  bridges\                    给 Codex 调用的两个 MCP 桥接
    wb-bridge\                delegate_task（→ WorkBuddy）
    dsh-bridge\               delegate_to_dsh（→ dsh）
  tools\                      排查与维护脚本
    shot.mjs                  CDP 截图
    probe.mjs                 看页面加载状态
    perf.mjs                  量帧率 / 长任务 / 渲染负担
    nav.mjs                   强制导航 + 截图
    make-launcher.py          重新生成 .cmd 启动器（GBK + CRLF）
    make-lnk.py               重新生成桌面 .lnk 快捷方式
    make-icon.py              重新生成 app.ico 并更新快捷方式图标
  _archive\                   从 C 盘搬来的旧副本（确认没问题后可删）
  launch.cmd                  启动器（GBK 编码）
```

改 public 界面后按 `Ctrl+R` 即可生效；改主进程/服务/worker 需重启对应进程，活动任务期间不要强杀 worker。

## 从仓库恢复运行环境

仓库里只有源码，`runtime/` 的 Electron 二进制没有入库。新机器上：

1. 克隆仓库，把 `runtime/resources/app/` 整个目录保留原位置。
2. 取一份与本机版本一致的 Electron（`runtime/version` 里记录了版本号），
   把 `electron.exe` 改名为 `三体控制台.exe` 放进 `runtime/`，或直接用
   `npx electron runtime/resources/app` 启动调试。
3. 需要双击入口时，用 `tools/make-launcher.py` 重新生成 `launch.cmd`（GBK + CRLF），
   用 `tools/make-lnk.py` 生成桌面快捷方式，`tools/make-icon.py` 更新图标。
4. 三家的原生 CLI（Codex / WorkBuddy / dsh）要各自在本机登录，三体只读取它们的
   本地文件与会话，不自带模型凭据。

桥接里的本机登录态（`bridges/wb-bridge/login-runtime/`）、`bridges/santi-mcp/grokbot-local.json`、
`runtime/resources/app/.mcp/token` 都不会提交，换机器需要重新生成或登录。

## 从 C 盘搬了什么

| 原位置 | 现位置 |
|---|---|
| `C:\Users\<user>\WorkBuddy\2026-10-25-10-45-27\console` | `D:\santi-console\runtime\resources\app`（旧副本在 `_archive\c-old\console`） |
| `C:\Users\<user>\wb-bridge`（66MB） | `D:\santi-console\bridges\wb-bridge` |
| `C:\Users\<user>\dsh-bridge` | `D:\santi-console\bridges\dsh-bridge` |

两个桥接的路径已写回 `C:\Users\<user>\.codex\config.toml`（改前备份 `config.toml.bak-move-*`），
`codex mcp get workbuddy` 能正确读出 D 盘路径。

## 已知情况

**历史性能记录（2.0 未重新测帧率）：硬件加速恢复后曾测 141~144 FPS。**
之前长期以为"这台机器 GPU 进程必崩只能软件渲染"（最低时 4 FPS），2026-10-26
归因后发现真正的崩溃源头是 **Chromium 的 GPU 沙箱**与本机环境（MuMu 虚拟显卡 +
AMD/NV 双显卡切换）冲突 —— 关掉 GPU 沙箱后硬件加速完全正常，还捎带修掉了一票
后台动画偷帧的问题（steps 跳变、SSE 动画治理，细节写在两个 css 末尾注释里）。

| 开关 | 作用 |
|---|---|
| `disable-gpu-sandbox` | **关键**：GPU 子进程崩溃的元凶就是它，关掉后零崩溃 |
| `no-sandbox` | 渲染器沙箱同样必须关，否则页面加载了但永远不响应 |

`main.js` 默认启用这套组合。逃生门：环境变量 `CONSOLE_SW=1` 强制回
纯软件渲染（若以后换环境导致组合失效用它兜底）。
帧率测量：`node tools/perf.mjs 9224`（需带 `--remote-debugging-port` 启动）。

**无边框窗口。** 系统标题栏（顶部蓝条）已去掉，`main.js` 用
`titleBarStyle: hidden` + 原生 `titleBarOverlay`（右上角最小化/最大化/关闭）。
按钮区颜色随明暗主题联动（`preload.js` + ipcMain）；顶栏是拖拽区，
内部按钮/下拉已排除；右上角控件横向避让按钮区。

**2.0 原生通道：** Codex 使用 App Server，WorkBuddy 与 DSH 使用 ACP；流式事件由独立任务服务持久保存。WorkBuddy 需要原生 CLI 认证，未认证会明确失败，不再用 stdout 退出冒充任务成功。模型/附件能力以原生可获得信息为准。

**端口被占用 / 遗留服务**：应用启动时会先问端口上的服务「你是谁」
（`/api/identify`，报 appDir 和 pid）。对不上当前代码的（旧版僵尸、
被强杀留下的孤儿）就自动清掉再起新的；服务本身每秒盯一次父进程，
桌面壳没了就自己退出还端口。这套机制解决的问题：`taskkill /F` 强杀时
`will-quit` 不执行，node 服务子进程会变成孤儿继续占 7788，
下次启动连上去看到的是搬目录之前的旧界面。

**排查脚本**（需要应用带 `--remote-debugging-port=9224` 启动）：

```
node tools/probe.mjs 9224      # 看页面加载状态、标题、节点数
node tools/perf.mjs 9224       # 量帧率、长任务、渲染负担
node tools/shot.mjs 9224 out.png "表达式"   # 截图，可先执行一段 JS
node tools/nav.mjs 9224 out.png url         # 强制导航 + 截图
```

