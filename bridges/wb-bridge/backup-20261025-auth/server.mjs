#!/usr/bin/env node
/**
 * workbuddy-bridge
 *
 * 一个零依赖的 MCP (stdio) 服务器，把本机 WorkBuddy 的 agent 引擎暴露成一个
 * 可被 dsh / Codex / 其它 MCP 客户端调用的"子智能体"工具。
 *
 * 对外工具：
 *   delegate_task      把一段任务交给 WorkBuddy 执行，返回结果文本
 *   workbuddy_status   自检：CLI 路径、版本、登录态
 *
 * 约定：
 *   - stdout 只允许承载 JSON-RPC 消息，任何日志一律写 stderr
 *   - 子进程环境变量做白名单清洗，避免继承 WorkBuddy 桌面端注入的会话变量
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { resolveCli, needsForceLiteBundle, workbuddyHome } from './paths.mjs';

const PROTOCOL_VERSION = '2024-11-05';
const SERVER_NAME = 'workbuddy-bridge';
const SERVER_VERSION = '1.0.0';

const DEFAULT_TIMEOUT_SEC = 1500; // 25 分钟
const MAX_TIMEOUT_SEC = 3600;

function log(...args) {
  process.stderr.write(`[workbuddy-bridge] ${args.join(' ')}\n`);
}

/* ------------------------------------------------------------------ *
 * 环境清洗
 * ------------------------------------------------------------------ */

// 用白名单而不是黑名单：WorkBuddy 桌面端会往它拉起的进程里注入几十个
// CODEBUDDY_* 变量（含托管/会话上下文）。原样透传给 CLI，它会误以为自己
// 被桌面端托管，从而去等一个并不存在的宿主通道，表现为无输出挂死。
// 因此只放行确定无害的系统变量 + 明确需要的 CODEBUDDY_* 三项。
const ENV_ALLOW_EXACT = new Set([
  'PATH',
  'Path',
  'PATHEXT',
  'SystemRoot',
  'SYSTEMROOT',
  'SystemDrive',
  'windir',
  'TEMP',
  'TMP',
  'HOME',
  'USERPROFILE',
  'HOMEDRIVE',
  'HOMEPATH',
  'USERNAME',
  'USERDOMAIN',
  'COMPUTERNAME',
  'APPDATA',
  'LOCALAPPDATA',
  'ProgramData',
  'ProgramFiles',
  'ProgramFiles(x86)',
  'CommonProgramFiles',
  'NUMBER_OF_PROCESSORS',
  'PROCESSOR_ARCHITECTURE',
  'PROCESSOR_IDENTIFIER',
  'OS',
  'LANG',
  'LC_ALL',
  'TZ',
  // 代理配置属于通用网络设置，保留（是否可用由 CLI 自己决定）
  'HTTP_PROXY',
  'HTTPS_PROXY',
  'http_proxy',
  'https_proxy',
  'NO_PROXY',
  'no_proxy',
]);

function buildChildEnv({ workbuddyHome, forceLiteBundle, extraEnv }) {
  const env = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value === undefined) continue;
    if (!ENV_ALLOW_EXACT.has(key)) continue;
    env[key] = value;
  }
  // 与桌面端共用同一份配置 / 模型目录 / 登录态
  env.CODEBUDDY_CONFIG_DIR = workbuddyHome;
  if (forceLiteBundle) env.CODEBUDDY_FORCE_LITE_WB_BUNDLE = '1';
  // 无头模式下 CLI 需要能定位 node
  env.CODEBUDDY_NODE_BIN = process.execPath;
  if (extraEnv && typeof extraEnv === 'object') {
    for (const [k, v] of Object.entries(extraEnv)) {
      if (typeof v === 'string') env[k] = v;
    }
  }
  return env;
}

/* ------------------------------------------------------------------ *
 * 定位 WorkBuddy CLI
 * ------------------------------------------------------------------ */

let cachedCli = null;
function cliEntry() {
  if (!cachedCli) cachedCli = resolveCli();
  return cachedCli;
}

/* ------------------------------------------------------------------ *
 * 调用 CLI
 * ------------------------------------------------------------------ */

function looksLikeAuthError(text) {
  return /Authentication required|Authentication failed|请先登录|not logged in/i.test(text || '');
}

function extractText(stdout) {
  const trimmed = stdout.trim();
  if (!trimmed) return '';
  // --output-format json 通常是单个 JSON 对象
  for (const line of trimmed.split(/\r?\n/).reverse()) {
    const candidate = line.trim();
    if (!candidate.startsWith('{')) continue;
    try {
      const obj = JSON.parse(candidate);
      if (typeof obj.result === 'string' && obj.result.trim()) return obj.result.trim();
      if (Array.isArray(obj.content)) {
        const text = obj.content
          .filter((b) => b && (b.type === 'text' || typeof b.text === 'string'))
          .map((b) => b.text || '')
          .join('\n')
          .trim();
        if (text) return text;
      }
    } catch {
      /* 继续尝试下一行 */
    }
  }
  return trimmed;
}

