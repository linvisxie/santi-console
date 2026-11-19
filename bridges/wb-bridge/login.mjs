import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import net from 'node:net';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveCli, needsForceLiteBundle } from './paths.mjs';

// The desktop lite bundle has no terminal login UI. Use its authenticated,
// loopback-only account-login API instead. Never log credentials or auth URLs.
const entry = resolveCli();
if (!entry) throw new Error('找不到 WorkBuddy CLI');
const here = path.dirname(fileURLToPath(import.meta.url));
const password = randomBytes(32).toString('base64url');
const authPath = path.join(os.homedir(), 'AppData', 'Local', 'CodeBuddyExtension', 'Data', 'Public', 'auth', 'workbuddy-desktop.info');
const authStamp = () => { try { return fs.statSync(authPath).mtimeMs; } catch { return 0; } };
const listener = net.createServer();
await new Promise(r => listener.listen(0, '127.0.0.1', r));
const port = listener.address().port;
await new Promise(r => listener.close(r));
const env = Object.fromEntries(Object.entries(process.env).filter(([k]) =>
  !/^(CODEBUDDY_|ACC_PRODUCT_|WORKBUDDY_)/i.test(k)));
env.CODEBUDDY_CONFIG_DIR = path.join(here, 'login-runtime');
env.CODEBUDDY_GATEWAY_PASSWORD = password;
env.CODEBUDDY_NODE_BIN = process.execPath;
if (needsForceLiteBundle(entry)) env.CODEBUDDY_FORCE_LITE_WB_BUNDLE = '1';
const child = spawn(process.execPath, [entry, '--serve', '--host', '127.0.0.1',
  '--port', String(port), '--auth', 'password', '--strict-mcp-config',
  '--mcp-config', '{"mcpServers":{}}'], {
  cwd: here, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
});
let exited = false;
child.on('exit', () => { exited = true; });
child.on('error', () => { exited = true; });
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => { child.kill(); process.exit(130); });
}
child.stdout.resume(); child.stderr.resume();
const pause = ms => new Promise(r => setTimeout(r, ms));
async function api(route, body) {
  const res = await fetch(`http://127.0.0.1:${port}${route}`, {
    method: body ? 'POST' : 'GET',
    headers: { Authorization: `Bearer ${password}`, 'Content-Type': 'application/json', 'x-codebuddy-request': '1' },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`登录服务 HTTP ${res.status}`);
  const json = await res.json();
  return json.data ?? json;
}
try {
  let status;
  for (let i = 0; i < 60; i++) {
    if (exited) throw new Error('WorkBuddy 登录服务提前退出');
    try { status = await api('/api/v1/auth/account/status'); break; } catch {}
    await pause(1000);
  }
  if (!status) throw new Error('登录服务启动超时');
  console.log('WorkBuddy 本地登录服务已启动（仅本机，密码保护）。');
  if (status.authenticated && process.argv.includes('--check')) {
    console.log('ACCOUNT_STATE_LOADED（尚未验证实际请求）');
  } else {
    const previousStamp = authStamp();
    const login = await api('/api/v1/auth/account/login', { method: 'internal' });
    if (!login.success || login.loginError) throw new Error('无法启动官方账号登录流程');
    console.log('已请求打开官方登录页面，请在浏览器中完成登录或确认授权。');
    let done = false;
    for (let i = 0; i < 300; i++) {
      await pause(2000);
      status = await api('/api/v1/auth/account/status');
      if (status.authenticated && authStamp() > previousStamp) { done = true; break; }
      if (status.loginError) throw new Error('官方登录流程未完成，请重试');
    }
    if (!done) throw new Error('等待浏览器授权超时');
    console.log('ACCOUNT_AUTHENTICATED');
  }
} catch (err) {
  console.error(err.message);
  process.exitCode = 1;
} finally {
  child.kill();
}
