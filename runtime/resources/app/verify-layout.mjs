/**
 * 布局回归：超长消息不应该把输入框挤走，左右两栏必须能滚。
 * 用法：node verify-layout.mjs   （需先启动 chrome --remote-debugging-port=9222）
 */
const CDP = 'http://127.0.0.1:9223/json';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function connect() {
  for (let i = 0; i < 20; i++) {
    try {
      const list = await (await fetch(CDP)).json();
      const page = list.find((t) => t.type === 'page' && t.url.includes('7788'));
      if (page) return page.webSocketDebuggerUrl;
    } catch {}
    await sleep(500);
  }
  throw new Error('没找到控制台页面');
}

const ws = new WebSocket(await connect());
await new Promise((r) => ws.addEventListener('open', r, { once: true }));

let seq = 0;
const evaluate = (expression) =>
  new Promise((resolve, reject) => {
    const id = ++seq;
    const onMsg = (ev) => {
      let m;
      try {
        m = JSON.parse(ev.data);
      } catch {
        return;
      }
      if (m.id !== id) return;
      ws.removeEventListener('message', onMsg);
      if (m.error) return reject(new Error(JSON.stringify(m.error)));
      if (m.result.exceptionDetails) return reject(new Error(m.result.exceptionDetails.text));
      resolve(m.result.result.value);
    };
    ws.addEventListener('message', onMsg);
    ws.send(
      JSON.stringify({
        id,
        method: 'Runtime.evaluate',
        params: { expression, awaitPromise: true, returnByValue: true },
      }),
    );
  });

for (let i = 0; i < 30; i++) {
  if (await evaluate(`!!document.querySelector('.pnode')`)) break;
  await sleep(400);
}

// 注入一条超长消息 + 一条超长无空格文本，最容易撑破布局
await evaluate(`(() => {
  const host = document.getElementById('messages');
  host.innerHTML = '';
  for (let i = 0; i < 12; i++) {
    const d = document.createElement('div');
    d.className = 'msg assistant codex';
    d.innerHTML = '<div class="msg-head"><span class="badge">CX</span>Codex · 21:00</div>' +
      '<div class="body">' + '这是一条很长的消息。'.repeat(120) +
      ' C:/Users/LINVIS~1/AppData/Local/Temp/' + 'a'.repeat(300) + '</div>';
    host.appendChild(d);
  }
  host.scrollTop = 0;
})()`);
await sleep(500);

const layout = await evaluate(`(() => {
  const vh = innerHeight;
  const composer = document.querySelector('.composer-wrap').getBoundingClientRect();
  const msgs = document.getElementById('messages');
  const rail = document.getElementById('projects');
  const inspector = document.getElementById('inspector');
  const sideBody = document.querySelector('.insp-body');

  const scrollTest = (el) => {
    if (!el) return null;
    const before = el.scrollTop;
    el.scrollTop = el.scrollHeight;
    const after = el.scrollTop;
    el.scrollTop = before;
    return {
      scrollHeight: el.scrollHeight,
      clientHeight: el.clientHeight,
      scrollable: el.scrollHeight > el.clientHeight + 1,
      moved: after > before,
    };
  };

  return {
    viewport: vh,
    composerBottom: Math.round(composer.bottom),
    composerVisible: composer.bottom <= vh + 1 && composer.top >= 0,
    mainOverflow: document.querySelector('.main').getBoundingClientRect().height <= vh + 1,
    messages: scrollTest(msgs),
    rail: scrollTest(rail),
    inspectorOpen: getComputedStyle(inspector).opacity,
    sideBody: scrollTest(sideBody),
  };
})()`);

console.log(JSON.stringify(layout, null, 1));

// ---- 展开右栏，确认它也能滚 ----
await evaluate(`document.getElementById('btn-toggle-inspector').click()`);
await sleep(700);
const side = await evaluate(`(() => {
  const el = document.querySelector('.insp-body');
  const before = el.scrollTop;
  el.scrollTop = el.scrollHeight;
  const moved = el.scrollTop > before;
  el.scrollTop = before;
  return {
    scrollHeight: el.scrollHeight,
    clientHeight: el.clientHeight,
    scrollable: el.scrollHeight > el.clientHeight + 1,
    overflowStyle: getComputedStyle(el).overflowY,
    moved,
  };
})()`);
console.log('右栏展开后:', JSON.stringify(side));

const ok =
  layout.composerVisible &&
  layout.mainOverflow &&
  layout.messages.scrollable &&
  layout.messages.moved &&
  layout.rail.scrollable;

console.log(ok ? '\n✅ 布局与滚动正常' : '\n❌ 仍有问题');
ws.close();
process.exit(ok ? 0 : 1);