function runCli(args, { cwd, timeoutSec, onHeartbeat }) {
  return new Promise((resolve) => {
    const entry = cliEntry();
    if (!entry) {
      resolve({
        ok: false,
        code: 'CLI_NOT_FOUND',
        message:
          '找不到 WorkBuddy 内置 CLI。请确认 WorkBuddy 桌面端已安装，或设置环境变量 WB_CLI_ENTRY 指向 .../resources/app.asar.unpacked/cli/bin/codebuddy。',
      });
      return;
    }

    const env = buildChildEnv({
      workbuddyHome: workbuddyHome(),
      forceLiteBundle: needsForceLiteBundle(entry),
    });

    const child = spawn(process.execPath, [entry, ...args], {
      cwd: cwd && fs.existsSync(cwd) ? cwd : os.homedir(),
      env,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    let settled = false;
    let timedOut = false;

    const heartbeat = onHeartbeat
      ? setInterval(() => {
          try {
            onHeartbeat();
          } catch {
            /* 忽略通知失败 */
          }
        }, 30000)
      : null;

    const timer = setTimeout(() => {
      timedOut = true;
      try {
        child.kill('SIGKILL');
      } catch {
        /* ignore */
      }
    }, Math.min(Math.max(timeoutSec, 30), MAX_TIMEOUT_SEC) * 1000);

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString('utf8');
      if (stdout.length > 8_000_000) stdout = stdout.slice(-8_000_000);
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString('utf8');
      if (stderr.length > 200_000) stderr = stderr.slice(-200_000);
    });

    const finish = (payload) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (heartbeat) clearInterval(heartbeat);
      resolve(payload);
    };

    child.on('error', (err) => {
      finish({ ok: false, code: 'SPAWN_FAILED', message: `无法启动 WorkBuddy CLI: ${err.message}` });
    });

    child.on('close', (code) => {
      if (timedOut) {
        finish({
          ok: false,
          code: 'TIMEOUT',
          message: `WorkBuddy 在 ${timeoutSec}s 内未完成，已中止。可以把任务拆小一点再委托，或调大 timeout_sec。`,
          partial: extractText(stdout).slice(-4000),
        });
        return;
      }
      const text = extractText(stdout);
      if (looksLikeAuthError(text) || looksLikeAuthError(stderr)) {
        finish({
          ok: false,
          code: 'AUTH_REQUIRED',
          message:
            'WorkBuddy CLI 尚未登录。请在终端执行一次 `wbcli`（或下面的命令）后输入 `/login` 完成浏览器授权，之后委托即可正常使用。',
          detail: (text || stderr).slice(-800),
        });
        return;
      }
      if (code !== 0 && !text) {
        finish({
          ok: false,
          code: 'CLI_EXIT_' + code,
          message: `WorkBuddy CLI 退出码 ${code}，没有产出结果。`,
          detail: stderr.slice(-2000),
        });
        return;
      }
      finish({ ok: true, text, exitCode: code, stderr: stderr.slice(-2000) });
    });
  });
}

/* ------------------------------------------------------------------ *
 * 工具定义
 * ------------------------------------------------------------------ */

const TOOLS = [
  {
    name: 'delegate_task',
    description:
      '把一个子任务交给本机的 WorkBuddy 智能体执行，返回它的最终答复。适合：需要 WorkBuddy 独有能力的工作（生成 Word/Excel/PPT 文件、调用它的技能与连接器、长文写作与排版、联网检索并整理），或者你想把一块相对独立的活整体外包出去。WorkBuddy 拥有与用户本机相同的读写权限，可以在指定目录里直接产出文件。调用时把背景、目标、产出要求写清楚——它看不到你当前的对话。',
    inputSchema: {
      type: 'object',
      properties: {
        task: {
          type: 'string',
          description: '交给 WorkBuddy 的完整任务描述。自包含：背景、目标、约束、期望产出（含文件名/格式）。',
        },
        cwd: {
          type: 'string',
          description: '工作目录的绝对路径。WorkBuddy 会以此为根读写文件，并默认把产出放在这里。不填则用当前用户主目录。',
        },
        write: {
          type: 'boolean',
          description: '是否允许改动文件。默认 true。设为 false 时只做分析与建议，不落盘。',
        },
        model: {
          type: 'string',
          description: '可选的模型 ID（例如 deepseek-v4.1-flash、deepseek-v4-pro、glm-5.3）。不填用 WorkBuddy 默认模型。',
        },
        timeout_sec: {
          type: 'number',
          description: '超时时间（秒），默认 1500，最大 3600。重活请调大。',
        },
        use_connectors: {
          type: 'boolean',
          description:
            '是否加载 WorkBuddy 的 MCP 连接器（腾讯文档、企业微信、邮箱等）。默认 false：跳过连接器，启动快、更稳定，但用不了外部服务。需要读写云端文档/邮件时设为 true（会慢十几秒）。',
        },
      },
      required: ['task'],
    },
  },
  {
    name: 'workbuddy_status',
    description:
      '自检 WorkBuddy 桥接是否可用：CLI 路径、CLI 版本、登录状态。首次接入或委托失败时先调它。',
    inputSchema: { type: 'object', properties: {} },
  },
];

