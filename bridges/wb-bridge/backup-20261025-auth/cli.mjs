#!/usr/bin/env node
/**
 * 终端入口：把参数原样转给 WorkBuddy 内置 CLI，并补齐它需要的启动环境。
 *
 *   node cli.mjs                 进入交互界面（首次用 /login 登录）
 *   node cli.mjs -p "你好"        一次性问答
 *   node cli.mjs --version
 */

import { spawn } from 'node:child_process';
import { resolveCli, needsForceLiteBundle } from './paths.mjs';

const entry = resolveCli();
if (!entry) {
  console.error(
    [
      '找不到 WorkBuddy 内置 CLI。',
      '请确认 WorkBuddy 桌面端已安装，或设置环境变量 WB_CLI_ENTRY 指向',
      '  <安装目录>\\resources\\app.asar.unpacked\\cli\\bin\\codebuddy',
    ].join('\n'),
  );
  process.exit(1);
}

const env = { ...process.env };
if (needsForceLiteBundle(entry)) env.CODEBUDDY_FORCE_LITE_WB_BUNDLE = '1';

const child = spawn(process.execPath, [entry, ...process.argv.slice(2)], {
  stdio: 'inherit',
  env,
  windowsHide: false,
});

child.on('close', (code) => process.exit(code ?? 0));
child.on('error', (err) => {
  console.error('启动失败:', err.message);
  process.exit(1);
});
