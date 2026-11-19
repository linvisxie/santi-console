/** RH 调用者 stack 定位 */
const list = await (await fetch('http://127.0.0.1:9224/json/list')).json();
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
  if (r.exceptionDetails) console.log('EVAL-ERR:', JSON.stringify(r.exceptionDetails).slice(0, 150));
  return r.result ? r.result.value : undefined;
};

const hook = [
  '(function(){',
  ' window.__log=[];',
  ' var rh=window.restoreHistory, pt=window.paintThread;',
  ' window.restoreHistory=function(){',
  '  var st=(new Error().stack||"").split("\\n").slice(2,4).join(" <= ");',
  '  window.__log.push("RH<=" + st.slice(0,180));',
  '  return rh.apply(this, arguments);',
  ' };',
  ' window.paintThread=function(d){',
  '  window.__log.push("PT[" + String(d.id||"?").slice(0,24) + "]:" + (d.messages||[]).length);',
  '  return pt.apply(this, arguments);',
  ' };',
  '})()',
].join('\n');
await ev(hook);
await new Promise((r) => setTimeout(r, 10000));
console.log(await ev(`window.__log.join('\n---\n').slice(0, 1500)`));
ws.close();
process.exit(0);
