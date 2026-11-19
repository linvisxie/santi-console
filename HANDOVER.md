# 三体控制台 · 交接文档

> 最后更新：2026-10-26。本文档面向接手开发的 Agent/开发者，覆盖架构、启动、
> 各功能实现位置、已知坑与经验。配合根目录 README.md 一起阅读。

## 1. 它是什么

「三体控制台」是一个 Electron 桌面应用，把三个本机 AI Agent（Codex CLI、
WorkBuddy CLI、DSH）的项目与会话聚合到一个界面里：统一对话、实时观察
（监控台）、额度/用量、文件产物等。三体自身不跑模型，只是三个 Agent 的
「驾驶舱」—— 数据永远以各 Agent 的本地文件为准。

## 2. 目录布局（全部东西在哪）

```
D:\santi-console\
├── runtime\                    Electron 运行时（三体控制台.exe 在 runtime\）
│   └── resources\app\          ★ 应用本体（改这里）
│       ├── main.js             桌面壳：拉起 server、开窗口、ipcMain
│       ├── preload.js          contextBridge：setOverlayColor/openExternal/revealFile
│       ├── server.mjs          ★ 本地服务（127.0.0.1:7788）：全部后端逻辑
│       ├── public\
│       │   ├── index.html      工作台页面
│       │   ├── app-ui.js       工作台前端（约 2000 行）
│       │   ├── app.css         工作台样式
│       │   └── monitor\        监控台独立页（app.js/style.css/index.html）
│       ├── .console-state.json 归档/置顶/别名/hiddenProjects（用户状态）
│       └── .uploads\           用户上传的附件落盘
├── bridges\wb-bridge\server.mjs     WorkBuddy 的 MCP 桥接
├── bridges\dsh-bridge\server.mjs    DSH 的 MCP 桥接
├── tools\                      诊断/验证脚本（node 直接跑）
│   ├── perf.mjs                帧率测量
│   ├── shot.mjs                CDP 截图（需 --remote-debugging-port=9224 启动）
│   ├── err-collect.mjs         收集页面运行时异常
│   ├── frame-diag.mjs          iframe 加载诊断
│   └── verify-*.mjs            各功能端到端验证
└── README.md                   性能与 GPU 的详细记录
```

**不在 santi-console 里的东西**（三体只是读取者）：
- Codex 会话：`C:\Users\<user>\.codex\sessions\...jsonl`
- WorkBuddy transcript：WorkBuddy 自己管理（wb-bridge 读取）
- DSH 会话：`C:\Users\<user>\.dsh\`（zstd 帧 + 计数 json）
- 三个 Agent 的 MCP 桥接注册：`C:\Users\<user>\.codex\config.toml`

## 3. 启动 / 调试

```
双击 D:\santi-console\runtime\三体控制台.exe
```

- 开发调试：加参数 `--remote-debugging-port=9224`，然后浏览器开
  `http://127.0.0.1:7788`（同一服务）或用 tools\ 里的脚本。
- **GPU 策略（重要）**：`main.js` 默认 `disable-gpu-sandbox + no-sandbox`，
  硬件加速正常（144fps）。这台机器 GPU 沙箱会崩（exit_code=-1073741819），
  **不要**去掉 disable-gpu-sandbox；逃生门 `CONSOLE_SW=1` 回软件渲染。
- 改 server.mjs 需重启应用；改 public\ 下文件刷新即可（no-store）。
- 单实例：第二个实例会因 requestSingleInstanceLock 秒退，属正常。
  **强杀后可能有僵尸 node 子进程**（Get-Process node 查命令行），占着
  userData 缓存会让新实例「1 秒退出 + Unable to move the cache」，清掉即可。

## 4. 数据流与同步机制

- 三体的项目/会话列表 = **实时扫描**三个 Agent 的本地会话文件（collectSessions，
  server.mjs ~1031）。**Agent 桌面端新建/删除会话 → 三体自动同步**（文件扫描
  天然双向）。
- 删除会话（右键）= 真实删本地会话文件；原生桌面数据库是否清除索引，本轮未验证。
- 重命名/置顶/归档 = **视图层状态**（.console-state.json 的 aliases/
  pinnedSessions/archived），不影响 Agent 侧文件。
- 归档项目 = 当前代理在该路径下的会话打归档标（/api/archive-project）；其他代理不受影响。
- 删除项目 = **真实递归删除目录**（/api/delete-project，双重确认 + 路径校验：
  绝对路径、≥2 级深度、拒绝盘根/一级目录）。

## 5. 主要功能实现位置（app-ui.js）

