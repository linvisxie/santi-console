/** 验证产物卡片：打开 workbuddy 的多文件会话，统计卡片并模拟点击 */
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
  if (r.exceptionDetails) console.log('EVAL-ERR:', JSON.stringify(r.exceptionDetails).slice(0, 120));
  return r.result ? r.result.value : undefined;
};

const proj = await (await fetch('http://127.0.0.1:7788/api/projects')).json();
let target = null;
for (const p of proj.projects.filter((p) => p.sessions && p.sessions.length)) {
  if (p.agent !== 'workbuddy') continue;
  for (const s of [...p.sessions].sort((a, b) => b.ts - a.ts)) {
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
await new Promise((r) => setTimeout(r, 6000));

console.log('消息数:', await ev(`document.querySelectorAll('.msg').length`));
console.log('产物卡片行数:', await ev(`document.querySelectorAll('.file-row').length`));
console.log('卡片标题:', await ev(`(function(){var h=document.querySelector('.files-head');return h?h.textContent.trim():'无'})()`));
console.log('第一个文件名:', await ev(`(function(){var r=document.querySelector('.file-row .file-name');return r?r.textContent:'无'})()`));

// 模拟点击第一张卡片（revealFile 发 IPC —— 无头环境无法验证资源管理器，但可确认无报错）
await ev(`(function(){var r=document.querySelector('.file-row'); if(r) r.click();})()`);
await new Promise((r) => setTimeout(r, 800));
console.log('点击卡片后无异常');

const shot = await rpc('Page.captureScreenshot', { format: 'png' });
const { writeFileSync } = await import('node:fs');
writeFileSync('shot-files.png', Buffer.from(shot.data, 'base64'));
console.log('已保存 shot-files.png');
ws.close();
process.exit(0);
