/**
 * 强制导航到首页并截图（用于排查窗口空白）
 *   node tools/nav.mjs [端口] [输出文件] [地址]
 */
import fs from 'node:fs';

const port = process.argv[2] || '9224';
const out = process.argv[3] || 'shot-nav.png';
const url = process.argv[4] || 'http://127.0.0.1:7788/';

const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
const page = list.find((t) => t.type === 'page');
if (!page) {
  console.error('没找到页面 target');
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

try {
  const nav = await rpc('Page.navigate', { url });
  console.log('导航:', JSON.stringify(nav));
} catch (e) {
  console.log('导航失败:', e.message);
}

await new Promise((r) => setTimeout(r, 4000));

try {
  const r = await rpc('Runtime.evaluate', {
    expression:
      "JSON.stringify({url:location.href,title:document.title,ready:document.readyState,text:(document.body?document.body.innerText:'').slice(0,150)})",
    returnByValue: true,
  });
  console.log('状态:', r.result.value);
} catch (e) {
  console.log('求值失败:', e.message);
}

try {
  const shot = await rpc('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(out, Buffer.from(shot.data, 'base64'));
  console.log('已保存', out, fs.statSync(out).size, 'bytes');
} catch (e) {
  console.log('截图失败:', e.message);
}

ws.close();
process.exit(0);
