/**
 * 探测 CDP 页面状态：加载地址、标题、渲染内容
 *   node tools/probe.mjs [端口]
 */
const port = process.argv[2] || '9224';

const list = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
const page = list.find((t) => t.type === 'page');
if (!page) {
  console.error('没找到页面 target');
  process.exit(1);
}
console.log('target url:', JSON.stringify(page.url));

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

const expr = `JSON.stringify({
  url: location.href,
  title: document.title,
  ready: document.readyState,
  w: innerWidth, h: innerHeight,
  text: (document.body ? document.body.innerText : '').slice(0, 200),
  nodes: document.querySelectorAll('*').length
})`;

try {
  const r = await rpc('Runtime.evaluate', { expression: expr, returnByValue: true });
  const v = JSON.parse(r.result.value);
  console.log('地址  :', v.url);
  console.log('标题  :', v.title);
  console.log('就绪  :', v.ready, '| 视口', v.w + 'x' + v.h, '| 节点', v.nodes);
  console.log('内容  :', JSON.stringify(v.text));
} catch (e) {
  console.log('求值失败:', e.message);
}

ws.close();
process.exit(0);
