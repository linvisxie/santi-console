/** 检查 perf 模式与 CSS 是否真正生效 */
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
const ev = async (expr) => {
  const r = await rpc('Runtime.evaluate', { expression: expr, returnByValue: true });
  if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails));
  return r.result.value;
};

console.log('html data-perf:', await ev(`document.documentElement.dataset.perf`));
console.log(
  '样式表数量:',
  await ev(`document.styleSheets.length`),
  '| app.css 规则数:',
  await ev(`(() => { try { return [...document.styleSheets].find(s=>s.href&&s.href.includes('app.css')).cssRules.length } catch(e){ return 'ERR '+e.message } })()`),
);
console.log(
  '含 perf 规则:',
  await ev(`(() => { const s=[...document.styleSheets].find(s=>s.href&&s.href.includes('app.css')); if(!s) return 'no sheet'; let n=0; for (const r of s.cssRules) if (r.cssText && r.cssText.includes('data-perf')) n++; return n; })()`),
);
console.log(
  'rail 的 computed backdropFilter:',
  await ev(`getComputedStyle(document.getElementById('rail')).backdropFilter`),
);
console.log(
  'liquid computed filter:',
  await ev(`getComputedStyle(document.querySelector('.liquid')).filter`),
);
console.log(
  '运行中的动画:',
  await ev(`document.getAnimations().map(a => (a.animationName || a.transitionProperty) + '@' + (a.effect && a.effect.target ? a.effect.target.className : '?')).join(', ')`),
);
ws.close();
process.exit(0);
