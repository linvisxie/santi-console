import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import { pathToFileURL } from 'node:url';
import { RpcProcess } from './rpc.mjs';

export const CAPABILITIES = {
  codex: { name: 'Codex', resume: true, approvals: true, images: true, readOnly: true, tools: true, usage: true, transport: '原生 App Server' },
  workbuddy: { name: 'WorkBuddy', resume: true, approvals: true, images: true, readOnly: true, tools: true, usage: true, transport: '原生 ACP' },
  dsh: { name: 'DSH', resume: true, approvals: true, images: true, readOnly: true, tools: true, usage: true, transport: '原生 ACP' },
};
export function nativeEnvironment(extra = {}) {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^(CODEX_|CODEBUDDY_|WORKBUDDY_|ACC_PRODUCT_|NODE_OPTIONS$|ELECTRON_RUN_AS_NODE$)/i.test(key)));
  return { ...env, ...extra };
}
function codexBin() {
  if (process.env.CODEX_BIN) return process.env.CODEX_BIN;
  const root = path.join(os.homedir(), 'AppData/Local/OpenAI/Codex/bin');
  for (const entry of fs.readdirSync(root)) { const file = path.join(root, entry, 'codex.exe'); if (fs.existsSync(file)) return file; }
  throw new Error('找不到 Codex CLI');
}
const imageMime = (file) => ({ '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif' })[path.extname(file).toLowerCase()];
function attachments(task) {
  return (task.attachments || []).map((file) => imageMime(file) ? { type: 'image', data: fs.readFileSync(file).toString('base64'), mimeType: imageMime(file) } : { type: 'text', text: `附件本地路径：${file}` });
}

