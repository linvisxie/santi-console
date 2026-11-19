/**
 * 性能探针：量真实帧率、长任务、重绘层数
 *   node tools/perf.mjs [端口] [标签]
 */
const port = process.argv[2] || '9224';
const label = process.argv[3] || 'default';

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

const evaluate = async (expression) => {
  const r = await rpc('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails));
  return r.result.value;
};

console.log(`\n===== 性能探针 [${label}] =====`);

// 1. 帧率采样：连续 90 帧，记录每帧间隔
const fps = await evaluate(`(async () => {
  const deltas = [];
  let last = performance.now();
  await new Promise((done) => {
    let n = 0;
    const step = () => {
      const t = performance.now();
      deltas.push(t - last);
      last = t;
      if (++n >= 90) return done();
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  });
  deltas.shift();
  const sorted = [...deltas].sort((a, b) => a - b);
  const avg = deltas.reduce((a, b) => a + b, 0) / deltas.length;
  return {
    frames: deltas.length,
    avgMs: Math.round(avg * 10) / 10,
    fps: Math.round(1000 / avg),
    p50: Math.round(sorted[Math.floor(sorted.length * 0.5)]),
    p95: Math.round(sorted[Math.floor(sorted.length * 0.95)]),
    worstMs: Math.round(sorted[sorted.length - 1]),
    over50ms: deltas.filter((d) => d > 50).length,
  };
})()`);
console.log('帧率:', JSON.stringify(fps));

// 2. 长任务（主线程被占住 >50ms 的次数）
const longTasks = await evaluate(`(async () => {
  const entries = [];
  const obs = new PerformanceObserver((list) => {
    for (const e of list.getEntries()) entries.push(Math.round(e.duration));
  });
  try { obs.observe({ entryTypes: ['longtask'] }); } catch (e) { return 'unsupported'; }
  await new Promise((r) => setTimeout(r, 3000));
  obs.disconnect();
  return { count: entries.length, totalMs: entries.reduce((a, b) => a + b, 0), worst: Math.max(0, ...entries) };
})()`);
console.log('长任务(3s):', JSON.stringify(longTasks));

// 3. 动画与滤镜实况
const effects = await evaluate(`(() => {
  const anims = document.getAnimations().length;
  const bd = [...document.querySelectorAll('*')].filter((el) => {
    const s = getComputedStyle(el);
    return s.backdropFilter && s.backdropFilter !== 'none';
  }).map((el) => el.className || el.tagName);
  const liquid = document.querySelector('.liquid');
  return {
    runningAnimations: anims,
    backdropFilterElements: bd,
    liquidExists: !!liquid,
    liquidDisplay: liquid ? getComputedStyle(liquid).display : null,
    dpr: devicePixelRatio,
    viewport: innerWidth + 'x' + innerHeight,
  };
})()`);
console.log('渲染负担:', JSON.stringify(effects, null, 1));

ws.close();
process.exit(0);
