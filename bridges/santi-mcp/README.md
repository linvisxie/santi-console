# 三体控制台 MCP

这是控制 `D:\santi-console` 的独立 MCP 服务，复用已有项目索引、持久任务服务、原生代理适配器和界面操作。不是另一套模型 API。

提供本机 stdio 与带 Bearer 凭证的 Streamable HTTP 两种接法。使用官方 `@modelcontextprotocol/sdk`；连接与工具调用已用官方客户端实测。工具共 27 个，资源 `santi://guide` 提供调用顺序和界面参数。

## 本机 Grokbot

1. 关闭并重新打开三体，加载新增的服务端、preload 和窗口控制代码。已提交任务由独立 worker 管理，关窗不等于停止任务。
2. 将同目录 `grokbot-local.json` 中的配置合并进 Grokbot 的 MCP 配置，不要覆盖其他 MCP。
3. 连接后先调用 `console_status`，再读取资源 `santi://guide`。

```json
{
  "mcpServers": {
    "santi-console": {
      "command": "C:/Users/<user>/AppData/Local/Programs/nodejs/node.exe",
      "args": ["D:/santi-console/bridges/santi-mcp/server.mjs"]
    }
  }
}
```

本机已有 Node.js 24。客户端通过 stdin/stdout 通信；诊断日志只进入 stderr。stdio 无需手动填写 Bearer，服务读取本机凭证。

这是常用 `mcpServers` 配置结构；如果 Grokbot 的具体版本采用不同配置字段，应保留同一 command/args 并按该客户端格式录入。尚未操作 Grokbot 本身的配置或验收其客户端连接。

## HTTP / 远程准备

启动本机回环监听：

```powershell
& D:\santi-console\bridges\santi-mcp\start-http.ps1
```

入口：`http://127.0.0.1:7790/mcp`。同目录 `grokbot-http.template.json` 是连接模板。

每个 HTTP 请求必须携带 `Authorization: Bearer <凭证>`。凭证文件：

`D:\santi-console\runtime\resources\app\.mcp\token`

凭证由加密随机数生成，Windows 文件 ACL 只授予当前用户和 SYSTEM；不会写入示例配置、测试报告或聊天。请在本机将文件内容填入客户端的凭证字段。持有此凭证的客户端拥有这些工具的完整权限。

远程路由待用户选定，当前没有开放公网、修改防火墙、配置域名或创建隧道。将来可选：

- **SSH 隧道**：远端运行 `ssh -N -L 7790:127.0.0.1:7790 用户@这台Windows的可达地址`，远端 MCP 客户端连接其自己的 `http://127.0.0.1:7790/mcp`，仍需 Bearer。前提是已有可用 SSH 服务和访问权限；此项目不会自动安装。
- **HTTPS 反向代理/隧道**：后端继续监听本机 7790，把 `/mcp` 转发到它；设置 `SANTI_PUBLIC_URL=https://实际域名`，重启 HTTP MCP，让它接受该 Host 和 Origin。客户端连接 `https://实际域名/mcp`。不要将控制台原始 7788 端口暴露出去。
- **直接 HTTPS**：设置 `SANTI_MCP_HOST`、`SANTI_TLS_CERT`、`SANTI_TLS_KEY` 和 `SANTI_PUBLIC_URL`，证书/私钥为 PEM 文件。非回环 HTTP 明文监听会被拒绝。

环境变量：

| 变量 | 默认 / 用途 |
| --- | --- |
| `SANTI_URL` | `http://127.0.0.1:7788`，只允许本机三体后端 |
| `SANTI_MCP_HOST` | `127.0.0.1` |
| `SANTI_MCP_PORT` | `7790` |
| `SANTI_PUBLIC_URL` | 实际 HTTPS 对外地址；未指定时不接受外部 Host/Origin |
| `SANTI_TLS_CERT` / `SANTI_TLS_KEY` | 直接 HTTPS 使用的 PEM 路径 |
| `SANTI_TOKEN_FILE` | 可覆盖凭证位置；控制台和 MCP 必须使用同一个位置 |

HTTP MCP 采用无会话 JSON 响应模式；没有另设旧 SSE 地址。等待任务输出使用 `task_wait`，而不是保持一个无限长的工具调用。服务不提供 OAuth/DCR 自动授权，需要支持自定义 Bearer 头的客户端。

停止由脚本启动的 HTTP 服务：

```powershell
& D:\santi-console\bridges\santi-mcp\stop-http.ps1
```

停止脚本检查 PID 对应的程序及入口，不停止三体或其代理任务。未安装开机启动项。退出三体会关闭其 UI HTTP 服务；MCP 不会擅自重启应用，后续工具会明确提示服务不可达。后台 worker 中已接受的任务继续按原机制运行。

## 工具覆盖

