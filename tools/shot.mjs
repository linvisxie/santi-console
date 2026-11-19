/**
 * 对 Electron 窗口截图（走 --remote-debugging-port）
 *   node tools/shot.mjs <端口> <输出文件> [js表达式]
 */
import fs from 'node:fs';

const port = process.argv[2] || '9224';
const out = process.argv[3] || 'shot.png';
const script = process.argv[4] || '';

const list = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
const page = list.find((t) => t.type === 'page');
if (!page) {
  console.error('没找到页面', JSON.stringify(list).slice(0, 300));
  process.exit(1);
}

const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r, { once: true }));

let id = 0;
const rpc = (method, params) =>
  new Promise((resolve, reject) => {
    const n = ++id;
    const onMsg = (ev) => {
      let m;
      try {
        m = JSON.parse(ev.data);
      } catch {
        return;
      }
      if (m.id !== n) return;
      ws.removeEventListener('message', onMsg);
      if (m.error) return reject(new Error(JSON.stringify(m.error)));
      resolve(m.result);
    };
    ws.addEventListener('message', onMsg);
    ws.send(JSON.stringify({ id: n, method, params }));
  });

const evaluate = async (expression) => {
  const r = await rpc('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.text);
  return r.result.value;
};

const size = await evaluate('JSON.stringify({w:innerWidth,h:innerHeight,dpr:devicePixelRatio})');
console.log('视口:', size);

if (script) {
  console.log('执行:', script);
  console.log('结果:', await evaluate(script));
  await new Promise((r) => setTimeout(r, Number(process.env.WAIT_MS || 2500)));
}

const shot = await rpc('Page.captureScreenshot', { format: 'png' });
fs.writeFileSync(out, Buffer.from(shot.data, 'base64'));
console.log('已保存', out, fs.statSync(out).size, 'bytes');

ws.close();
process.exit(0);
