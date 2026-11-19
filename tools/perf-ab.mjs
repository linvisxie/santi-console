/**
 * 注入流畅模式样式并立刻复测帧率（验证用，不落盘）
 *   node tools/perf-ab.mjs [端口]
 */
const port = process.argv[2] || '9224';

const LITE_CSS = `
  /* 停掉巨型渐变层的动画与自身模糊 */
  .liquid { filter: none !important; inset: 0 !important; }
  .liquid span { animation: none !important; mix-blend-mode: normal !important; }
  .liquid span:nth-child(1) { transform: none !important; }
  /* 面板不再做实时背景模糊 */
  * { backdrop-filter: none !important; -webkit-backdrop-filter: none !important; }
  .grain { display: none !important; }
`;

const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
const page = list.find((t) => t.type === 'page');
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
  if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails));
  return r.result.value;
};

const FPS_PROBE = `(async () => {
  const deltas = [];
  let last = performance.now();
  await new Promise((done) => {
    let n = 0;
    const step = () => {
      const t = performance.now();
      deltas.push(t - last);
      last = t;
      if (++n >= 70) return done();
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  });
  deltas.shift();
  const sorted = [...deltas].sort((a, b) => a - b);
  const avg = deltas.reduce((a, b) => a + b, 0) / deltas.length;
  return { fps: Math.round(1000 / avg), avgMs: Math.round(avg), p95: Math.round(sorted[Math.floor(sorted.length*0.95)]), over50ms: deltas.filter(d=>d>50).length };
})()`;

console.log('注入前:', JSON.stringify(await evaluate(FPS_PROBE)));

await evaluate(`(() => {
  const s = document.createElement('style');
  s.id = 'perf-lite-test';
  s.textContent = ${JSON.stringify(LITE_CSS)};
  document.head.appendChild(s);
  return 'injected';
})()`);

await new Promise((r) => setTimeout(r, 1200));
console.log('注入后:', JSON.stringify(await evaluate(FPS_PROBE)));

ws.close();
process.exit(0);