| 事务 | 工具 |
| --- | --- |
| 总体状态、模型与原生端探测 | `console_status`, `models_list`, `agent_probe` |
| 项目增添、命名、归档、隐藏/恢复、真实删除 | `projects_list`, `project_manage` |
| 会话建立、导入原生续接、命名/置顶/归档、导出 | `conversations_list`, `conversation_create`, `conversation_import`, `conversation_update`, `conversation_export` |
| 原生历史命名、置顶、归档与删除 | `native_session_manage` |
| 历史正文与搜索 | `history_read`, `history_search` |
| 发送消息、收取输出与证据、等待、停止、审批、重试 | `message_send`, `task_read`, `task_wait`, `task_stop`, `task_answer`, `task_retry` |
| 并发上限 | `queue_settings` |
| 文件浏览、文本/二进制分页、带版本保护的保存、差异 | `files_list`, `file_read`, `file_save`, `changes_read` |
| 上传消息附件 | `attachment_upload` |
| 界面状态、可见控件、截图、页面和面板操作 | `ui_state`, `ui_control` |

`ui_control` 的 action 与 args：

| action | args |
| --- | --- |
| `snapshot` / `screenshot` / `refresh` | `{}` |
| `view` | `{ "view": "workbench" 或 "monitor" }` |
| `theme` | `{ "theme": "dark" 或 "light" }` |
| `performance` | `{ "mode": "full" 或 "lite" }` |
| `project` | `{ "path": "项目绝对路径", "agent": "codex" }` |
| `conversation` / `native_session` | `{ "id": "已读取的ID" }` |
| `new_conversation` | `{}`，仅切到草稿，不创建空会话 |
| `panel` | `{ "panel": "tasks/settings/files/inspector之一", "open": true }` |
| `draft` | `{ "text": "草稿正文" }`，不发送 |
| `scroll` | `{ "region": "messages/projects之一", "position": "top/bottom之一" }`，也可传 offset |
| `file` | `{ "path": "项目相对路径", "line": 10 }` |
| `activate` | `{ "controlId": "ui_state中的ID", "expectedLabel": "原控件标签" }` |
| `fill` | 同上，再加 `value`；不填写密码或系统文件输入框 |

窗口 ID 来自 `ui_state`。多个窗口时必须指定 windowId；一个窗口时可省略。控件文本变化后操作会拒绝，需重读状态。通用点击返回随后观察的界面，不保证它触发的异步任务已结束；优先使用项目、任务等明确工具。没有任意 JavaScript 执行接口。

### 推荐发消息流程

1. 选择已有工作会话 ID；或 `conversation_create` 建立一个明确的新任务会话。
2. `message_send`：提供 `conversationId`、`prompt`、`clientRequestId`（自己生成唯一值）、`mode`。重试同一发送请求必须复用 clientRequestId。
3. 保存返回的 taskId；用 `task_wait` / `task_read` 读取。`nextAfter` 用于下一页/下一次，不要重复拼接旧输出。
4. 出现 pending 时读取内容，再通过 `task_answer` 传原 taskId/requestId。`permission` 只接受明确 true/false。
5. `finished` 仅表示该轮执行结束，是否实现需求仍需查看 evidence、检查失败项并验收。

### 文件与删除

`file_read` 按字节分页，返回 nextOffset/eof 和 version。每页的 version 应保持一致；发生变化须重新读取。`file_save` 需要原版本，冲突不覆盖磁盘；旧内容保存在工作台 file-versions 目录。保存针对现有文本文件，不提供完整 IDE 编辑/自动合并或任意 shell 执行功能。

真实删除项目/原生历史需要 confirmation 精确等于对应路径/ID；并继续遵循控制台现有受保护目录规则。删除的是实际目录/文件，隐藏与归档则使用相应操作。工具不会自行补确认值。

附件使用 base64 dataUrl，MCP 输入上限 8 MiB 字符（原始文件约 6 MiB）；大文件可作为项目文件引用。JSON HTTP 请求上限 10 MiB；不把超限数据截断后当成成功。

## 验证与边界

运行 `npm test --prefix D:\santi-console\bridges\santi-mcp`，会启动隔离 Electron、HTTP 服务、数据目录和假原生适配器，验证真实协议、存储与界面，不调用真实模型。

- 官方 SDK 客户端 stdio 和 HTTP 初始化、工具列表、资源、工具调用已通过。
- 测试结果：`tools/mcp-test-results.json`，具体覆盖和数量以文件为准。
- 任务执行测试使用假原生适配器；不能由此宣称三家真实登录、模型执行均已通过。WorkBuddy 按用户要求继续搁置。
- 系统文件夹选择、外部浏览器账号登录、其他软件的内部窗口不是此 MCP 的自动化范围。已知路径可用 project_manage 直接添加。
- 界面必须在线才能截图、切换和操作。截图只包含三体内容；状态带 observedAt，窗口离线或操作超时会报错。
- 当前未接入真实 Grokbot，远程域名/隧道/TLS 路由也待用户决定；仅 HTTP 协议在本机实连通过。
- 操作审计在凭证同目录 `audit.jsonl`，仅记工具名、请求 ID、时间及结果类别，不记录参数、正文或凭证。

依赖与协议参考：[MCP 官方 SDK](https://github.com/modelcontextprotocol/typescript-sdk)、[MCP stdio / Streamable HTTP 传输规范](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports)。
