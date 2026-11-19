# 流动玻璃、窗口按钮与 MCP 交付

## 液态玻璃流动感

- 大面板新增可见的反光流动：输入框约 7 秒一个周期，其他面板 9–13 秒错开，避免同步闪烁。
- 光效只作用在装饰层，不改变面板尺寸、内容位置或阅读滚动；鼠标移动产生局部反光，最多 30Hz 更新一个面板。
- 流畅模式、系统减少动效/减少透明度时停止相应效果。未让巨大背景模糊层持续移动。
- `tools/glass-flow-results.json` 记录了不同时刻实际绘制不同、动画名和 4 秒离屏帧采样。采样约 60fps，不等同于正式窗口长期性能保证。

## 右上角窗口按钮

固定深色原生按钮底块改为透明的应用内窗口按钮，直接透出所在页面的底色。按钮通过受限 preload IPC 执行最小化、最大化/还原、关闭；标题栏拖动继续保留。明暗主题使用页面文字色，关闭按钮悬停红色。

这不是 Windows 原生标题栏按钮，原生最大化按钮悬停的系统布局浮窗不由本项目模拟。窗口按钮可由 MCP 的可见控件操作。渲染器命中检查在 `tools/window-controls-results.json`；真正主进程/预加载 IPC 验证在 `tools/caption-native-results.json`，未代替真实鼠标人工测试。

## MCP

入口 `bridges/santi-mcp/server.mjs`，共 27 个工具。项目/会话管理、历史、消息/任务、审批、文件/改动、附件、状态与界面控制均已接入现有实现。

- 本机配置：`bridges/santi-mcp/grokbot-local.json`。
- HTTP：`http://127.0.0.1:7790/mcp`，强制 Bearer；启动/停止脚本在同目录。
- 连接步骤、每项工具与限制：`bridges/santi-mcp/README.md`。
- 远程地址待用户决定，未配置公网、隧道或防火墙。
- 官方客户端实连测试使用隔离后台和假原生模型适配器：43 项通过；原有工作台回归 25 项通过。不宣称真实 Grokbot 或三家模型本轮全部端到端验收。

## 加载

本轮修改了 `main.js`、`preload.js`、`server.mjs` 和前端，必须关闭并重新打开三体一次；仅刷新网页不能更新主进程。不要强杀后台原生代理。MCP 检测到旧服务时会明确提示重开。

## 修改范围

- `public/visual-refinement.css`、`glass-motion.js`：流动反光和透明窗口控件样式。
- `public/window-controls.js`、`main.js`、`preload.js`：窗口操作与截图。
- `public/automation-ui.js`、`lib/ui-control.mjs`、`server.mjs`：带超时、窗口身份及结果回执的 UI 通道。
- `bridges/santi-mcp/`：官方 SDK stdio/HTTP 服务、工具、连接配置、脚本和测试。
- `public/index.html`、`public/monitor/index.html`：脚本加载。

流动改动前的选定文件备份在 `_archive/mcp-motion-20261101`；上一轮完整前端备份在 `_archive/visual-refinement-20261101/public`，材质增强前备份在 `_archive/glass-depth-20261101`。本轮未改变三家账户、全局配置、原生 Core 或项目消息内容。