| 功能 | 位置/说明 |
|---|---|
| 会话回放（Markdown） | paintThread + mdToHtml（escHtml 先转义防注入） |
| 回放实时同步 | paintThread 内 3s 轮询；消息指纹检测，重渲染限频 10s；解析缓存、在途合并；保留滚动位置 |
| 用量小字 | server token_count → 合并进前一条 assistant（m.usage）→ usageLine() |
| 链接外跳 | md 渲染 <a data-ext> → #messages 委托 → consoleNative.openExternal |
| 产物卡片 | sessionDetail 聚合 files（filePathOf）→ 折叠预览 2 个（files-more / files-less-top） |
| 粘贴图片 | promptEl paste → addAttFiles → /api/upload → renderAtts |
| 选中浮动条 | .sel-bar（复制 / 添加到对话引用） |
| 右键菜单 | .ctx-menu（会话：置顶/重命名/归档/删除；项目：重命名/归档/移除/删除） |
| 新建会话 | .proj-new 按钮 → startNewThread |
| 新建项目 | 行内输入（**Electron 无 window.prompt，别用**） |
| 搜索 | #sess-search 过滤树 + 归档命中区（arch-search-hits） |
| 导出 | btn-tb-export → Blob 下载 .md |

## 6. 已知的坑（前车之鉴，务必读）

1. **浮层 display 覆盖 [hidden]**：新增带 `display` 的浮层时必须同步写
   `[hidden] { display:none !important }`，否则遮罩常驻全界面点不动
   （lightbox/sel-bar/ctx-menu 已修，app.css 末尾）。
2. **Electron 没有 window.prompt / alert 尽量少用**：prompt 会静默无反应。
3. **异步回调里的状态必须 await 后重新校验**（S.thread.id === replayId）。
4. **长会话不再截头尾或限制 600 条**。JSONL / Codex .zst 逐行解析；DSH 逐帧解压。前端每 40 条让出事件循环，避免窗口后台时等待动画帧挂起。
5. 回放批量渲染时必须抑制逐消息滚动；切换、关闭或发送时取消旧批次。后台刷新不能再次 selectProject 清空回放。
6. **CDP 诊断**：tools\ 里的脚本都要应用带 --remote-debugging-port=9224。
   bash 内嵌 JS 模板串会被吃 ${}，复杂脚本一律写 .mjs 文件。
7. **CSS 动画性能**：大面积 backdrop-filter 叠加 + 背景持续动画在软件渲染
   下是灾难；硬件加速下无压力。用量行合并进消息底部（独立行会打断相邻去重）。
8. **tasklist 中文进程名匹配不到**（GBK 乱码），用 PowerShell
   `Get-Process | ? ProcessName -match '三体'`。
9. **强杀实例会留僵尸 node 子进程**（wb-bridge/dsh-bridge server），
   占 userData 缓存会让新实例 1 秒退出（Unable to move the cache）；
   Get-CimInstance Win32_Process 查命令行后清理。

## 7. 性能现状

硬件加速恢复后：工作台/监控台均 ~144fps、最差帧 <10ms。
历史优化（steps 跳变、用量合并、SSE 动画治理）的注释保留在 app.css /
monitor\style.css 末尾，硬件加速下它们仍是好习惯。

## 8. 用户偏好速览

- 界面语言全中文；dsh 一律显示为大写 DSH。
- 质感模式（玻璃 + 流动光斑）是默认且必须流畅。
- 消息排版对齐 WorkBuddy/Codex 桌面端：用户消息右侧气泡、完整消息、
  用量小字、产物卡片。
- 管理操作都要有确认与反馈（慢操作给 ⏳ 提示）。
- 产物卡片默认折叠只预览 2 个最相关文件（源码/文档优先，截图降权）。


## 9. Codex 修复与验收（2026-10-26）

本项目不使用 git-collab-sync。修复前文件保存在 `_archive/codex-20261026-before-repair/`。
验收入口与分项结果：`tools/CODEX_REPAIR_20261026.md`。

- 项目索引覆盖未压缩与 `.jsonl.zst`，取消最近 300/40/30 条上限；读取 Codex SQLite（只读）的项目根、名称、会话标题和归档信息。家目录会话也可见；不存在的工作目录仍可回放，执行时会明确拒绝，避免悄悄改用三体目录。
- 默认仍显示两个产物；修复未定义变量导致展开中断、重复收起按钮、路径省略显示及补丁多文件提取。
- 归档、重命名、置顶、移除、删除统一失效缓存；状态用临时文件加 rename 原子保存，失败返回错误；隐藏项目可在设置恢复。
- 归档项目按代理隔离；恢复压缩归档用三体视图覆盖，不写原生数据库。全归档项目退出活动列表。删除目录额外保护控制台、系统、代理数据和目录链接；已不存在的项目可正常从列表移除。
- 模型请求以序号丢弃过期响应；每个代理独立保存选择；模型列表取消人为截断；WorkBuddy/DSH 档位参数不再被发送端丢弃。
- SVG 加号居中；已归档默认折叠；设置在监控台左侧；点击任意非项目控件后退去项目高亮。
- 历史解析按 mtime/size 缓存、并发合并，最多保留三份；界面分批渲染，取消旧批次；刷新保持选中会话与侧栏滚动。

