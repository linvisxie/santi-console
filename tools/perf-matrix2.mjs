/**
 * 第二轮：能不能连背景动画都保留？
 * 关键假设：杀死帧率的是 ".liquid 父元素上的 blur(48px)" —— 动画每帧变化
 * 都要重新应用这个大滤镜。如果滤镜拿掉（渐变本身 transparent 68% 渐隐，够柔），
 * transform 动画就退化为纯合成操作，可能满帧。
 *   node tools/perf-matrix2.mjs [端口]
 */
const port = process.argv[2] || '9224';

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

const FPS = `(async () => {
  await new Promise(r => setTimeout(r, 300));
  const deltas = [];
  let last = performance.now();
  await new Promise((done) => {
    let n = 0;
    const step = () => {
      const t = performance.now();
      deltas.push(t - last); last = t;
      if (++n >= 60) return done();
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  });
  deltas.shift();
  const s = [...deltas].sort((a,b)=>a-b);
  const avg = deltas.reduce((a,b)=>a+b,0)/deltas.length;
  return Math.round(1000/avg) + 'fps(avg ' + Math.round(avg) + 'ms, p95 ' + Math.round(s[Math.floor(s.length*0.95)]) + 'ms)';
})()`;

const experiments = {
  'F0 基线(完整质感)': '',

  'F1 动画保留+去父层blur(48px)': `
    .liquid { filter: none !important; }`,

  'F2 F1+去mix-blend-mode': `
    .liquid { filter: none !important; }
    .liquid span { mix-blend-mode: normal !important; }`,

  'F3 F1+backdrop减半(42→20)': `
    .liquid { filter: none !important; }
    .glass { backdrop-filter: blur(20px) saturate(200%) !important; -webkit-backdrop-filter: blur(20px) saturate(200%) !important; }`,

  'F4 F2+backdrop减半(42→20)': `
    .liquid { filter: none !important; }
    .liquid span { mix-blend-mode: normal !important; }
    .glass { backdrop-filter: blur(20px) saturate(200%) !important; -webkit-backdrop-filter: blur(20px) saturate(200%) !important; }`,

  'F5 F2+backdrop降12px': `
    .liquid { filter: none !important; }
    .liquid span { mix-blend-mode: normal !important; }
    .glass { backdrop-filter: blur(12px) saturate(200%) !important; -webkit-backdrop-filter: blur(12px) saturate(200%) !important; }`,

  'F6 F2+动画减速(144s,更省不了多少但更优雅)': `
    .liquid { filter: none !important; }
    .liquid span { mix-blend-mode: normal !important; animation-duration: 144s !important; }`,
};

await evaluate(`document.documentElement.dataset.perf='full'; 'ok'`);
await new Promise((r) => setTimeout(r, 800));

for (const [name, css] of Object.entries(experiments)) {
  await evaluate(`(() => { const s = document.getElementById('perf-exp'); if (s) s.remove(); return 'ok'; })()`);
  if (css) {
    await evaluate(`(() => {
      const s = document.createElement('style');
      s.id = 'perf-exp';
      s.textContent = ${JSON.stringify(css)};
      document.head.appendChild(s);
      return 'ok';
    })()`);
  }
  await new Promise((r) => setTimeout(r, 900));
  const fps = await evaluate(FPS);
  console.log(name.padEnd(40), '→', fps);
}

await evaluate(`(() => { const s = document.getElementById('perf-exp'); if (s) s.remove(); return 'ok'; })()`);
console.log('（页面已恢复原状）');
ws.close();
process.exit(0);
