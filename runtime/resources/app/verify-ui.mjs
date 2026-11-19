/**
 * 用 CDP 真实点击左栏，验证三件事：
 *  1) 点项目名能展开/收起
 *  2) 点会话能在主区加载正文
 *  3) 三层树的 data-agent 是否正确
 *
 * 用法：node verify-ui.mjs   （需先启动 chrome --remote-debugging-port=9222）
 */
const CDP = 'http://127.0.0.1:9222/json';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function connect() {
  for (let i = 0; i < 20; i++) {
    try {
      const res = await fetch(CDP);
      const list = await res.json();
      const page = list.find((t) => t.type === 'page' && t.url.includes('7788'));
      if (page) return page.webSocketDebuggerUrl;
    } catch {}
    await sleep(500);
  }
  throw new Error('没找到控制台页面');
}

function rpc(ws, id, method, params) {
  return new Promise((resolve, reject) => {
    const onMsg = (ev) => {
      let m;
      try {
        m = JSON.parse(ev.data);
      } catch {
        return;
      }
      if (m.id !== id) return;
      ws.removeEventListener('message', onMsg);
      if (m.error) reject(new Error(JSON.stringify(m.error)));
      else resolve(m.result);
    };
    ws.addEventListener('message', onMsg);
    ws.send(JSON.stringify({ id, method, params }));
  });
}

const url = await connect();
const ws = new WebSocket(url);
await new Promise((r) => ws.addEventListener('open', r, { once: true }));

let seq = 0;
const evaluate = async (expression) => {
  const r = await rpc(ws, ++seq, 'Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' ' + (r.exceptionDetails.exception?.description || ''));
  return r.result.value;
};

// 等页面渲染完
for (let i = 0; i < 30; i++) {
  const ok = await evaluate(`!!document.querySelector('.pnode')`);
  if (ok) break;
  await sleep(400);
}

const info = await evaluate(`(() => {
  const pnodes = [...document.querySelectorAll('.pnode')];
  const first = pnodes[0];
  const sess = first && first.querySelector('.sess[data-id]');
  return {
    pnodeCount: pnodes.length,
    firstAgent: first && first.dataset.agent,
    firstPath: first && first.dataset.path,
    firstOpen: first && first.dataset.open,
    sessionCount: first ? first.querySelectorAll('.sess[data-id]').length : 0,
    firstSessionId: sess && sess.dataset.id,
  };
})()`);
console.log('初始状态:', JSON.stringify(info, null, 1));

// ---- 1) 点项目名：应该收起 ----
await evaluate(`document.querySelector('.pnode .project').click()`);
await sleep(600);
const afterProject = await evaluate(`(() => {
  const n = document.querySelector('.pnode');
  return { open: n.dataset.open, visibleSessions: [...n.querySelectorAll('.sess[data-id]')].filter(e => e.offsetParent !== null).length };
})()`);
console.log('点项目名后:', JSON.stringify(afterProject));

// ---- 2) 再点一次：应该展开 ----
await evaluate(`document.querySelector('.pnode .project').click()`);
await sleep(600);
const afterProject2 = await evaluate(`(() => {
  const n = document.querySelector('.pnode');
  return { open: n.dataset.open, visibleSessions: [...n.querySelectorAll('.sess[data-id]')].filter(e => e.offsetParent !== null).length };
})()`);
console.log('再点一次后:', JSON.stringify(afterProject2));

// ---- 3) 点会话：主区应出现消息 ----
const agent = process.argv[2] || 'codex';
const clicked = await evaluate(`(() => {
  const n = document.querySelector('.anode[data-agent="${agent}"] .pnode');
  if (n.dataset.open === 'false') n.querySelector('.proj-tw').click();
  const s = n.querySelector('.sess[data-id]');
  if (!s) return null;
  const id = s.dataset.id;
  s.click();
  return id;
})()`);
await sleep(3500);
const afterSession = await evaluate(`(() => {
  const msgs = document.querySelectorAll('#messages .msg');
  const bar = document.getElementById('thread-bar');
  return {
    threadHidden: bar.hidden,
    threadTitle: document.getElementById('tb-title').textContent,
    msgCount: msgs.length,
    firstMsg: msgs[0] ? msgs[0].innerText.replace(/\\s+/g, ' ').slice(0, 60) : '',
    loading: !!document.querySelector('.thread-loading'),
    reqState: document.querySelector('.pnode .sess.on') ? 'highlighted' : 'none',
  };
})()`);
console.log(`点 ${agent} 的会话后:`, JSON.stringify(afterSession, null, 1));

// ---- 4) 控制台有没有报错 ----
const errs = await evaluate(`(() => window.__errs || [])()`).catch(() => []);
console.log('页面错误:', JSON.stringify(errs));

ws.close();
process.exit(0);
