/** 监控台逐项归因：   node tools/perf-m4.mjs [端口] */
const port = process.argv[2] || '9224';
const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
const page = list.find((t) => t.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r, { once: true }));
let id = 0;
const rpc = (m, p) =>
  new Promise((res, rej) => {
    const n = ++id;
    const on = (e) => {
      let j;
      try {
        j = JSON.parse(e.data);
      } catch {
        return;
      }
      if (j.id !== n) return;
      ws.removeEventListener('message', on);
      if (j.error) return rej(new Error(JSON.stringify(j.error)));
      res(j.result);
    };
    ws.addEventListener('message', on);
    ws.send(JSON.stringify({ id: n, method: m, params: p }));
  });
const ev = async (x) => {
  const r = await rpc('Runtime.evaluate', { expression: x, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails));
  return r.result.value;
};
const FPS = `(async()=>{const d=[];let l=performance.now();await new Promise(done=>{let n=0;const s=()=>{const t=performance.now();d.push(t-l);l=t;if(++n>=90)return done();requestAnimationFrame(s)};requestAnimationFrame(s)});d.shift();const s=[...d].sort((a,b)=>a-b);return Math.round(1000/(d.reduce((a,b)=>a+b,0)/d.length))+'fps(worst '+Math.round(s[s.length-1])+'ms, >50 '+d.filter(x=>x>50).length+'/'+d.length+')'})()`;

const tests = {
  'K0 基线': '',
  'K1 停drift': `.liquid span { animation: none !important; }`,
  'K2 K1+停cursor-glow': `.liquid span { animation: none !important; } .cursor-glow { display: none !important; }`,
  'K3 K2+去liquid filter': `.liquid { filter: none !important; } .liquid span { animation: none !important; } .cursor-glow { display: none !important; }`,
  'K4 K3+玻璃无backdrop': `.liquid { filter: none !important; } .liquid span { animation: none !important; } .cursor-glow { display: none !important; } * { backdrop-filter: none !important; -webkit-backdrop-filter: none !important; }`,
  'K5 只停cursor-glow(其余保留)': `.cursor-glow { display: none !important; }`,
  'K6 只去liquid filter(其余保留)': `.liquid { filter: none !important; }`,
};

for (const [name, css] of Object.entries(tests)) {
  await ev(`(() => { const s = document.getElementById('perf-exp'); if (s) s.remove(); return 1 })()`);
  if (css)
    await ev(`(() => { const s = document.createElement('style'); s.id='perf-exp'; s.textContent = ${JSON.stringify(css)}; document.head.appendChild(s); return 1 })()`);
  await new Promise((r) => setTimeout(r, 800));
  console.log(name.padEnd(30), '→', await ev(FPS));
}
await ev(`(() => { const s = document.getElementById('perf-exp'); if (s) s.remove(); return 1 })()`);
console.log('（已恢复）');
ws.close();
process.exit(0);
