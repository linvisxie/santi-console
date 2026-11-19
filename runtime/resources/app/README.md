> 2.0 当前说明以根目录 WORKBENCH_DELIVERY_20261026.md、HANDOVER.md 第 10 节为准。原生协议 + 独立持久任务服务已取代旧 exec/stdout 通道；关窗后任务可继续。WorkBuddy 原生 CLI 未认证，不能称全部通道实机通过。

> 2026-10-26 Codex 接手说明：当前入口是 `D:\santi-console\launch.cmd` 或 `runtime\三体控制台.exe`。
> 以下 v3-v9 为历史记录；项目扫描上限和历史截断策略已经移除，DSH 正文和 Codex 压缩历史均支持读取。
> 最新实现和验收以根目录 HANDOVER.md 第 9 节、tools/CODEX_REPAIR_20261026.md 为准。

# 三体控制台 · 一体化界面

一个把 **Codex / WorkBuddy / dsh** 三套本地智能体收进同一个工作台的界面：
左边选项目，中间对话干活，右边看它们改了什么、预览效果。

- 主界面：<http://127.0.0.1:7788>
- 旧监控台（三栏指标版）保留在：<http://127.0.0.1:7788/monitor/>

## 启动

```cmd
cd C:\Users\<user>\WorkBuddy\2026-10-25-10-45-27\console
node server.mjs
```
或双击 `start.cmd`。换端口：`set CONSOLE_PORT=7799 && node server.mjs`。

---

## 模块规划 ↔ 实现对应

| # | 模块 | 规划思路 | 实现位置 |
|---|---|---|---|
| 1 | 主体对话区 | 消息按「谁说的」分层：用户右对齐气泡，代理回复带身份徽标，工具调用压成单行灰条，避免把执行细节和人话混在一起 | `public/index.html` `.messages`；`public/app-ui.js` `addMessage / addToolRow / addDimRow` |
| 2 | 模型选择器 | 选择器放在输入框工具条内，不用弹窗：先选代理再选模型，模型清单随代理切换动态拉取 | `.composer-bar` 的 `#agent` / `#model`；`GET /api/models?agent=` → `modelsFor()` |
| 3 | 左侧项目列表 | 项目不手填，从三个代理最近的会话 cwd 里反推（去重、剔除临时目录和家目录），再支持手动新建 | `projectCandidates()`；`GET /api/projects`、`POST /api/projects`；`renderProjects()` |
| 4 | 项目切换 | 切项目 = 换 cwd + 换改动上下文 + 换对话历史；历史按项目分别存在 localStorage | `selectProject()` / `histKey()` / `restoreHistory()` |
| 5 | 附件上传与预览 | 走 base64 单文件接口落盘到 `.uploads/`，前端立刻用本地 dataURL 出缩略图（不等服务端回图）；发送时把真实路径传给代理 | `POST /api/upload`；`#file` change → `renderAtts()`；发送时 `attachments[]` 进 `startChat` |
| 6 | 右侧改动面板 | 三层：代理分组 → 文件行（状态/±行数）→ 展开看 unified diff。可折叠：点击文件行原地展开，不跳页 | `collectChanges()` / `extractEdits()`；`renderChanges()` / `diffHtml()` |
| 7 | 右侧预览 | iframe 内嵌 + 地址栏 + 刷新 + 新窗口外开（应对 X-Frame-Options） | `#pane-preview`；`openPreview()` |
| 8 | 实时性 | 对话走 SSE（`run` 事件），改动面板 4s 轮询一次（编辑动作有 15s 缓存，够快也不打满磁盘） | `GET /api/stream`；`handleRun()`；`setInterval(loadChanges, 4000)` |

---

## 改动面板的数据到底怎么来的（重要）

分两条腿，按项目类型自动选：

**A. 项目是 git 仓库** → 权威来源
- `git status --porcelain=v1 -z` 拿文件与状态（新增/修改/删除）
- `git diff -U3` / `git diff --cached` 拿真实差异；未跟踪文件按整文件新增渲染
- 归属：拿文件相对路径去匹配三个代理最近 48 小时的编辑动作，取最近一次

**B. 不是 git 仓库**（当前工作区就是这种）→ 从会话还原
- WorkBuddy：`projects/<slug>/<session>.jsonl` 里的 `function_call`，工具名匹配 `Write/Edit/StrReplace/...`
  - `content` → 整文件新增式补丁
  - `old_string`/`new_string` → 裁公共前后缀后生成 hunk