/* ------------------------------------------------------------------ *
 * 工具实现
 * ------------------------------------------------------------------ */

async function toolDelegateTask(args, progressToken) {
  const task = typeof args?.task === 'string' ? args.task.trim() : '';
  if (!task) {
    return errorResult('delegate_task 需要一个非空的 task 参数。');
  }
  const allowWrite = args?.write !== false;
  const timeoutSec = Number.isFinite(args?.timeout_sec) ? Number(args.timeout_sec) : DEFAULT_TIMEOUT_SEC;
  const cwd = typeof args?.cwd === 'string' && args.cwd.trim() ? args.cwd.trim() : os.homedir();

  const cliArgs = [
    '-p',
    // 明确交接语境：WorkBuddy 看不到调用方的对话，需要它直接干活并交出结果
    `（这是一次跨智能体委托：另一个助手把下面这段工作整体交给你独立完成。请直接执行并把结果返回给它，不要复述任务、不要反问，除非缺关键信息。）\n\n${task}`,
    '--output-format',
    'json',
    '--permission-mode',
    allowWrite ? 'bypassPermissions' : 'dontAsk',
  ];
  // 默认跳过 MCP 连接器：能省掉十几秒启动时间，也避免某个连接器卡住拖垮整次委托。
  // 需要云端文档/邮件等能力时，由调用方显式打开。
  if (args?.use_connectors !== true) {
    cliArgs.push('--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}');
  }
  if (cwd && cwd !== os.homedir()) cliArgs.push('--add-dir', cwd);
  if (typeof args?.model === 'string' && args.model.trim()) {
    cliArgs.push('--model', args.model.trim());
  }

  log(`delegate_task start cwd=${cwd} write=${allowWrite} timeout=${timeoutSec}s`);
  const started = Date.now();
  const result = await runCli(cliArgs, {
    cwd,
    timeoutSec,
    onHeartbeat: progressToken
      ? () => sendNotification('notifications/progress', {
          progressToken,
          progress: Math.round((Date.now() - started) / 1000),
          total: timeoutSec,
          message: 'WorkBuddy 正在执行…',
        })
      : null,
  });
  const elapsed = ((Date.now() - started) / 1000).toFixed(1);

  if (!result.ok) {
    log(`delegate_task failed code=${result.code} in ${elapsed}s`);
    const extra = result.detail ? `\n\n--- 原始输出 ---\n${result.detail}` : '';
    return errorResult(`${result.message}\n(耗时 ${elapsed}s)${extra}`);
  }

  log(`delegate_task done in ${elapsed}s, ${result.text.length} chars`);
  const footer = result.text
    ? `\n\n---\n_WorkBuddy 完成，耗时 ${elapsed}s_`
    : `_WorkBuddy 退出码 ${result.exitCode}，没有文本产出。_`;
  return {
    content: [{ type: 'text', text: (result.text || '(WorkBuddy 没有返回文本)') + footer }],
  };
}

function errorResult(text) {
  return { content: [{ type: 'text', text }], isError: true };
}

