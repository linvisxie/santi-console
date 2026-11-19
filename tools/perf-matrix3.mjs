/**
 * 第三轮：低频微动的背景能否骗过缓存？
 * G1: 完整玻璃 + JS 每2.5s挪3px（无过渡，值变了才写）
 * G2: 完整玻璃 + CSS steps 长周期动画
 *   node tools/perf-matrix3.mjs [端口]
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

// 采样 10 秒（覆盖至少 3 次跳变），统计帧间隔分布
const FPS10 = `(async () => {
  await new Promise(r => setTimeout(r, 400));
  const deltas = [];
  let last = performance.now();
  await new Promise((done) => {
    const step = () => {
      const t = performance.now();
      deltas.push(t - last); last = t;
      if (t - deltas.t0 > 10000) return done();
      requestAnimationFrame(step);
    };
    deltas.t0 = performance.now();
    requestAnimationFrame(step);
  });
  deltas.shift();
  const s = [...deltas].sort((a,b)=>a-b);
  const avg = deltas.reduce((a,b)=>a+b,0)/deltas.length;
  const over50 = deltas.filter(d=>d>50).length;
  return Math.round(1000/avg) + 'fps(avg ' + Math.round(avg) + 'ms, worst ' + Math.round(s[s.length-1]) + 'ms, >50ms帧数 ' + over50 + '/' + deltas.length + ')';
})()`;

// G1: 完整玻璃 + 低频微动
const G1_CSS = ``; // CSS 不动，全靠 JS
const G1_JS = `(() => {
  window.__perfG1 && clearInterval(window.__perfG1);
  const spans = Array.from(document.querySelectorAll('.liquid span'));
  const last = spans.map(() => '');
  window.__perfG1 = setInterval(() => {
    const t = Date.now() / 1000;
    spans.forEach((el, i) => {
      const dx = Math.round(14 * Math.sin(t / 12 + i * 2.1));
      const dy = Math.round(10 * Math.cos(t / 12 + i * 1.7));
      const v = 'translate3d(' + dx + 'px,' + dy + 'px,0)';
      if (v !== last[i]) { el.style.transform = v; last[i] = v; }
    });
  }, 2500);
  return 'G1 on: ' + spans.length + ' spans, 每2.5s微动';
})()`;

// G2: CSS steps 动画（长周期，只在关键帧跳）
const G2_CSS = `
  .liquid span { animation: drift-stepped 240s steps(48) infinite !important; }
  @keyframes drift-stepped {
    0% { transform: translate3d(0,0,0) scale(1); }
    33% { transform: translate3d(5vmax,-3vmax,0) scale(1.07); }
    66% { transform: translate3d(-3vmax,4vmax,0) scale(0.96); }
    100% { transform: translate3d(0,0,0) scale(1); }
  }`;

await evaluate(`document.documentElement.dataset.perf='full'; 'ok'`);
await new Promise((r) => setTimeout(r, 800));

console.log('G0 完整质感基线(10s采样) →', await evaluate(FPS10));

await evaluate(G1_JS);
await new Promise((r) => setTimeout(r, 500));
console.log('G1 低频微动+完整玻璃(10s) →', await evaluate(FPS10));
await evaluate(`window.__perfG1 && clearInterval(window.__perfG1); 'off'`);

await evaluate(`(() => {
  const s = document.createElement('style');
  s.id = 'perf-exp';
  s.textContent = ${JSON.stringify(G2_CSS)};
  document.head.appendChild(s);
  return 'ok';
})()`);
await new Promise((r) => setTimeout(r, 500));
console.log('G2 steps跳变动画(10s) →', await evaluate(FPS10));
await evaluate(`(() => { const s = document.getElementById('perf-exp'); if (s) s.remove(); return 'ok'; })()`);

// 静止对照
await evaluate(`(() => {
  const s = document.createElement('style');
  s.id = 'perf-exp';
  s.textContent = '.liquid span { animation: none !important; }';
  document.head.appendChild(s);
  return 'ok';
})()`);
await new Promise((r) => setTimeout(r, 500));
console.log('G3 全静止对照(10s) →', await evaluate(FPS10));

await evaluate(`(() => { const s = document.getElementById('perf-exp'); if (s) s.remove(); return 'ok'; })()`);
console.log('（页面已恢复原状）');
ws.close();
process.exit(0);