- Codex：rollout 里的 `*** Begin Patch` 段，按 `*** Add/Update/Delete File:` 切开
- dsh：会话是 zstd 多帧压缩，正文不可解析 → 面板里会如实显示 0 改动

`byAgent` 汇总给出每个代理「几个文件 / +多少 / −多少」，就是右上角那行统计。

---

## Codex 额度：这一轮修了什么

上一版有两个问题，都改了：

1. **语义反了**。上一版把 `used_percent` 直接铺成进度条、只写「24%」，读起来像「剩下 24%」，
   而 Codex 本体显示的是**剩余**。现在：
   - 后端同时给 `usedPercent` 和 `leftPercent`
   - 界面主数字用**剩余**（`剩 65%`），副文本写「已用 35%」
   - 明确标注采样时间，例如「采样于 19:28」

2. **取数会取到旧的**。上一版按会话文件 mtime 挑文件、取文件里最后一条 `token_count`。
   但那个 226MB 的老会话会被桌面端持续续写，mtime 一直最新，里面的 `rate_limits` 却是旧回合的。
   现在：**在最近 4 个会话里，按事件自带的时间戳取最新的那条 `token_count`**，只有事件时间可信。

数据源就一个：`~/.codex/sessions/**/rollout-*.jsonl` 里 `event_msg.token_count` 的 `rate_limits`，
字段为 `primary`（5h 窗口）与 `secondary`（7d 窗口）的 `used_percent` / `window_minutes` / `resets_at`，
外加 `credits`。这是 Codex 自己写进会话的权威数值，第三方拿不到更准的。

WorkBuddy 和 dsh 的「剩余额度」本地没有落盘（在云端账户），所以面板只展示**今日用量**，不编百分比。

---

## 接口

```
GET  /api/projects           项目候选
POST /api/projects           {path} 新建（不存在则 mkdir）
GET  /api/changes?root=      改动 + 差异 + 归属
GET  /api/models?agent=      代理的模型清单
POST /api/upload             {name, dataUrl} → 落盘并返回绝对路径
POST /api/chat               {prompt, cwd, agent, model, mode, attachments[]}
POST /api/chat/stop          {runId}
GET  /api/stream             SSE：state / feed / run
GET  /api/state              快照（含额度）
```

`agent` 取值 `codex | workbuddy | dsh`，分别拉起：
`codex exec --json` / `wb-bridge/cli.mjs -p` / `dsh delegate`（后者用 Electron 以 node 身份跑 cli.js）。

## 页面参数（调试用）

| 参数 | 作用 |
|---|---|
| `?theme=dark` | 暗色 |
| `?snap=1` | 不连 SSE，只取一次数据（截图用） |
| `?open=1` | 自动展开第一条差异 |
| `?fixture=1` | 渲染三条样例消息，仅用于界面校验，不写历史 |

## 已知限制

- **dsh 的改动看不到**：会话正文是 zstd 多帧，Node 内置解码只出第一帧。要正文得引第三方 zstd 解码。
- **非 git 项目的「删除」检测不到**：没有基线快照，只能从编辑动作正向推断。
- **预览受限于 iframe**：目标站点设了 `X-Frame-Options` 就会白屏，用「新窗口打开」。
- **WorkBuddy 对话不走连接器**：`--strict-mcp-config` 跳过 MCP 启动以换取响应速度，腾讯文档类工具在对话里用不了（委托工具仍可用）。
- **一次只跑一个任务**：三家的 CLI 都是独占进程，并发会互相抢额度和锁。

## 截图

- `ui-light.png` / `ui-dark.png`：三栏主界面（含展开的差异）
- `shot-light.png` / `shot-dark.png`：旧监控台

---

## 本轮修复（v3）

| 问题 | 原因 | 处理 |
|---|---|---|
| 左侧项目杂乱 | 平铺列出 12 个路径，名称与完整路径重复显示 | 按父目录分组，组头显示目录 + 数量，可折叠（状态记 localStorage）；项目行只留名字 + 代理标签，完整路径进 `title` |
| 监控台没有返回入口 | 当初只放了「监控台 ↗」单向链接 | 监控台左上角加「← 返回工作台」胶囊链接，header 改为横向排布 |
| 监控台要整页滚动 | 用了 `padding-bottom: var(--dock-space)` + 自然高度 | 改为 `height:100vh` 三段式 grid（头部/卡片/主区），`overflow:hidden`；活动流与右栏各自内部滚动，页面本身不滚动 |
| 监控台里多余的对话框 | v2 遗留的 `dock` | 整块移除（HTML + 事件 + CSS 规则），`run` 事件也不再监听 |
| 监控台一屏装不下 | 右栏三块面板叠起来过高 | 桥接并入额度面板底部（单行胶囊）、配置分组改两列、卡片去掉重复的额度条与摘要、去掉配置路径行 |
| 选择器展开白底看不清 | 用的是原生 `<select>`，弹层由系统绘制，暗色下无法控色 | 换成自绘下拉（`.dd` + `position:absolute` 玻璃浮层），配色跟主题变量走，选中项打 ✓，点外部或 Esc 关闭 |
| 缺推理档位 | 只传了 `-m` | 新增「档位」下拉（低/中/高/极高），走 `codex exec -c model_reasoning_effort="…"`；非 Codex 代理自动隐藏该选择器 |

