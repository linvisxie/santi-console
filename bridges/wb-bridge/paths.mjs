/**
 * 共用：定位 WorkBuddy 内置 CLI。
 * 被 server.mjs（MCP 服务）和 cli.mjs（终端入口）共用。
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

function candidateRoots() {
  const roots = [];
  if (process.env.WB_INSTALL_ROOT) roots.push(process.env.WB_INSTALL_ROOT);
  for (const d of ['C:', 'D:', 'E:', 'F:', 'G:', 'H:']) {
    roots.push(path.join(d + path.sep, 'workbuddy'));
    roots.push(path.join(d + path.sep, 'Program Files', 'WorkBuddy'));
    roots.push(path.join(d + path.sep, 'Program Files (x86)', 'WorkBuddy'));
  }
  const local = process.env.LOCALAPPDATA;
  if (local) {
    roots.push(path.join(local, 'Programs', 'WorkBuddy'));
    roots.push(path.join(local, 'WorkBuddy'));
  }
  return roots;
}

export function resolveCli() {
  if (process.env.WB_CLI_ENTRY && fs.existsSync(process.env.WB_CLI_ENTRY)) {
    return process.env.WB_CLI_ENTRY;
  }
  for (const root of candidateRoots()) {
    const entry = path.join(root, 'resources', 'app.asar.unpacked', 'cli', 'bin', 'codebuddy');
    if (fs.existsSync(entry)) return entry;
  }
  return null;
}

/** 只有随包发布了 headless 产物时才不需要强制走 lite 包 */
export function needsForceLiteBundle(entry) {
  if (!entry) return true;
  const distDir = path.resolve(path.dirname(entry), '..', 'dist');
  return !fs.existsSync(path.join(distDir, 'codebuddy-headless.js'));
}

export function workbuddyHome() {
  return process.env.WB_HOME || path.join(os.homedir(), '.workbuddy');
}
