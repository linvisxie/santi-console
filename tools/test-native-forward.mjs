/**
 * 桥接完整链路测试：从任务服务投递一次只读请求到指定原生会话。
 *
 * 用法：node tools/test-native-forward.mjs <nativeSessionId>
 * 会话 ID 从三体的 store.json（.workbench/store.json 的 conversations[].nativeId）里取，
 * 或用环境变量 CONSOLE_NATIVE_SESSION_ID 传入，避免把本机会话 ID 写进仓库。
 */
import {WorkbenchClient} from '../runtime/resources/app/lib/workbench-client.mjs';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const app = path.join(root, 'runtime', 'resources', 'app');
const liveDir = path.join(root, 'tools', '.bridge-live-test');

process.env.CONSOLE_WORKBENCH_DIR = liveDir;
fs.mkdirSync(liveDir, {recursive: true});
if (!fs.existsSync(path.join(liveDir, 'store.json'))) {
  fs.copyFileSync(path.join(app, '.workbench', 'store.json'), path.join(liveDir, 'store.json'));
}

const wanted = process.argv[2] || process.env.CONSOLE_NATIVE_SESSION_ID;
const client = new WorkbenchClient(app);
const store = JSON.parse(fs.readFileSync(path.join(app, '.workbench', 'store.json'), 'utf8'));

const conversation = wanted
  ? store.conversations.find((c) => c.nativeId === wanted)
  : store.conversations[0];
if (!conversation) {
  console.error(wanted ? `store.json 里找不到 nativeId=${wanted} 的会话` : 'store.json 里没有任何会话，请先用三体跑一次');
  process.exit(1);
}

console.log(
  await client.request('/tasks', 'POST', {
    conversationId: conversation.id,
    clientRequestId: `bridge-e2e-${Date.now()}`,
    prompt: '【三体完整链路测试】经过任务服务和适配器投递，收到后仅确认收到，保留开发任务。',
    mode: 'read',
  }),
);
