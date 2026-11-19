"""前端补强：搜索框 / 导出按钮 / 置顶菜单项 / 会话置顶角标"""
import io

p = r"D:\santi-console\runtime\resources\app\public\app-ui.js"
s = io.open(p, encoding="utf-8").read()
n = 0

# 1. 会话搜索：rail 内即时过滤（标题/项目名匹配）
old = """function restoreHistory() {"""
new = """/* 会话搜索：输入即过滤左侧树（标题与项目名匹配，置顶优先不受影响） */
document.addEventListener('input', (e) => {
  if (e.target.id !== 'sess-search') return;
  const q = e.target.value.trim().toLowerCase();
  document.querySelectorAll('.sess[data-id]').forEach((el) => {
    if (!q) {
      el.style.display = '';
      return;
    }
    const hit = (el.title || el.textContent || '').toLowerCase().includes(q);
    el.style.display = hit ? '' : 'none';
  });
  document.querySelectorAll('.proj-node').forEach((node) => {
    if (!q) {
      node.style.display = '';
      return;
    }
    const anyVisible = [...node.querySelectorAll('.sess[data-id]')].some((el) => el.style.display !== 'none');
    node.style.display = anyVisible ? '' : 'none';
  });
});

function restoreHistory() {"""
if old in s:
    s = s.replace(old, new, 1); n += 1

# 2. 会话节点加置顶标记 + 项目节点包一层 .proj-node（现有渲染的 sess-row 里加图钉）
old = """  return `<div class="sess${on ? ' on' : ''}" data-agent="${esc(x.agent)}" data-id="${esc(x.id)}" title="${esc(x.title)}">"""
new = """  return `<div class="sess${on ? ' on' : ''}${x.pinned ? ' pinned' : ''}" data-agent="${esc(x.agent)}" data-id="${esc(x.id)}" title="${esc(x.title)}">"""
if old in s:
    s = s.replace(old, new, 1); n += 1

# 3. 右键菜单加「📌 置顶 / 取消置顶」
old = """    items.push(
      { label: '✏️ 重命名', act: () => renameVia('session', id, '', title) },
      { label: '📦 归档', act: async () => {"""
new = """    items.push(
      { label: pinnedNow ? '📉 取消置顶' : '📌 置顶', act: async () => {
          await fetch('/api/sessions/pin', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id, pinned: !pinnedNow }) });
          await loadProjects();
        } },
      { label: '✏️ 重命名', act: () => renameVia('session', id, '', title) },
      { label: '📦 归档', act: async () => {"""
if old in s:
    s = s.replace(old, new, 1); n += 1

# 菜单构建处取 pinnedNow
old = """  if (sessEl) {
    const id = sessEl.dataset.id;
    const title = (sessEl.title || sessEl.textContent || '').trim();
    ctxTarget = { kind: 'session', id, title };"""
new = """  if (sessEl) {
    const id = sessEl.dataset.id;
    const title = (sessEl.title || sessEl.textContent || '').trim();
    const pinnedNow = sessEl.classList.contains('pinned');
    ctxTarget = { kind: 'session', id, title };"""
if old in s:
    s = s.replace(old, new, 1); n += 1

# 4. 导出会话 Markdown（thread-bar 按钮）
old = """$('btn-thread-close').addEventListener('click', () => exitThread());"""
new = """$('btn-thread-close').addEventListener('click', () => exitThread());

/* 导出当前会话为 Markdown */
$('btn-tb-export').addEventListener('click', () => {
  if (!threadData) return;
  const d = threadData;
  const lines = [`# ${d.title || '会话'}`, '', `- Agent：${NAME[d.agent] || d.agent}`, `- 导出时间：${new Date().toLocaleString('zh-CN')}`, `- 会话文件：${d.file || '—'}`, ''];
  for (const m of d.messages || []) {
    const t = m.ts ? new Date(m.ts).toLocaleString('zh-CN') : '';
    if (m.role === 'user') lines.push(`## 你${t ? ` · ${t}` : ''}`, '', m.text, '');
    else if (m.role === 'assistant') lines.push(`## ${NAME[d.agent] || d.agent}${t ? ` · ${t}` : ''}`, '', m.text, '');
    else if (m.role === 'usage') lines.push(`> 用量：输入 ${fmtNum(m.input)} · 输出 ${fmtNum(m.output)}${m.cached ? ` · 缓存 ${fmtNum(m.cached)}` : ''}`, '');
    else if (m.role === 'tool') lines.push(`- 🔧 ${m.text}${m.meta ? ` — ${m.meta}` : ''}`);
    else if (m.role === 'reasoning') lines.push(`> 💭 ${m.text}`);
  }
  if ((d.files || []).length) {
    lines.push('', '## 产物 / 涉及文件', '');
    for (const f of d.files) lines.push(`- ${f}`);
  }
  const blob = new Blob([lines.join('\\n')], { type: 'text/markdown;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${(d.title || '会话').replace(/[\\\\/:*?"<>|]/g, '_').slice(0, 40)}.md`;
  a.click();
  URL.revokeObjectURL(a.href);
});"""
if old in s:
    s = s.replace(old, new, 1); n += 1

io.open(p, "w", encoding="utf-8").write(s)
print("前端补强：", n, "处")
