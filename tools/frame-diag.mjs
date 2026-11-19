/** 监控台 iframe 诊断：src / 文档地址 / 加载态 / 轮询状态 */
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

const st = await ev(`JSON.stringify((()=>{
  const f=document.getElementById('monitor-frame');
  const v=document.getElementById('view-monitor');
  let inner='n/a';
  try{ inner = f.contentDocument ? (f.contentDocument.location.href + ' | ' + f.contentDocument.readyState + ' | kids=' + f.contentDocument.body.children.length) : 'null'; }
  catch(e){ inner='ERR ' + e.message; }
  return { src: f.src || '(空)', attr: f.getAttribute('src') || '(空)', inner,
           vHidden: v.hidden, loading: v.dataset.loading || '(空)', loaded: f.dataset.loaded || '(空)' };
})())`);
console.log(st);
ws.close();
process.exit(0);