### 额度口径再对齐

上一版虽然后端给了 `leftPercent`，但监控台前端仍把 `used_percent` 当主数字、进度条按已用填充，
所以显示成「43%」——和 Codex 本体的「剩 57%」对不上。本轮统一为：

- 卡片里的额度条：主数字 `剩 57%`，条按**剩余**填充
- 额度面板：`剩 57%` / `剩 93%`，副注 `已用 43% · 2h23m 后重置`、`积分 无（订阅制）`、`采样 19:48`
- 剩余 ≤30% 转琥珀、≤10% 转红，靠剩余量判断而不是靠用量

数值仍来自 `~/.codex/sessions/**/rollout-*.jsonl` 中**事件时间最新**的那条 `token_count`。

### 相关参数

| 参数 | 作用 |
|---|---|
| `?snap=1` | 主界面不连 SSE，只取一次数据 |
| `?ddopen=1` | 自动展开模型下拉（校验样式用） |
| `?nolive=1` | 监控台不连 SSE（截图用） |

---

## 本轮改动（v5）

| 问题 | 处理 |
|---|---|
| WorkBuddy / dsh 没有推理档位 | 三家都给了档位，各自走不同参数：Codex `-c model_reasoning_effort`、WorkBuddy `--effort`、dsh `--patch` 覆盖 `agent-default-model.reasoningEffort`。档位集合按代理从 `/api/models` 下发（Codex/WB 5–6 档，dsh 3 档），不再是写死的一张表 |
| 左侧项目与三家真实项目列表不匹配 | 项目不再靠启发式扫描，改为统一会话索引 `collectSessions()`：Codex rollout 的 `session_meta.cwd`、WorkBuddy `projects/<slug>/*.jsonl` 的 `cwd`、dsh 会话头 `cwd`。三者按 cwd 归并成项目，带 `activeCount/archivedCount` |
| 项目不支持会话折叠 | 左栏变成三层：目录组 → 项目 → 会话。项目右侧箭头控制会话列表展开/收起，「收起」一键全收；状态存 localStorage |
| 不支持会话归档 | 每条会话 hover 出现「归档」，写入 `console/.console-state.json`；「设置 → 已归档会话」可恢复 |
| 右侧栏默认展开 | 默认折叠，状态写 `console-inspector`；头部 `▥` 与设置里的开关双向同步 |
| 缺明暗切换按钮 | 头部 `☾/☀` 一键切换；同时在左栏底部「设置」面板里有「亮色 / 暗色」分段器，监控台 iframe 会跟随主题 |
| 监控台入口是硬跳转 | 改成左栏底部「监控台」按钮，页内 `iframe` 覆盖切换（不刷新、不丢对话历史），带独立顶栏「← 返回工作台」，Esc 也能回；监控台内嵌时自动隐藏自己的返回按钮与主题按钮 |
| 会话标题看不懂 | 从会话首条真实提问取标题：WorkBuddy/Codex 会把提问包进 `system-reminder`，先抽 `<user_query>`；dsh 从 `agent/inbox/spliced` 取。取不到才退回 `会话 xxxxxx` |

### 顺带修掉的两个真问题

1. **dsh 会话正文现在能读了**：`session.v4.jsonl.zstd` 是「首帧带 magic + 其后 magicless 续帧」的逐帧追写格式，
   Node 的 `zstdDecompressSync` 只解第一帧（=175 字节的会话头）。实现了帧头解析 + 给续帧补 magic 再解，实测
   27KB 文件解出 6 帧全量内容，dsh 会话标题才可能是真的。
2. **WorkBuddy 通道会静默挂死**：内置 CLI 启动时要读注册表（`reg.exe`），在受限沙箱里被策略拦下且不报错。
   现在加了 120 秒看门狗，超时会明确提示「请在你自己终端跑 start.cmd」；停止/超时改杀整棵进程树（`taskkill /T`），
   不再留孤儿进程。

