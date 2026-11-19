/** 端到端验证（简化表达式版） */
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
  if (r.exceptionDetails) console.log('EVAL-ERR:', JSON.stringify(r.exceptionDetails).slice(0, 160));
  return r.result ? r.result.value : undefined;
};

const proj = await (await fetch('http://127.0.0.1:7788/api/projects')).json();
let target = null;
for (const p of proj.projects.filter((p) => p.sessions && p.sessions.length)) {
  for (const s of p.sessions)
    if ((s.title || '').includes('SnowLuma')) {
      target = { agent: p.agent, id: s.id, path: p.path };
      break;
    }
  if (target) break;
}
console.log('目标:', target ? target.id.slice(0, 50) : '未找到');

await ev(`location.reload()`);
await new Promise((r) => setTimeout(r, 4000));
const clicked = await ev(`(() => {
  const el = [...document.querySelectorAll('.sess[data-id]')].find((n) => n.dataset.id === ${JSON.stringify(target.id)});
  if (!el) return '节点未找到';
  el.scrollIntoView({ block: 'center' });
  el.click();
  return 'clicked';
})()`);
console.log(clicked);
await new Promise((r) => setTimeout(r, 5000));

console.log('消息数:', await ev(`document.querySelectorAll('.msg').length`));
console.log('加粗元素:', await ev(`document.querySelectorAll('.msg-body b').length`));
console.log('代码块:', await ev(`document.querySelectorAll('.msg-body pre').length`));
console.log('行内代码:', await ev(`document.querySelectorAll('.msg-body code').length`));
console.log('列表项:', await ev(`document.querySelectorAll('.msg-body li').length`));
console.log('产物卡片:', await ev(`document.querySelectorAll('.file-row').length`));
console.log('残留星号的消息:', await ev(`document.querySelectorAll('.msg-body').length - [...document.querySelectorAll('.msg-body')].filter(function(b){return b.textContent.indexOf('**')<0}).length`));
console.log('时间样例:', await ev(`(function(){var h=document.querySelectorAll('.msg-head');var o=[];for(var i=0;i<Math.min(4,h.length);i++){o.push(h[i].lastElementChild.textContent)}return o.join(' , ')})()`));

const shot = await rpc('Page.captureScreenshot', { format: 'png' });
const { writeFileSync } = await import('node:fs');
writeFileSync('shot-replay.png', Buffer.from(shot.data, 'base64'));
console.log('已保存 shot-replay.png');
ws.close();
process.exit(0);
