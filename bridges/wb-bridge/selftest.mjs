#!/usr/bin/env node
/**
 * 自检脚本：以 MCP 客户端身份连上 server.mjs，做一次握手 + 工具列举 + 状态查询。
 * 用法：node selftest.mjs [--delegate "任务文本"]
 */

import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const serverPath = path.join(here, 'server.mjs');

const delegateArgIndex = process.argv.indexOf('--delegate');
const delegateTask = delegateArgIndex > -1 ? process.argv[delegateArgIndex + 1] : null;

const child = spawn(process.execPath, [serverPath], {
  stdio: ['pipe', 'pipe', 'inherit'],
});

let buf = '';
let nextId = 1;
const pending = new Map();

child.stdout.setEncoding('utf8');
child.stdout.on('data', (chunk) => {
  buf += chunk;
  let i;
  while ((i = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, i).trim();
    buf = buf.slice(i + 1);
    if (!line) continue;
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      console.log('[非 JSON 输出]', line.slice(0, 200));
      continue;
    }
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id)(msg);
      pending.delete(msg.id);
    } else {
      console.log('[通知]', JSON.stringify(msg).slice(0, 300));
    }
  }
});

function request(method, params) {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    let timer;
    pending.set(id, result => { clearTimeout(timer); resolve(result); });
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
    timer = setTimeout(() => {
      if (pending.has(id)) {
        pending.delete(id);
        reject(new Error(`${method} 超时`));
      }
    }, 300000);
  });
}

function textOf(res) {
  const content = res?.result?.content || [];
  return content.map((c) => c.text || '').join('\n');
}

try {
  const init = await request('initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'selftest', version: '1.0.0' },
  });
  console.log('✔ initialize:', JSON.stringify(init.result?.serverInfo));

  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');

  const list = await request('tools/list', {});
  console.log('✔ tools/list:', list.result.tools.map((t) => t.name).join(', '));

  const status = await request('tools/call', { name: 'workbuddy_status', arguments: {} });
  console.log('--- workbuddy_status ---');
  console.log(textOf(status));
  if (status.result?.isError) throw new Error('状态自检失败');

  if (delegateTask) {
    console.log('--- delegate_task ---');
    const res = await request('tools/call', { name: 'delegate_task', arguments: { task: delegateTask, ...(process.argv.includes('--read-only') ? { write: false } : {}) } });
    console.log(textOf(res));
    if (res.result?.isError) throw new Error('实际委托失败');
  }
} catch (err) {
  console.error('自检失败:', err.message);
  process.exitCode = 1;
} finally {
  child.stdin.end();
  setTimeout(() => child.kill(), 500);
}
