"""前端第三批：右键菜单 / DSH 大写 / 额度卡 / hint 刷新"""
import io

p = r"D:\santi-console\runtime\resources\app\public\app-ui.js"
s = io.open(p, encoding="utf-8").read()
n = 0

# F9. NAME.dsh → DSH
old = """const NAME = { codex: 'Codex', workbuddy: 'WorkBuddy', dsh: 'dsh', unknown: '未归属' };"""
new = """const NAME = { codex: 'Codex', workbuddy: 'WorkBuddy', dsh: 'DSH', unknown: '未归属' };"""
if old in s:
    s = s.replace(old, new, 1); n += 1

# ddAgent.set 变更时刷新 hint
old = """  ddAgent = makeDD('代理', (v) => {"""
new = """  ddAgent = makeDD('代理', (v) => {
    S.agent = v;
    refreshComposerHint();"""
if old in s:
    # 保守：仅在确认原回调体首行不是 S.agent = v 时插入
    if "ddAgent = makeDD('代理', (v) => {\n    S.agent = v;\n    refreshComposerHint();" not in s:
        s = s.replace(old, new, 1); n += 1

# F10. rail 额度卡：rail-quota 重写为进度条卡
old = """    const q = cx && cx.quota;
    if (q && q.kind === 'quota' && q.primary) {
      $('rail-quota').textContent = `Codex 5h 剩 ${q.primary.leftPercent}% · 7d 剩 ${q.secondary?.leftPercent ?? '—'}%`;
    } else {
      $('rail-quota').textContent = 'Codex 额度未知';
    }"""
new = """    const q = cx && cx.quota;
    const rq = $('rail-quota');
    if (q && q.kind === 'quota' && q.primary) {
      const bar = (label, left) => {
        const v = Math.max(0, Math.min(100, Number(left) || 0));
        const tone = v <= 10 ? 'var(--bad, oklch(72% 0.18 22))' : v <= 30 ? 'var(--warn, oklch(82% 0.14 72))' : 'var(--good, oklch(78% 0.15 158))';
        return `<div class="rq-row"><span class="rq-label">${label}</span><span class="rq-bar"><i style="width:${v}%;background:${tone}"></i></span><span class="rq-val">剩 ${v}%</span></div>`;
      };
      rq.classList.add('card');
      rq.innerHTML = `<div class="rq-head">Codex 额度</div>${bar('5h', q.primary.leftPercent)}${bar('7d', q.secondary?.leftPercent ?? '—')}`;
    } else {
      rq.classList.remove('card');
      rq.textContent = 'Codex 额度未知';
    }"""
if old in s:
    s = s.replace(old, new, 1); n += 1

# F8. 右键菜单（会话 / 项目）：归档、重命名、删除（会话真删文件；项目从列表移除）
old = """/* ================= 图片 lightbox ================= */"""
new = """/* ================= 右键菜单：会话 / 项目 的 归档·重命名·删除 ================= */

const ctxMenu = document.createElement('div');
ctxMenu.className = 'ctx-menu';
ctxMenu.hidden = true;
document.body.appendChild(ctxMenu);
let ctxTarget = null;

function hideCtx() {
  ctxMenu.hidden = true;
}

document.addEventListener('click', hideCtx);
window.addEventListener('blur', hideCtx);
window.addEventListener('scroll', hideCtx, true);

async function renameVia(kind, id, path, oldName) {
  const input = document.createElement('input');
  input.className = 'ctx-rename';
  input.value = oldName || '';
  input.style.left = '20px';
  input.style.top = '20px';
  document.body.appendChild(input);
  input.focus();
  input.select();
  const commit = async () => {
    const name = input.value.trim();
    input.remove();
    if (!name || name === oldName) return;
    await fetch('/api/rename', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ kind, id, path, name }),
    });
    await loadProjects();
  };
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') commit();
    if (e.key === 'Escape') input.remove();
  });
  input.addEventListener('blur', () => {
    if (document.body.contains(input)) commit();
  });
}

document.addEventListener('contextmenu', (e) => {
  const sessEl = e.target.closest('.sess[data-id]');
  const projEl = e.target.closest('.proj-row');
  if (!sessEl && !projEl) {
    hideCtx();
    return;
  }
  e.preventDefault();
  const items = [];
  if (sessEl) {
    const id = sessEl.dataset.id;
    const title = (sessEl.title || sessEl.textContent || '').trim();
    ctxTarget = { kind: 'session', id, title };
    items.push(
      { label: '✏️ 重命名', act: () => renameVia('session', id, '', title) },
      { label: '📦 归档', act: async () => {
          await fetch('/api/sessions/archive', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id, archived: true }) });
          await loadProjects();
        } },
      { label: '🗑 删除会话', act: async () => {
          if (!confirm(`删除这条会话？\n${title}\n\n将同时从对应的 Agent 桌面端删除，不可恢复。`)) return;
          await fetch('/api/delete-session', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id }) });
          if (S.thread && S.thread.id === id) exitThread(false);
          await loadProjects();
        }, danger: true },
    );
  } else {
    const row = projEl.querySelector('.project');
    const path = row ? row.title : '';
    const nameEl = projEl.querySelector('.project-name');
    const name = (nameEl ? nameEl.textContent.replace(/\\d+$/, '').trim() : '') || path;
    ctxTarget = { kind: 'project', path };
    items.push(
      { label: '✏️ 重命名', act: () => renameVia('project', '', path, name) },
      { label: '📦 从列表移除', act: async () => {
          if (!confirm(`把项目从列表移除？\\n${path}\\n\\n真实目录不会被删除。`)) return;
          await fetch('/api/hide-project', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ path }) });
          await loadProjects();
        }, danger: true },
    );
  }
  ctxMenu.innerHTML = '';
  for (const it of items) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = it.label;
    if (it.danger) b.className = 'danger';
    b.addEventListener('click', async () => {
      hideCtx();
      await it.act();
    });
    ctxMenu.appendChild(b);
  }
  ctxMenu.hidden = false;
  const mw = 168, mh = items.length * 34 + 10;
  ctxMenu.style.left = `${Math.min(e.clientX, innerWidth - mw - 8)}px`;
  ctxMenu.style.top = `${Math.min(e.clientY, innerHeight - mh - 8)}px`;
});

/* ================= 图片 lightbox ================= */"""
if old in s:
    s = s.replace(old, new, 1); n += 1

io.open(p, "w", encoding="utf-8").write(s)
print("前端第三批：", n, "处")