证据等级：40 项独立数据/API/Electron 界面断言通过，页面运行异常 0；真实旧压缩历史和长历史只读抽查通过。
未执行真实模型请求、未删除真实项目/会话、未修改原生 Agent 数据库；不据此宣称三个模型执行通道均端到端通过。

## 10. 日常工作台 2.0（2026-10-26）

完整实现/验收/阻塞/回退以根目录 WORKBENCH_DELIVERY_20261026.md 为准；此前章节的 exec/stdout 旧通道和关闭后不留后台的描述属于旧版本。

- 三家改走原生协议适配：Codex App Server；WorkBuddy/DSH ACP；原生 ID 持久续接。worker 独立于窗口和 HTTP 展示服务，活跃任务不随关窗终止；无连接/无任务闲置 90 秒退出。
- 持久数据在 runtime/resources/app/.workbench（可用 CONSOLE_WORKBENCH_DIR 隔离），store.json + events/*.jsonl；worker.json 是本机带令牌的内部身份，不要输出其 token。
- 新模块：lib/rpc.mjs、adapters.mjs、dsh-permission-guard.mjs、workbench-store.mjs、workspace.mjs、workbench-client.mjs、activity.mjs；入口 workbench-worker.mjs、public/workbench-ui.js/.css；HTTP /api/workbench/*。
- 默认并发 1、上限 3；同会话和同目录写任务串行。进程结束只标本轮结束，证据与未验证项另列。未知能力/认证失败不能算成功。
- 原输入框文案保留；独立草稿、引用附件、任务抽屉、文件/差异、最近访问、Ctrl+K、正文搜索、稳定阅读位置已接。
- 73 项隔离断言通过，Codex/DSH 真写文件与同会话续接通过，DSH 真实只读工具拒绝、完整 Electron 到原生 DSH 界面闭环通过。WB CLI 未登录，真实闭环受阻；不能以协议接通或空回复当真实执行成功。
- 不自动清理后台 worker、不改原生 Core/预设/账户、不使用 git-collab-sync；仅工作台拥有的 taskId 可受控停止。真实生产旧项目删除没有为测试而执行。


## 11. 液态玻璃与日用修复（2026-11-01）

2026-11-02 后续：`MCP_AND_MOTION_DELIVERY_20261102.md`。已接 27 工具的本地/HTTP MCP，原生适配器仍沿用既有实现；远程路由等用户决定，不自行公网开放。界面通道为 `automation-ui.js` / `ui-control.mjs`，不允许任意 JS 求值。流动光效恢复，右上角改为透明应用窗口控件。主进程、preload、server 需重开。凭证在 `.mcp/token`，禁止输出或加入交付样例；审计仅记录工具元数据。

后续视觉打磨已完成：`tools/VISUAL_REFINEMENT_20261101.md`。新增共享 `public/visual-refinement.css`，统一工作台/监控台的冰蓝青色香槟色、玻璃层级、字体间距、阅读列宽、侧栏、浮层及减少效果回退。34 项隔离 Electron 界面检查通过；不代表原生鼠标或长时帧率验收。备份 `_archive/visual-refinement-20261101/public`。WorkBuddy 仍按用户要求搁置。

最新说明：tools/TOOLBAR_GLASS_20261101.md、tools/DELIVERY_ICON_USABILITY_20261101.md。顶部操作已整理并统一液态玻璃；新增 liquid-glass.css。正式 exe/窗口/桌面图标已更新为用户确认的三颗玻璃体，新母版在 assets，原版备份在 _archive/icon-before-liquid-20261101。

新会话先为草稿，首次发送才创建；文件浏览不再要求空会话；任务抽屉不进入监控页，原生拖拽区冲突有 CSS 排除；右侧栏有直接关闭；新建项目通过原生文件夹选择器，Shift+点击可手动输入。DSH 按更新时间和最新原生标题索引，新增 lib/dsh-events.mjs 接真实工具/回复/思考事件。

本轮 51 项检查（25 服务回归、16 隔离 Electron/文件夹处理器、8 真实 DSH 只读、2 项目归属与合并流）通过。系统文件夹点选未做人工端到端测试；真实 OS 鼠标验证被用户 Esc 中断，不能宣称已完成。用户 DSH 未改动/重启。主进程与 preload 有改动，需用户重开三体加载，不要为部署强杀其窗口或原生代理。
