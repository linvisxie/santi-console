# WorkBuddy Bridge

把本机的 WorkBuddy 智能体暴露成一个可被 **dsh（DeepSeek Harness）** 和 **Codex** 调用的子智能体。
它们各自干主流程，遇到需要 WorkBuddy 做的部分（写 docx/xlsx/pptx、长文排版、调它的技能与连接器、
联网检索整理），调一次 `delegate_task` 把这段活交出去，拿回结果。

## 目录内容

| 文件 | 作用 |
|---|---|
| `server.mjs` | MCP (stdio) 服务，对外提供 `delegate_task` / `workbuddy_status` |
| `paths.mjs` | 定位 WorkBuddy 内置 CLI 的共用逻辑 |
| `cli.mjs` | 终端入口：把参数原样转给内置 CLI，并补齐启动环境 |
| `selftest.mjs` | 自检：握手 → 列工具 → 查状态（可加 `--delegate "任务"` 实测委托） |
| `wbcli.cmd` | 快捷方式：`wbcli` 进入交互界面，`wbcli -p "问题"` 单次问答 |
| `wbacp.cmd` | ACP 入口：给支持 ACP 的客户端用（见下文） |

## 一次性准备：登录

内置 CLI 与桌面端的登录态不一定共享，首次需要授权一次：

```
cd C:\Users\<user>\wb-bridge
wbcli
# 进入界面后输入 /login，按提示在浏览器完成授权，然后退出
```

确认已登录：

```
node selftest.mjs
```

看到 `登录状态：已登录` 即可。
若一直失败，可改用官方独立 CLI：`wbcli install`（会下载原生构建），然后重跑自检。

## 已经接好的两个客户端

### Codex

`~/.codex/config.toml` 里已写入：

```toml
[mcp_servers.workbuddy]
command = 'C:\Users\<user>\AppData\Local\Programs\nodejs\node.exe'
args = ['C:\Users\<user>\wb-bridge\server.mjs']
startup_timeout_sec = 60
tool_timeout_sec = 1800
```

查证：`codex mcp get workbuddy`。Codex 重启后生效，它会自己拉起这个服务。

### dsh（DeepSeek Harness）

`~/.dsh/profiles/desktop/cordis.patch.yml` 末尾追加了 `mcp-workbuddy` 一项
（`@deepseek-ai/dsh-mcp-client`，stdio，超时 30 分钟）。改的是 patch 文件、原有注释与条目未动。
**需要重启 dsh** 才会加载。

回滚：删掉文件里 `# === workbuddy-bridge MCP BEGIN ===` 到 `END` 之间那段即可，
或从同目录的 `cordis.patch.yml.bak-workbuddy-*` 还原。

## 工具说明

### `delegate_task`

| 参数 | 说明 |
|---|---|
| `task` | 必填。自包含的任务描述：背景、目标、约束、期望产出（含文件路径/格式） |
| `cwd` | 工作目录绝对路径，WorkBuddy 以此为根读写并默认把产出放这里 |
| `write` | 默认 `true`。设 `false` 则只分析不落盘 |
| `model` | 可选模型 ID，如 `deepseek-v4.1-flash` / `deepseek-v4-pro` / `glm-5.3` |
| `timeout_sec` | 默认 1500，最大 3600 |
| `use_connectors` | 默认 `false`。设 `true` 才加载腾讯文档/企业微信/邮箱等 MCP 连接器（启动会慢十几秒） |

### `workbuddy_status`

自检 CLI 路径、版本、登录态。委托报错时先调它。

## 设计要点

- **环境白名单**：WorkBuddy 桌面端会给子进程注入几十个 `CODEBUDDY_*` 变量（含宿主标记）。
  原样透传会让 CLI 误以为自己被桌面端托管，去等一个不存在的宿主通道，表现为**无输出挂死**。
  所以只用白名单传系统变量 + 三个必要的 `CODEBUDDY_*`。
- **stdout 洁净**：MCP stdio 的 stdout 只能跑 JSON-RPC，所有日志走 stderr。
- **默认跳过连接器**：省十几秒启动，并避免某个连接器卡住拖垮整次委托。
- **CLI 路径不写死**：按 `WB_CLI_ENTRY` → `C:..H:\workbuddy\resources\...` → `%LOCALAPPDATA%\Programs\WorkBuddy` 顺序探测，
  桌面端升级换目录也能找到。

## ACP 通道（备用）

内置 CLI 支持 ACP：

```
wbacp.cmd          # 等价于 node cli.mjs --acp，ndJson over stdio
```

任何 ACP 客户端（Zed 等）都能把它当 agent 后端拉起。若要接入 **dsh**，
需要 `@deepseek-ai/dsh-subagent-acp` 这个插件包——你当前的 dsh 构建里没有随包发布
（只有 `dsh-subagent-fork-in-process` / `dsh-subagent-spawn-in-process`），
所以 dsh 侧目前走的是上面的 MCP 通道。装了那个包之后，把 `wbacp.cmd` 填进它的
`command` 即可复用同一条 ACP 链路。
