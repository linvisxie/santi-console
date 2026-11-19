#!/usr/bin/env node
/**
 * dsh-bridge
 *
 * 零依赖 MCP (stdio) 服务器，把本机 dsh（DeepSeek Harness）暴露成一个
 * 可被 Codex / 其它 MCP 客户端调用的"子智能体"工具。
 *
 * 对外工具：
 *   delegate_to_dsh  把一段任务交给 dsh 执行，返回它的答复
 *   dsh_status       自检：安装路径、版本、delegate profile 是否存在
 *
 * 依赖 dsh 侧的专用 profile `delegate`（由 headless 模板派生，默认模型走 qoder-cn，
 * 复用桌面端已有登录）。这样既不动 desktop profile，也不依赖 DEEPSEEK_API_KEY。
 *
 * 约定：stdout 只跑 JSON-RPC，日志一律走 stderr。
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const PROTOCOL_VERSION = '2024-11-05';
const SERVER_NAME = 'dsh-bridge';
const SERVER_VERSION = '1.0.0';

const DEFAULT_TIMEOUT_SEC = 1800;
const MAX_TIMEOUT_SEC = 5400;
const PROFILE = process.env.DSH_DELEGATE_PROFILE || 'delegate';

function log(...args) {
  process.stderr.write(`[dsh-bridge] ${args.join(' ')}\n`);
}

/* ------------------------------------------------------------------ *
 * 定位 dsh
 * ------------------------------------------------------------------ */

const CLI_REL = path.join(
  'resources',
  'app.asar',
  'dsh',
  'node_modules',
  '@deepseek-ai',
  'dsh-desktop-host',
  'lib',
  'cli.js',
);

function candidateRoots() {
  const roots = [];
  if (process.env.DSH_INSTALL_ROOT) roots.push(process.env.DSH_INSTALL_ROOT);
  for (const d of ['C:', 'D:', 'E:', 'F:', 'G:', 'H:']) {
    roots.push(path.join(d + path.sep, 'dsh'));
    roots.push(path.join(d + path.sep, 'Program Files', 'DeepSeek Harness'));
    roots.push(path.join(d + path.sep, 'Program Files (x86)', 'DeepSeek Harness'));
  }
  const local = process.env.LOCALAPPDATA;
  if (local) {
    roots.push(path.join(local, 'Programs', 'DeepSeek Harness'));
    roots.push(path.join(local, 'DeepSeek Harness'));
  }
  return roots;
}

let cachedLauncher = null;

/** 返回 { exe, cliJs } —— 直接用 Electron 二进制以 node 身份跑 CLI，避开 .cmd 的引号问题 */
function resolveLauncher() {
  if (cachedLauncher !== null) return cachedLauncher;
  for (const root of candidateRoots()) {
    const exe = path.join(root, 'DeepSeek Harness.exe');
    const asar = path.join(root, 'resources', 'app.asar');
    // 注意：cli.js 位于 app.asar 内部，普通 node 进程的 fs 看不到包内文件，
    // 只能校验 exe 与 asar 外层文件；包内路径交给 Electron 自己解析。
    if (fs.existsSync(exe) && fs.existsSync(asar)) {
      cachedLauncher = { exe, cliJs: path.join(root, CLI_REL), root };
      return cachedLauncher;
    }
  }
  cachedLauncher = false;
  return cachedLauncher;
}

function dshHome() {
  return process.env.DSH_HOME || path.join(os.homedir(), '.dsh');
}

function profileDir() {
  return path.join(dshHome(), 'profiles', PROFILE);
}

/* ------------------------------------------------------------------ *
 * 环境：白名单，避免继承宿主注入的会话变量
 * ------------------------------------------------------------------ */

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
  'HTTP_PROXY',
  'HTTPS_PROXY',
  'http_proxy',
  'https_proxy',
  'NO_PROXY',
  'no_proxy',
  // dsh 自己的 home，允许外部覆盖
  'DSH_HOME',
]);