export class NativeAdapter {
  constructor(task, { appDir, bridgeDir, dataDir, emit, request }) {
    Object.assign(this, { task, appDir, bridgeDir, dataDir, emit, request });
    this.cancelled = false; this.complete = false; this.toolNames = new Map();
    this.finished = new Promise((resolve, reject) => { this.resolve = resolve; this.reject = reject; });
    this.finished.catch(() => {});
  }
  async run() {
    try { return this.task.agent === 'codex' ? await this.codex() : await this.acp(); }
    finally { this.complete = true; this.rpc?.close(); }
  }
  async cancel() {
    this.cancelled = true;
    if (!this.rpc) { this.reject(new Error('执行已停止')); return; }
    if (this.task.agent === 'codex' && this.turnId) this.rpc.call('turn/interrupt', { threadId: this.nativeId, turnId: this.turnId }).catch(() => {});
    else if (this.nativeId) this.rpc.notify('session/cancel', { sessionId: this.nativeId });
    this.stopTimer = setTimeout(() => { this.rpc.kill(); this.reject(new Error('执行已停止')); }, 5000);
    this.stopTimer.unref();
  }
  onEvent(method, params) {
    if (method === 'transport/closed') { if (!this.complete) this.reject(new Error(params.message)); return; }
    if (method === 'transport/error') { this.emit({ kind: 'diagnostic', text: params.message }); return; }
    if (method === 'session/update') { this.acpUpdate(params.update || {}); return; }
    const item = params.item || {};
    if (method === 'item/agentMessage/delta') this.emit({ kind: 'delta', text: params.delta || '', itemId: params.itemId });
    else if (method === 'item/reasoning/summaryTextDelta' || method === 'item/reasoning/textDelta') this.emit({ kind: 'reasoning', text: params.delta || '' });
    else if (method === 'item/started' && item.type === 'commandExecution') this.emit({ kind: 'tool', id: item.id, title: item.command, state: item.status });
    else if (method === 'item/completed') {
      if (item.type === 'agentMessage') this.emit({ kind: 'message', text: item.text || '', itemId: item.id });
      else if (item.type === 'commandExecution') this.emit({ kind: 'tool_result', id: item.id, title: item.command, output: item.aggregatedOutput || '', exitCode: item.exitCode, state: item.status });
      else if (item.type === 'fileChange') this.emit({ kind: 'files', files: item.changes || [], state: item.status });
      else if (item.type === 'mcpToolCall') this.emit({ kind: 'tool_result', id: item.id, title: `${item.server}/${item.tool}`, state: item.status, output: JSON.stringify(item.result || item.error || '') });
    } else if (method === 'thread/tokenUsage/updated') this.emit({ kind: 'usage', usage: params.tokenUsage });
    else if (method === 'turn/completed') {
      this.complete = true; clearTimeout(this.stopTimer);
      params.turn?.status === 'failed' ? this.reject(new Error(params.turn.error?.message || '代理执行失败')) : this.resolve({ cancelled: this.cancelled || params.turn?.status === 'interrupted' });
    } else if (method === 'error') this.emit({ kind: 'diagnostic', text: params.error?.message || params.message || JSON.stringify(params) });
  }
  async codex() {
    const task = this.task;
    this.rpc = new RpcProcess(codexBin(), ['app-server', '--stdio'], { cwd: task.cwd, env: nativeEnvironment(), onEvent: (m, p) => this.onEvent(m, p), onRequest: (m, p) => this.codexRequest(m, p) });
    await this.rpc.call('initialize', { clientInfo: { name: 'santi_console', title: '三体控制台', version: '2.0.0' } });
    this.rpc.notify('initialized');
    const options = { cwd: task.cwd, approvalPolicy: 'on-request', sandbox: task.mode === 'read' ? 'read-only' : 'workspace-write' };
    if (task.model) options.model = task.model;
    let result;
    try { result = task.nativeId ? await this.rpc.call('thread/resume', { ...options, threadId: task.nativeId, excludeTurns: true }) : await this.rpc.call('thread/start', options); }
    catch(error){if(/active writer/i.test(error.message)){
      if(task.attachments?.length){error.message='原生会话被占用；桌面消息投递暂不支持附件，请在 Codex 桌面端发送附件。';throw error;}
      const {stdout}=await promisify(execFile)(codexBin(),['queue','--thread',task.nativeId,'--message',task.prompt],{cwd:task.cwd,env:nativeEnvironment(),windowsHide:true,timeout:15000});
      this.emit({kind:'diagnostic',text:'消息已交给 Codex 原生会话队列。桌面端负责消费和回复；此处交接结束不代表代理执行完成。'+stdout.trim()});
      this.emit({kind:'message',text:'消息已投递到原生 Codex 会话队列，等待桌面端接收。回复请查看该原生会话；本次交接不代表任务完成。'});
      return {cancelled:false,stopReason:'forwarded_to_native_queue'};
    }throw error;}
    this.nativeId = result.thread.id; this.emit({ kind: 'binding', nativeId: this.nativeId });
    if (task.inspect) return { models: (await this.rpc.call('model/list', { limit: 100 })).data, capabilities: CAPABILITIES.codex };
    if (this.cancelled) throw new Error('执行已停止');
    const input = [{ type: 'text', text: task.prompt, text_elements: [] }, ...(task.attachments || []).map((file) => imageMime(file) ? { type: 'localImage', path: file } : { type: 'text', text: `附件本地路径：${file}`, text_elements: [] })];
    const turn = await this.rpc.call('turn/start', { threadId: this.nativeId, input, ...(task.model ? { model: task.model } : {}), ...(task.effort ? { effort: task.effort } : {}) });
    this.turnId = turn.turn.id;
    return this.finished;
  }
  async codexRequest(method, params) {
    if (/requestApproval$/.test(method)) {
      const allowed = this.task.mode !== 'read' && await this.request({ type: 'permission', method, detail: params });
      if (method === 'item/permissions/requestApproval') return { permissions: allowed ? Object.fromEntries(Object.entries(params.permissions || {}).filter(([,value]) => value !== null)) : {}, scope: 'turn' };
      return { decision: allowed ? 'accept' : 'decline' };
    }
    if (method === 'item/tool/requestUserInput') return { answers: await this.request({ type: 'questions', method, detail: params }) || {} };
    if (method === 'mcpServer/elicitation/request') {
      const answer = await this.request({ type: 'elicitation', method, detail: params });
      return answer ? { action: 'accept', content: params.mode === 'url' ? null : answer, _meta: null } : { action: 'decline', content: null, _meta: null };
    }
    throw new Error(`暂不支持该原生请求：${method}`);
  }
  async acp() {
    const task = this.task;
    let command, args, env;
    if (task.agent === 'workbuddy') {
      command = process.execPath; args = [path.join(this.bridgeDir, 'wb-bridge/cli.mjs'), '--serve', '--acp', '--port', '0', '--permission-mode', task.mode === 'read' ? 'plan' : 'default'];
      env = nativeEnvironment({ CODEBUDDY_CONFIG_DIR: path.join(os.homedir(), '.workbuddy') });
    } else {
      command = process.env.DSH_EXE || 'D:/dsh/DeepSeek Harness.exe';
      const patch = path.join(this.dataDir, `dsh-${task.id}.yml`);
      // A process-local overlay only. It never changes the installed DSH profile.
      const yaml = [
        { id: 'headless-startup', disabled: true }, { id: 'headless-runner', disabled: true },
        { id: 'sandbox-policy', config: { mode: task.mode === 'read' ? 'read-only' : 'workspace-write', workspaceRoot: task.cwd } },
        { id: 'approval', config: { policy: 'ask' } },
        { insert: [{ id: 'santi-permission-guard', name: pathToFileURL(path.join(this.appDir,'lib/dsh-permission-guard.mjs')).href, config: { mode: task.mode } }, { id: 'acp-app-startup', name: '@deepseek-ai/dsh-acp-app' }, { id: 'acp', name: '@deepseek-ai/dsh-acp', inject: ['acpAppStartup'], config: { provider: 'qoder-cn', model: task.model || 'DeepSeek-Flash' } }] },
      ];
      fs.writeFileSync(patch, JSON.stringify(yaml)); this.patch = patch;
      args = ['--expose-internals', 'D:/dsh/resources/app.asar/dsh/node_modules/@deepseek-ai/dsh-desktop-host/lib/cli.js', '--profile', 'delegate', '--patch', patch];
      env = nativeEnvironment({ ELECTRON_RUN_AS_NODE: '1', DSH_PERMISSION_MODE: task.mode === 'read' ? 'read-only' : 'workspace-write' });
    }
    this.rpc = new RpcProcess(command, args, { cwd: task.cwd, env, onEvent: (m, p) => this.onEvent(m, p), onRequest: (m, p) => this.acpRequest(m, p) });
    try {
      const initialized = await this.rpc.call('initialize', { protocolVersion: 1, clientCapabilities: { fs: { readTextFile: true, writeTextFile: true }, terminal: false }, clientInfo: { name: 'santi-console', version: '2.0.0' } });
      this.emit({ kind: 'capabilities', capabilities: initialized.agentCapabilities });
      const method = task.nativeId ? (task.agent === 'dsh' ? 'session/resume' : 'session/load') : 'session/new';
      let result;
      for (let attempt=0;attempt<16;attempt++) {
        try { result = await this.rpc.call(method, { cwd: task.cwd, mcpServers: [], ...(task.nativeId ? { sessionId: task.nativeId } : {}) }); break; }
        catch (error) { if (task.agent !== 'dsh' || !/no adapter registered/.test(error.message) || attempt===15) throw error; await new Promise(resolve=>setTimeout(resolve,1000)); }
      }
      this.emit({ kind: 'controls', models: result.models, modes: result.modes, configOptions: result.configOptions });
      this.nativeId = result.sessionId || task.nativeId; this.emit({ kind: 'binding', nativeId: this.nativeId });
      if (!this.nativeId) throw new Error('代理没有返回会话 ID');
      if (task.inspect) return { models: result.models, configOptions: result.configOptions, modes: result.modes, capabilities: initialized.agentCapabilities };
      if ((task.attachments || []).some(imageMime) && !initialized.agentCapabilities?.promptCapabilities?.image) throw new Error('当前代理/模型原生接口不支持图片，请切换支持图片的模型');
      if (task.agent === 'workbuddy') {
        await this.rpc.call('session/set_mode', { sessionId: this.nativeId, modeId: task.mode === 'read' ? 'plan' : 'default' });
        const models = result.models?.availableModels || [];
        if (task.model) await this.rpc.call('session/set_model', { sessionId: this.nativeId, modelId: task.model });
        const thought = result.configOptions?.find(o => o.id === 'thought_level');
        if (task.effort && thought?.options?.some(o => o.value === task.effort)) await this.rpc.call('session/set_config_option', { sessionId: this.nativeId, configId: 'thought_level', value: task.effort });
      } else {
        const options = result.configOptions || [];
        const effort = options.find((o) => o.id === 'reasoning_effort');
        if (task.effort && effort) {
          if (!effort.options.some(o => o.value === task.effort)) throw new Error(`当前模型不支持档位 ${task.effort}，支持：${effort.options.map(o=>o.value||'默认').join('、')}`);
          await this.rpc.call('session/set_config_option', { sessionId: this.nativeId, configId: 'reasoning_effort', value: task.effort });
        }
      }
      if (this.cancelled) throw new Error('执行已停止');
      const response = await this.rpc.call('session/prompt', { sessionId: this.nativeId, prompt: [{ type: 'text', text: task.prompt }, ...attachments(task)] }, 0);
      if (response.stopReason === 'refusal') {
        const detail=response.errorMessage || response._meta?.['codebuddy.ai/errorMessage'] || '原生代理拒绝或未能执行本轮请求';
        if (/Authentication required|sign in|login command/i.test(detail)) { const error=new Error('WorkBuddy 原生 CLI 尚未登录，请通过原生登录入口完成认证后重试。');error.code='AUTH_REQUIRED';error.detail=detail;throw error; }
        throw new Error(detail);
      }
      this.complete = true; clearTimeout(this.stopTimer);
      return { cancelled: this.cancelled || response.stopReason === 'cancelled', stopReason: response.stopReason };
    } finally { if (this.patch) fs.rmSync(this.patch, { force: true }); }
  }
  acpUpdate(update) {
    const type = update.sessionUpdate;
    if (type === 'agent_message_chunk') this.emit({ kind: 'delta', text: update.content?.text || '' });
    else if (type === 'agent_thought_chunk') this.emit({ kind: 'reasoning', text: update.content?.text || '' });
    else if (type === 'tool_call' || type === 'tool_call_update') {
      const previous = this.toolNames.get(update.toolCallId) || {};
      const item = { ...previous, ...update }; this.toolNames.set(update.toolCallId, item);
      this.emit({ kind: type === 'tool_call' ? 'tool' : 'tool_result', id: item.toolCallId, title: item.title || item.kind || '工具', state: item.status, output: (item.content || []).map((c) => c.content?.text || c.text || '').join('\n'), locations: item.locations || [] });
    } else if (/usage/.test(type || '')) this.emit({ kind: 'usage', usage: update });
    else if (type === 'user_message_chunk') { /* history from session/load, not a new user message */ }
  }
  async acpRequest(method, params) {
    if (method === 'session/request_permission') {
      const allow = this.task.mode !== 'read' && await this.request({ type: 'permission', method, detail: { ...params, toolCall: { ...params.toolCall, ...(this.toolNames.get(params.toolCall?.toolCallId) || {}) } } });
      const option = params.options?.find((o) => o.kind === (allow ? 'allow_once' : 'reject_once'));
      return option ? { outcome: { outcome: 'selected', optionId: option.optionId } } : { outcome: { outcome: 'cancelled' } };
    }
    if (method === 'fs/read_text_file' || method === 'fs/write_text_file') {
      const target = path.resolve(params.path); const root = fs.realpathSync(this.task.cwd);
      const real = fs.existsSync(target) ? fs.realpathSync(target) : path.join(fs.realpathSync(path.dirname(target)), path.basename(target));
      const relative = path.relative(root, real);
      if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('文件超出当前项目边界');
      if (method === 'fs/read_text_file') {
        const text = fs.readFileSync(real, 'utf8').split('\n'); const start = Math.max(0, (params.line || 1) - 1);
        return { content: text.slice(start, params.limit ? start + params.limit : undefined).join('\n') };
      }
      if (this.task.mode === 'read') throw new Error('只读模式禁止文件写入');
      if (!await this.request({ type: 'permission', method, detail: { path: real, content: params.content } })) throw new Error('用户拒绝文件写入');
      fs.writeFileSync(real, params.content, 'utf8'); this.emit({ kind: 'files', files: [{ path: real, kind: 'update' }], state: 'completed' }); return {};
    }
    throw new Error(`暂不支持该原生请求：${method}`);
  }
}