> 说明：WorkBuddy 对话通道在本会话的沙箱里跑不通（`reg.exe` 被平台策略拦，无法绕过），
> 这不是代码问题——dsh 通道已实测（`high` 档位 8.2 秒返回「在线」）。你在自己终端启动控制台即可正常用。

### 校验参数

| 参数 | 作用 |
|---|---|
| `?snap=1` | 不连 SSE（截图 / 排障），监控台 iframe 也自动带 `nolive` |
| `?sheet=1` | 直接打开设置面板 |
| `?monitor=1` | 直接切到监控台视图 |
| `?theme=dark` | 强制暗色 |

---

## 本轮修复（v6）：项目列表空 + 会话看不到正文

| 问题 | 根因 | 处理 |
|---|---|---|
| 项目有时候一个都不显示 | ①`/api/projects` 每个项目都起一次 `git rev-parse`，12 个项目要 3.5–4 秒，期间列表是空的；②前端 `loadModels().then(loadProjects)` 一旦模型接口抛错，项目永远不加载；③请求失败时静默吞掉，界面没有任何提示 | ①`isRepo` 缓存 10 分钟、项目列表整体缓存 8 秒（实测 3.1s → 0.48s → 0.002s）；②项目与模型解耦并行加载；③加骨架屏 + 25 秒超时 + 3 次退避重试 + 失败可见的「重新加载」按钮 |
| 只看到目录、看不到项目 | 组头可折叠，`console-fold` 里一旦留下 `false`，整组项目被 `display:none` | 组头改成纯分隔条（`pointer-events:none`，CSS 强制 `.group-body{display:flex}`），折叠层级只剩「项目 → 会话」；组名改成相对家目录（`~\WorkBuddy`），不再把多个 `C:/Users/...` 显示成一个样 |
| 会话点不开正文 | 之前会话行只是个死行 | 新增 `GET /api/session?id=` + 页内回放视图：用户/助手气泡分左右、工具调用灰条、可切「只看对话 / 含工具调用」、可「在这个项目里继续」；也支持深链 `?session=<id>` |

### 会话正文的读取策略

- ≤6MB：整份解析，完整对话
- \>6MB：读头部 2MB + 尾部 3MB，中间插一条「中间省略 X MB」分隔；头部保留最早的提问，尾部保留最近的进展
- 三家各自的解析：Codex `response_item` / `event_msg.item_completed`，WorkBuddy `message`/`function_call`，
  dsh `user/message`、`assistant/message`（含 `reasoning`）、`tool/call`
- **用户提问要先从 `<system-reminder>` 里抽 `<user_query>` 再判系统消息**，否则 WorkBuddy/Codex 的提问会被
  整条当成系统注入过滤掉（这就是"只能看到助手回复、看不到提问"的原因）

### 新增调试参数

| 参数 | 作用 |
|---|---|
| `?session=<id>` | 直接打开某条会话的正文（可收藏） |

---

## 本轮改动（v7）

| 反馈 | 处理 |
|---|---|
| 滚动条和液态玻璃不搭 | 全局 `::-webkit-scrollbar` 9px 胶囊：半透明白渐变 + 透明轨道 + 2px 内嵌留白，暗色单独一套；Firefox 走 `scrollbar-width/color` |
| 「收起」按钮没用 | 它原来只改项目级状态，当时项目本来就都收着，所以看不出变化。现在按钮文案随状态在**全部收起 / 全部展开**之间切换，并给 `aria-pressed` |
| 暗色下切监控台变亮色 | `applyTheme` 用 `STORE.set`（JSON）把主题写成带引号的 `"dark"`，而监控台 iframe 读的是裸值、比较失败回退亮色。改为写裸字符串；iframe 首次 `load` 后再 `postMessage` 同步一次 |
| 点会话会打开新页面 | 改成**在主区消息流里显示**：顶部一条会话条（代理徽标 / 标题 / 条数 / 时间 / 只看对话 / 关闭），下面就是历史消息；发消息即进入新一轮，历史自动收起 |
| 左侧分不清哪个项目属于哪个代理 | 重做成**三层折叠**：代理（Codex / WorkBuddy / dsh）→ 该项目在该代理下的真实项目 → 项目内的会话。数据来自三家各自的落盘：Codex `session_meta.cwd`、WorkBuddy `projects/<slug>`、dsh 会话头 `cwd` |
| 回放里混着 Codex 的提示词 | `response_item.message` 只认 `role=user/assistant`，`system/developer` 与 `AgentMessage(role≠assistant)` 一律丢弃 |

### 对话链路实测

