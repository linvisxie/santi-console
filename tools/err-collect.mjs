/** 收集页面运行时异常 + 关键函数存在性 */
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

let errs = [];
const onMsg = (e) => {
  let j;
  try {
    j = JSON.parse(e.data);
  } catch {
    return;
  }
  if (j.method === 'Runtime.exceptionThrown') {
    const d = j.params.exceptionDetails;
    errs.push(((d.exception && d.exception.description) || d.text || '').slice(0, 200) + ' @ ' + (d.url || '').slice(-40) + ':' + (d.lineNumber ?? '?'));
  }
  if (j.method === 'Log.entryAdded') {
    const e2 = j.params.entry;
    if (e2.level === 'error') errs.push('[log] ' + (e2.text || '').slice(0, 160) + ' @ ' + (e2.url || '').slice(-40));
  }
};
ws.addEventListener('message', onMsg);
await rpc('Runtime.enable', {});
await rpc('Log.enable', {});

// 刷新触发完整加载
await rpc('Runtime.evaluate', { expression: `location.reload()`, returnByValue: true });
await new Promise((r) => setTimeout(r, 5000));

console.log('异常/错误:', errs.length ? '\n  ' + errs.slice(-6).join('\n  ') : '无');
console.log(
  '函数存在:',
  await rpc('Runtime.evaluate', {
    expression: `JSON.stringify({openThread: typeof openThread, mdToHtml: typeof mdToHtml, addAttFiles: typeof addAttFiles, selBar: !!document.getElementById('sel-bar'), S: typeof S})`,
    returnByValue: true,
  }).then((r) => r.result.value),
);
ws.close();
process.exit(0);