async function toolStatus() {
  const entry = cliEntry();
  if (!entry) {
    return errorResult(
      [
        '状态：不可用',
        '原因：找不到 WorkBuddy 内置 CLI。',
        '处理：确认桌面端已安装，或设置环境变量 WB_CLI_ENTRY 指向 cli/bin/codebuddy。',
      ].join('\n'),
    );
  }

  const version = await new Promise((resolve) => {
    const child = spawn(process.execPath, [entry, '--version'], {
      env: buildChildEnv({ workbuddyHome: workbuddyHome(), forceLiteBundle: needsForceLiteBundle(entry) }),
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    let err = '';
    const timer = setTimeout(() => child.kill('SIGKILL'), 60000);
    child.stdout.on('data', (c) => (out += c.toString()));
    child.stderr.on('data', (c) => (err += c.toString()));
    child.on('close', () => {
      clearTimeout(timer);
      const m = out.match(/\d+\.\d+\.\d+/);
      resolve(m ? m[0] : null);
    });
    child.on('error', () => {
      clearTimeout(timer);
      resolve(null);
    });
  });

  const probe = await runCli(
    ['-p', 'ping', '--output-format', 'json', '--permission-mode', 'dontAsk', '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}'],
    { timeoutSec: 120 },
  );

  let auth;
  if (probe.ok) auth = '已登录（一次最小请求成功返回）';
  else if (probe.code === 'AUTH_REQUIRED') auth = '未登录 —— 需在终端运行 `wbcli` 后输入 /login 完成一次授权';
  else auth = `未知（${probe.code}）`;

  return {
    content: [
      {
        type: 'text',
        text: [
          '状态：可用',
          `CLI 路径：${entry}`,
          `CLI 版本：${version || '未能识别'}`,
          `调用方式：${path.basename(process.execPath)} ${needsForceLiteBundle(entry) ? '(lite 包)' : '(headless 包)'}`,
          `登录状态：${auth}`,
          `配置目录：${workbuddyHome()}`,
        ].join('\n'),
      },
    ],
  };
}

/* ------------------------------------------------------------------ *
 * JSON-RPC over stdio
 * ------------------------------------------------------------------ */

let stdoutBusy = false;
const outQueue = [];

function flushOut() {
  if (stdoutBusy) return;
  const next = outQueue.shift();
  if (!next) return;
  stdoutBusy = true;
  process.stdout.write(next, () => {
    stdoutBusy = false;
    flushOut();
  });
}

function sendRaw(obj) {
  outQueue.push(JSON.stringify(obj) + '\n');
  flushOut();
}

function sendResult(id, result) {
  sendRaw({ jsonrpc: '2.0', id, result });
}

function sendError(id, code, message) {
  sendRaw({ jsonrpc: '2.0', id, error: { code, message } });
}

function sendNotification(method, params) {
  sendRaw({ jsonrpc: '2.0', method, params });
}

async function handleMessage(msg) {
  const { id, method, params } = msg;
  const isRequest = id !== undefined && id !== null;

  if (method === 'initialize') {
    sendResult(id, {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: SERVER_NAME, version: SERVER_VERSION },
      instructions:
        '本服务器提供 delegate_task：把相对独立的子任务交给本机的 WorkBuddy 智能体执行。' +
        '当任务需要生成 Office 文档（docx/xlsx/pptx）、做长篇写作与排版、调用 WorkBuddy 独有的技能或连接器，' +
        '或你想把一整块工作整体外包时，优先调用它。task 必须自包含，因为它看不到你的对话。',
    });
    return;
  }

  if (method === 'notifications/initialized' || method === 'initialized') return;
  if (method === 'notifications/cancelled' || method === 'notifications/progress') return;
  if (method === 'ping') {
    if (isRequest) sendResult(id, {});
    return;
  }

  if (method === 'tools/list') {
    sendResult(id, { tools: TOOLS });
    return;
  }

  if (method === 'tools/call') {
    const name = params?.name;
    const args = params?.arguments || {};
    const progressToken = params?._meta?.progressToken;
    try {
      let result;
      if (name === 'delegate_task') result = await toolDelegateTask(args, progressToken);
      else if (name === 'workbuddy_status') result = await toolStatus();
      else {
        sendError(id, -32602, `未知工具: ${name}`);
        return;
      }
      sendResult(id, result);
    } catch (err) {
      log('tools/call 异常: ' + (err && err.stack ? err.stack : String(err)));
      sendResult(id, errorResult(`桥接内部错误: ${err && err.message ? err.message : String(err)}`));
    }
    return;
  }

  if (isRequest) sendError(id, -32601, `不支持的方法: ${method}`);
}

let buffer = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  buffer += chunk;
  let idx;
  while ((idx = buffer.indexOf('\n')) >= 0) {
    const line = buffer.slice(0, idx).trim();
    buffer = buffer.slice(idx + 1);
    if (!line) continue;
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      log('收到无法解析的输入，已忽略');
      continue;
    }
    handleMessage(msg).catch((err) => log('handleMessage 失败: ' + String(err)));
  }
});

process.stdin.on('end', () => process.exit(0));
process.on('SIGINT', () => process.exit(0));
process.on('SIGTERM', () => process.exit(0));

log(`${SERVER_NAME} v${SERVER_VERSION} 启动，CLI=${cliEntry() || '(未找到)'}`);