```
POST /api/chat  →  started → thread → thinking → message「在线」→ usage → done
```

codex 通道已端到端跑通（读模式，约 30 秒）。三条通道的流式粒度不同，如实说明：

| 通道 | 流式粒度 | 说明 |
|---|---|---|
| Codex | 事件级 | `thread.started / thinking / item.completed(agent_message / command_execution) / usage / done`，没有 token 级 delta，前端用打字机补观感 |
| WorkBuddy | 原始 stdout 增量 | CLI 需要 `reg.exe`，只能在你自己终端启动控制台时可用 |
| dsh | 原始 stdout 增量 | 用 `--json` 可换成事件流，本轮未改 |

### 左侧折叠状态

- 代理层：`console-agent-open`，默认全展开
- 项目层：`console-open`，key 为 `agent|path`（同一目录在三个代理下各自独立）
- 会话层：跟着项目层，点项目右侧箭头收放

---

## 本轮修复（v8）：左栏点不动

| 症状 | 根因 | 处理 |
|---|---|---|
| 点项目名不展开/折叠 | 服务端 `agent.projects` 里**没有 `agent` 字段**，前端渲染出 `data-agent=""`；绑定事件时按 `path + agent` 查找项目，`''` 永远不等于 `'codex'`，直接 `return` 掉了 | 服务端为每条项目补 `agent`；前端渲染时也显式带上 `{...p, agent: p.agent || a.id}`，查找再加一层按 path 兜底 |
| 点会话没反应 | 同上——`if (!p) return` 在绑定 `.sess` 监听之前，所以会话行**根本没有监听器** | 同上；另外把点击项目名改成「选中 + 切换展开」，箭头单独切换 |

### 自测脚本

`verify-ui.mjs` 用 CDP 真机点击，不用靠猜：

```bash
# 1. 起一个带调试端口的窗口
chrome --headless=new --remote-debugging-port=9222 --user-data-dir=/tmp/cdp1 http://127.0.0.1:7788/
# 2. 跑验证（可传 codex / workbuddy / dsh）
node verify-ui.mjs workbuddy
```

它依次检查：`.pnode` 的 `data-agent` 是否正确、点项目名后会话是否可见/隐藏、
点会话后主区是否出现消息与标题、以及页面是否有 JS 报错。

实测结果：

```
codex      5 条消息 · 标题「只回复两个字：在线」
workbuddy 47 条消息 · 标题「你好」
dsh        2 条消息 · 标题「只回复两个字：在线」
页面错误：[]
```

---

## 本轮修复（v9）：长消息挤掉输入框 / 三栏滚不动 / 监控台滚动条

**同一个根因：flex/grid 子项默认 `min-height: auto`。**

1. `.main`（grid 子项）没有被允许收缩，`.messages` 里的长消息把它顶高，
   整个主区超出 100vh → 底部输入框被推出视口，且 `.messages` 自己永远滚不动。
2. `.rail` / `.inspector` 同理：内容一多就把容器撑高，里面的 `overflow-y: auto` 拿不到高度，
   左右两栏就"卡住"了。
3. `.changes-list` 这类滚动容器，其直接子项默认 `flex-shrink: 1`，
   内容被压缩再被 `overflow: hidden` 裁掉，`scrollHeight == clientHeight`，滚动条根本不出现。

修法：

```css
.shell, .rail, .inspector, .main { min-height: 0; }
.main { overflow: hidden; }
.main-head, .thread-bar, .composer-wrap { flex: 0 0 auto; }
.messages { flex: 1 1 auto; min-height: 0; overflow-y: auto; }
.messages > *, .changes-list > *, .projects > *, .insp-body > * { flex: 0 0 auto; }
.insp-body > .changes-list { flex: 1 1 auto; }   /* 滚动容器本身要保持伸缩 */
```

再加上 `overflow-wrap: anywhere` + `word-break: break-word`，超长路径/URL 也会换行而不会横向撑破。

**监控台**：`public/monitor/style.css` 是独立样式表，之前没继承工作台的滚动条规则，
现在补了一份一模一样的（9px 胶囊 / 半透明渐变 / 暗色单独一套），并给 `.feed/.side/#cfg/.grid`
补了 `min-height: 0`。

### 回归脚本

```bash
node verify-layout.mjs   # 注入 30 条超长消息 + 24 个改动卡片，量 contract
```

实测：

```
右栏改动列表  scrollHeight 2033 / clientHeight 683  可滚 ✓
主区消息      scrollHeight 2316 / clientHeight 611  可滚 ✓
输入框        bottom 792 < 视口 804                 可见 ✓
```
