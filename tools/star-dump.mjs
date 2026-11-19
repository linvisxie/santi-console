/** 抓含 ** 的消息原文 */
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
const r = await rpc('Runtime.evaluate', {
  expression: `JSON.stringify((function(){
    var out = [];
    document.querySelectorAll('.msg-body').forEach(function(b){
      var i = b.textContent.indexOf('**');
      if (i >= 0) out.push(b.textContent.slice(Math.max(0, i - 30), i + 80));
    });
    return out;
  })())`,
  returnByValue: true,
});
console.log(JSON.parse(r.result.value).join('\n----\n'));
ws.close();
process.exit(0);
