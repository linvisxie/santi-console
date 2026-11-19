# dsh-bridge

把本机的 **dsh（DeepSeek Harness）** 暴露成一个可被 **Codex** 调用的子智能体：
Codex 干主流程，需要时调一次 `delegate_to_dsh`，把一段活交给 dsh，拿回结果。

与隔壁 `wb-bridge`（把 WorkBuddy 接给 Codex/dsh）同一个思路，只是执行端换成了 dsh。

## 文件

| 文件 | 作用 |
|---|---|
| `server.mjs` | MCP (stdio) 服务，提供 `delegate_to_dsh` / `dsh_status` |
| `selftest.mjs` | 自检：握手 → 列工具 → 查状态（`--delegate "任务" [--cwd 目录]` 可实测） |

## 关键前提：`delegate` 这个 profile

dsh 官方的 `headless` profile 默认走 `deepseek-official` 路由，需要 `DEEPSEEK_API_KEY`，
而本机 `.credentials.yaml` 里那条 ref 指向一个不存在的记录（悬空），所以直接跑会报
`MISSING_CREDENTIAL`。

同时，桌面端在用的 qoder / codex-subscription 这些 provider 来自**只装在 desktop profile
目录下**的市场插件，headless profile 看不见它们。

解决办法：新建一个专用 profile `delegate`（`~/.dsh/profiles/delegate`），从官方 headless
模板派生，再把 qoder provider 插件以 `file:` 方式复用进来（硬链接自 pnpm store，
不需要联网重装）。**desktop profile 一个字节都没动。**

```
~/.dsh/profiles/delegate/package.json
  dsh.profile.bundles:
    - @deepseek-ai/dsh-base
    - @deepseek-ai/dsh-headless
    - @eghrhegpe/dsh-connect-qoder      # 复用桌面端的 qoder 登录

~/.dsh/profiles/delegate/cordis.patch.yml
  agent-default-model:
    provider: qoder-cn
    model: DeepSeek-Flash
```

顺带的好处：命令行里也能直接用了 ——

```
dsh delegate "把这份 markdown 转成 pptx"
```

### 其他可选模型

把 `cordis.patch.yml` 里的 `provider` / `model` 换掉即可，desktop 里启用过的 qoder 模型有：
`Qwen3.8-Max`、`Qwen3.8-Flash`、`DeepSeek-Flash`、`GLM-5.3`、`GLM-5.3-Flash`、`Kimi-K3`、`MiniMax-M2.7`。

若想改用 DeepSeek 官方账号路由（`deepseek-account`），需要请求目标与账号 token 的 issuer
匹配，本机实测会报 `ACCOUNT_SIGN_IN_REQUIRED`，所以默认没用它。

## Codex 接入

`~/.codex/config.toml`：

```toml
[mcp_servers.dsh]
command = 'C:\Users\<user>\AppData\Local\Programs\nodejs\node.exe'
args = ['C:\Users\<user>\dsh-bridge\server.mjs']
startup_timeout_sec = 60
tool_timeout_sec = 3600
```

查证：`codex mcp get dsh`。重启 Codex 生效。

## 工具参数

### `delegate_to_dsh`

| 参数 | 说明 |
|---|---|
| `task` | 必填。自包含的任务描述（dsh 看不到 Codex 的对话） |
| `cwd` | 工作区绝对路径，dsh 以此目录为 `process.cwd()`，实测生效 |
| `timeout_sec` | 默认 1800，最大 5400 |

### `dsh_status`

报安装路径、dsh 版本、`delegate` profile 是否就绪。

## 实现要点

- **不经过 `.cmd`**：直接 `DeepSeek Harness.exe` + `ELECTRON_RUN_AS_NODE=1` +
  `--expose-internals <app.asar 内的 cli.js>`，避开 cmd.exe 的引号/中文转义坑。
- **asar 内文件不可 stat**：普通 node 的 `fs.existsSync` 看不到 `app.asar` 包内路径，
  所以只校验 `DeepSeek Harness.exe` 与 `resources/app.asar` 是否在，包内路径交给 Electron 解析。
- **环境白名单**：只放行系统变量 + `DSH_HOME`，避免继承宿主注入的会话变量。
- **stdout 洁净**：JSON-RPC 独占 stdout，日志走 stderr。

## 回滚

删掉 `~/.dsh/profiles/delegate` 整个目录，再从 `~/.codex/config.toml` 移除
`[mcp_servers.dsh]`（或 `codex mcp remove dsh`）。不影响桌面端。
