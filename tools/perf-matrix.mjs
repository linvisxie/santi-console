/**
 * 质感模式性能归因实验（全部走 CDP 注入，不改文件）
 * 逐项叠加优化，量帧率，找出"视觉保留最多、帧率达标"的组合。
 *   node tools/perf-matrix.mjs [端口]
 */
const port = process.argv[2] || '9224';

const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
const page = list.find((t) => t.type === 'page');
if (!page) {
  console.error('没找到页面');
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
  'E0 基线(质感full)': '',

  'E1 只停背景动画': `
    .liquid span { animation: none !important; }`,

  'E2 E1+去背景自身blur(渐变本身已柔)': `
    .liquid span { animation: none !important; }
    .liquid { filter: none !important; }`,

  'E3 E2+backdrop减半(42→20/48→24)': `
    .liquid span { animation: none !important; }
    .liquid { filter: none !important; }
    .glass { backdrop-filter: blur(20px) saturate(200%) !important; -webkit-backdrop-filter: blur(20px) saturate(200%) !important; }`,

  'E4 E2+去mix-blend-mode': `
    .liquid span { animation: none !important; mix-blend-mode: normal !important; }
    .liquid { filter: none !important; }
    .grain { display: none !important; }`,

  'E5 组合: 停动画+去自身blur+无blend+backdrop减半': `
    .liquid span { animation: none !important; mix-blend-mode: normal !important; }
    .liquid { filter: none !important; }
    .grain { display: none !important; }
    .glass { backdrop-filter: blur(20px) saturate(200%) !important; -webkit-backdrop-filter: blur(20px) saturate(200%) !important; }`,

  'E6 E5+backdrop降为12px': `
    .liquid span { animation: none !important; mix-blend-mode: normal !important; }
    .liquid { filter: none !important; }
    .grain { display: none !important; }
    .glass { backdrop-filter: blur(12px) saturate(200%) !important; -webkit-backdrop-filter: blur(12px) saturate(200%) !important; }`,

  'E7 E6+常驻面板仅半透明(菜单/弹层除外)': `
    .liquid span { animation: none !important; mix-blend-mode: normal !important; }
    .liquid { filter: none !important; }
    .grain { display: none !important; }
    .rail, .composer, .inspector { backdrop-filter: none !important; -webkit-backdrop-filter: none !important; }
    .glass { backdrop-filter: blur(12px) saturate(200%) !important; -webkit-backdrop-filter: blur(12px) saturate(200%) !important; }`,
};

// 确保从 full 模式开始
await evaluate(`document.documentElement.dataset.perf='full'; 'ok'`);
await new Promise((r) => setTimeout(r, 800));

const results = {};
for (const [name, css] of Object.entries(experiments)) {
  // 移除上一个实验的样式
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
  results[name] = fps;
  console.log(name.padEnd(44), '→', fps);
}

// 清理，恢复原状
await evaluate(`(() => { const s = document.getElementById('perf-exp'); if (s) s.remove(); return 'ok'; })()`);
console.log('\n（页面已恢复原状）');
ws.close();
process.exit(0);
