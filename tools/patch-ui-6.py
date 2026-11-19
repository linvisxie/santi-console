"""前端第二批：新建会话按钮 / 搜索增强（展开全部项目）/ 操作慢反馈"""
import io

p = r"D:\santi-console\runtime\resources\app\public\app-ui.js"
s = io.open(p, encoding="utf-8").read()
n = 0

# 1. 项目行右侧「＋ 新建会话」按钮
old = """      <button class="project" title="${esc(p.path)}" aria-current="${
        S.project && S.project.path === p.path && S.project.agent === p.agent
      }">
        <span class="project-name"><i class="dot"></i>${esc(p.name)}<i class="sess-count">${active.length}</i></span>
        ${p.isRepo ? `<span class="proj-tags"><i class="tag">git</i></span>` : ''}
      </button>
      <button class="proj-tw" title="${open ? '收起会话' : '展开会话'}"><i>▾</i></button>"""
new = """      <button class="project" title="${esc(p.path)}" aria-current="${
        S.project && S.project.path === p.path && S.project.agent === p.agent
      }">
        <span class="project-name"><i class="dot"></i>${esc(p.name)}<i class="sess-count">${active.length}</i></span>
        ${p.isRepo ? `<span class="proj-tags"><i class="tag">git</i></span>` : ''}
      </button>
      <button class="proj-new" title="在这个项目里新建会话">＋</button>
      <button class="proj-tw" title="${open ? '收起会话' : '展开会话'}"><i>▾</i></button>"""
if old in s:
    s = s.replace(old, new, 1); n += 1

# 2. proj-new 点击：选中项目 + 进入全新会话状态
old = """    node.querySelector('.proj-tw').addEventListener('click', (e) => {"""
new = """    node.querySelector('.proj-new').addEventListener('click', (e) => {
      e.stopPropagation();
      selectProject(proj, { keepFold: true });
      startNewThread(proj);
    });
    node.querySelector('.proj-tw').addEventListener('click', (e) => {"""
if old in s:
    s = s.replace(old, new, 1); n += 1

# 3. startNewThread：进入全新会话状态
old = """function restoreHistory() {"""
new = """/** 在指定项目里开始一段全新会话（清空对话区，第一条消息发出即建会话） */
function startNewThread(proj) {
  S.thread = null;
  if (S.replayTimer) {
    clearInterval(S.replayTimer);
    S.replayTimer = null;
  }
  $('thread-bar').hidden = true;
  $('messages').innerHTML = `<div class="empty" id="empty">
      <h2>新会话 · ${esc(NAME[proj.agent] || proj.agent)}</h2>
      <p>项目：${esc(proj.name)}。写下第一条消息，${esc(NAME[proj.agent] || proj.agent)} 就会在项目里开始工作。</p>
    </div>`;
  S.history = [];
  saveHistory();
  refreshComposerHint();
  promptEl.focus();
}

function restoreHistory() {"""
if old in s:
    s = s.replace(old, new, 1); n += 1

# 4. 搜索增强：输入时自动展开全部项目（否则折叠项目里的会话搜不到）
old = """document.addEventListener('input', (e) => {
  if (e.target.id !== 'sess-search') return;
  const q = e.target.value.trim().toLowerCase();
  document.querySelectorAll('.sess[data-id]').forEach((el) => {"""
new = """document.addEventListener('input', (e) => {
  if (e.target.id !== 'sess-search') return;
  const q = e.target.value.trim().toLowerCase();
  if (q) {
    // 展开全部项目，否则折叠项目里的会话根本搜不到
    (S.projects || []).forEach((pp) => setOpen(pp, true));
    renderProjects();
  }
  document.querySelectorAll('.sess[data-id]').forEach((el) => {"""
if old in s:
    s = s.replace(old, new, 1); n += 1

# 5. 归档项目后：若当前选中该项目，退出回放 + 显示空状态（防止"莫名其妙显示别的会话"）
old = """      { label: '📦 归档全部会话', act: async () => {
          if (!confirm(`归档项目「${name}」下的全部会话？\\nAgent 侧的会话文件不会被删除。`)) return;
          await fetch('/api/archive-project', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ path }) });
          if (S.project && S.project.path === path) exitThread(false);
          await loadProjects();
        } },"""
new = """      { label: '📦 归档全部会话', act: async () => {
          if (!confirm(`归档项目「${name}」下的全部会话？\\nAgent 侧的会话文件不会被删除。`)) return;
          await fetch('/api/archive-project', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ path }) });
          exitThread(false);
          await loadProjects();
        } },"""
if old in s:
    s = s.replace(old, new, 1); n += 1

# 6. 操作反馈：loadProjects 期间 rail 显示轻提示（归档/删除慢的观感改善）
old = """async function loadProjects(opts) {"""
new = """async function loadProjects(opts) {
  if (!opts || !opts.silent) {
    const rl = document.getElementById('sess-search');
    if (rl) rl.placeholder = '⏳ 正在刷新项目与会话…';
  }"""
if old in s:
    s = s.replace(old, new, 1); n += 1

io.open(p, "w", encoding="utf-8").write(s)
print("前端第二批：", n, "处")