function buildChildEnv() {
  const env = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value === undefined) continue;
    if (!ENV_ALLOW_EXACT.has(key)) continue;
    env[key] = value;
  }
  // 让 Electron 二进制以纯 node 方式运行 CLI
  env.ELECTRON_RUN_AS_NODE = '1';
  return env;
}

/* ------------------------------------------------------------------ *
 * 调用 dsh headless
 * ------------------------------------------------------------------ */

function runDsh(args, { cwd, timeoutSec, onHeartbeat }) {
  return new Promise((resolve) => {
    const launcher = resolveLauncher();
    if (!launcher) {
      resolve({
        ok: false,
        code: 'DSH_NOT_FOUND',
        message:
          '找不到 dsh 安装（DeepSeek Harness.exe + app.asar/dsh/.../cli.js）。请确认已安装，或设置环境变量 DSH_INSTALL_ROOT 指向安装目录。',
      });
      return;
    }

    const child = spawn(
      launcher.exe,
      ['--expose-internals', launcher.cliJs, '--profile', PROFILE, ...args],
      {
        cwd: cwd && fs.existsSync(cwd) ? cwd : os.homedir(),
        env: buildChildEnv(),
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );

    let stdout = '';
    let stderr = '';
    let settled = false;
    let timedOut = false;

    const heartbeat = onHeartbeat
      ? setInterval(() => {
          try {
            onHeartbeat();
          } catch {
            /* 忽略 */
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

    child.stdout.on('data', (c) => {
      stdout += c.toString('utf8');
      if (stdout.length > 8_000_000) stdout = stdout.slice(-8_000_000);
    });
    child.stderr.on('data', (c) => {
      stderr += c.toString('utf8');
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
      finish({ ok: false, code: 'SPAWN_FAILED', message: `无法启动 dsh: ${err.message}` });
    });

    child.on('close', (code) => {
      if (timedOut) {
        finish({
          ok: false,
          code: 'TIMEOUT',
          message: `dsh 在 ${timeoutSec}s 内未完成，已中止。可以把任务拆小或调大 timeout_sec。`,
          partial: stdout.slice(-4000),
        });
        return;
      }
      const text = stdout.trim();
      if (code !== 0 || !text) {
        // dsh 的报错走 stderr，形如 "dsh: CODE: message"
        const errLine = (stderr.match(/dsh: [A-Z_]+:.*/g) || []).pop();
        finish({
          ok: false,
          code: errLine ? 'DSH_ERROR' : 'DSH_EXIT_' + code,
          message: errLine || `dsh 退出码 ${code}，没有产出结果。`,
          detail: stderr.slice(-2000),
        });
        return;
      }
      finish({ ok: true, text, exitCode: code });
    });
  });
}

/* ------------------------------------------------------------------ *
 * 工具
 * ------------------------------------------------------------------ */

const TOOLS = [
  {
    name: 'delegate_to_dsh',
    description:
      '把一个子任务交给本机的 dsh（DeepSeek Harness）执行，返回它的答复。适合：需要 dsh 侧独有能力的工作（它安装的插件、技能、Docker/网络检索等工作流），或者你想让另一套模型/订阅额度跑这段活。dsh 以指定目录为工作区，具备文件读写与命令执行能力。任务描述必须自包含——它看不到你当前的对话。',
    inputSchema: {
      type: 'object',
      properties: {
        task: {
          type: 'string',
          description: '交给 dsh 的完整任务描述：背景、目标、约束、期望产出（含文件名/格式）。',
        },
        cwd: {
          type: 'string',
          description: '工作目录绝对路径，dsh 以此为工作区。不填用当前用户主目录。',
        },
        timeout_sec: {
          type: 'number',
          description: '超时时间（秒），默认 1800，最大 5400。',
        },
      },
      required: ['task'],
    },
  },
  {
    name: 'dsh_status',
    description: '自检 dsh 桥接是否可用：安装路径、dsh 版本、delegate profile 状态。',
    inputSchema: { type: 'object', properties: {} },
  },
];

function errorResult(text) {
  return { content: [{ type: 'text', text }], isError: true };
}

async function toolDelegateTask(args, progressToken) {
  const task = typeof args?.task === 'string' ? args.task.trim() : '';
  if (!task) return errorResult('delegate_to_dsh 需要一个非空的 task 参数。');

  const timeoutSec = Number.isFinite(args?.timeout_sec) ? Number(args.timeout_sec) : DEFAULT_TIMEOUT_SEC;
  const cwd = typeof args?.cwd === 'string' && args.cwd.trim() ? args.cwd.trim() : os.homedir();

  log(`delegate start cwd=${cwd} timeout=${timeoutSec}s`);
  const started = Date.now();
  const result = await runDsh([task], {
    cwd,
    timeoutSec,
    onHeartbeat: progressToken
      ? () =>
          sendNotification('notifications/progress', {
            progressToken,
            progress: Math.round((Date.now() - started) / 1000),
            total: timeoutSec,
            message: 'dsh 正在执行…',
          })
      : null,
  });
  const elapsed = ((Date.now() - started) / 1000).toFixed(1);

  if (!result.ok) {
    log(`delegate failed code=${result.code} in ${elapsed}s`);
    const extra = result.detail ? `\n\n--- 原始输出 ---\n${result.detail}` : '';
    return errorResult(`${result.message}\n(耗时 ${elapsed}s)${extra}`);
  }

  log(`delegate done in ${elapsed}s, ${result.text.length} chars`);
  return {
    content: [{ type: 'text', text: `${result.text}\n\n---\n_dsh 完成，耗时 ${elapsed}s_` }],
  };
}

async function toolStatus() {
  const launcher = resolveLauncher();
  if (!launcher) {
    return errorResult(
      [
        '状态：不可用',
        '原因：找不到 dsh 安装目录。',
        '处理：设置环境变量 DSH_INSTALL_ROOT 指向安装目录（含 "DeepSeek Harness.exe"）。',
      ].join('\n'),
    );
  }

  const dir = profileDir();
  const hasProfile = fs.existsSync(path.join(dir, 'package.json'));

  const version = await new Promise((resolve) => {
    const child = spawn(launcher.exe, ['--expose-internals', launcher.cliJs, '-V'], {
      env: buildChildEnv(),
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
      resolve((out + err).trim().split(/\r?\n/).pop() || '未能识别');
    });
    child.on('error', () => {
      clearTimeout(timer);
      resolve('未能识别');
    });
  });

  return {
    content: [
      {
        type: 'text',
        text: [
          '状态：可用',
          `安装目录：${launcher.root}`,
          `dsh 版本：${version}`,
          `使用的 profile：${PROFILE}`,
          `profile 状态：${hasProfile ? `已就绪（${dir}）` : `缺失 —— 需创建（${dir}）`}`,
          `调用方式："DeepSeek Harness.exe" 以 ELECTRON_RUN_AS_NODE 身份跑 cli.js --profile ${PROFILE}`,
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
        '本服务器提供 delegate_to_dsh：把相对独立的子任务交给本机的 dsh（DeepSeek Harness）执行。' +
        '当任务适合用 dsh 侧的插件/技能/工作区，或你想把一整块活交给另一套模型跑时调用它。' +
        'task 必须自包含，因为 dsh 看不到你的对话。',
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
      if (name === 'delegate_to_dsh') result = await toolDelegateTask(args, progressToken);
      else if (name === 'dsh_status') result = await toolStatus();
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

const l = resolveLauncher();
log(`${SERVER_NAME} v${SERVER_VERSION} 启动，dsh=${l ? l.root : '(未找到)'}，profile=${PROFILE}`);
