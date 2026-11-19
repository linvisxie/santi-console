/**
 * 只读安全回归：验证 /api/delete-project 的受保护目录判断。
 * 用当前账户主目录与系统目录做输入，期望全部被拒绝（400），不会真的删除任何东西。
 *
 * 用法：CONSOLE_PORT=7899 node tools/verify-delete-guard.mjs
 */
import os from 'node:os';
import path from 'node:path';
import {automationToken} from '../runtime/resources/app/lib/ui-control.mjs';

const root = path.resolve(import.meta.dirname, '..');
const appDir = path.join(root, 'runtime', 'resources', 'app');
const base = `http://127.0.0.1:${process.env.CONSOLE_PORT || 7899}`;
const token = automationToken(appDir);

const targets = [
  os.homedir(),
  path.dirname(os.homedir()),
  process.env.SystemRoot || 'C:\\Windows',
  'C:\\Program Files',
  'C:\\',
  'D:\\',
];

let failed = 0;
for (const target of targets) {
  const response = await fetch(`${base}/api/delete-project`, {
    method: 'POST',
    headers: {authorization: `Bearer ${token}`, 'content-type': 'application/json'},
    body: JSON.stringify({path: target}),
  });
  const body = await response.text();
  const ok = response.status === 400;
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${response.status} ${target} → ${body.slice(0, 120)}`);
}

console.log(`\n${targets.length - failed}/${targets.length} 受保护目录被正确拒绝`);
process.exit(failed ? 1 : 0);
