"""前端大批：keepScroll / 防串会话 / 新建会话 / 右键菜单补全 / 搜索增强 / rename 修复"""
import io

p = r"D:\santi-console\runtime\resources\app\public\app-ui.js"
s = io.open(p, encoding="utf-8").read()
n = 0

# 1. paintThread 支持 keepScroll（轮询重渲染不强制滚底 —— 修"往上滑被拉回底部"）
old = """function paintThread(d) {
  threadData = d;"""
new = """function paintThread(d, keepScroll) {
  threadData = d;"""
if old in s:
    s = s.replace(old, new, 1); n += 1

old = """  // 回放停在最近的位置（内容刚插入，等一帧再量高度）
  const toBottom = () => {
    host.scrollTop = host.scrollHeight;
  };
  requestAnimationFrame(toBottom);
  setTimeout(toBottom, 80);
  setTimeout(toBottom, 300);
}"""
new = """  // 回放停在最近的位置；轮询重渲染（keepScroll）保持用户当前滚动位置，
  // 不强制拉到底 —— 否则往上翻旧消息时会被莫名其妙拽回底部
  if (keepScroll) {
    host.scrollTop = host.scrollHeight - host.clientHeight <= 80 || S.replayStick
      ? host.scrollHeight
      : S.replayScrollTop || host.scrollHeight;
    return;
  }
  const toBottom = () => {
    host.scrollTop = host.scrollHeight;
  };
  requestAnimationFrame(toBottom);
  setTimeout(toBottom, 80);
  setTimeout(toBottom, 300);
}"""
if old in s:
    s = s.replace(old, new, 1); n += 1

# 2. 轮询：传 keepScroll + 记录滚动位置；并修 d.agent 闭包
old = """      const host = $('messages');
      const atBottom = host.scrollHeight - host.scrollTop - host.clientHeight < 80;
      const ratio = host.clientHeight ? host.scrollTop / Math.max(1, host.scrollHeight - host.clientHeight) : 1;
      paintThread(j);
      if (!atBottom) host.scrollTop = ratio * (host.scrollHeight - host.clientHeight);"""
new = """      const host = $('messages');
      S.replayStick = host.scrollHeight - host.scrollTop - host.clientHeight < 80;
      S.replayScrollTop = S.replayStick ? 0 : host.scrollTop;
      paintThread(j, true);"""
if old in s:
    s = s.replace(old, new, 1); n += 1

# 3. openThread：fetch 返回后校验会话没被切换（防串会话）
old = """  try {
    const res = await fetch(`/api/session?id=${encodeURIComponent(id)}`);
    const j = await res.json();
    if (!res.ok) throw new Error(j.error || `服务返回 ${res.status}`);
    paintThread(j);
  } catch (e) {"""
new = """  try {
    const res = await fetch(`/api/session?id=${encodeURIComponent(id)}`);
    const j = await res.json();
    // 读取期间用户可能已切换/关闭会话 —— 丢弃过期数据，防止显示别的会话
    if (!S.thread || S.thread.id !== id) return;
    if (!res.ok) throw new Error(j.error || `服务返回 ${res.status}`);
    paintThread(j);
  } catch (e) {"""
if old in s:
    s = s.replace(old, new, 1); n += 1

# 4. 归档会话后：若归档的是当前打开的会话，退出回放
old = """      { label: '📦 归档', act: async () => {
          await fetch('/api/sessions/archive', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id, archived: true }) });
          await loadProjects();
        } },"""
new = """      { label: '📦 归档', act: async () => {
          await fetch('/api/sessions/archive', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id, archived: true }) });
          if (S.thread && S.thread.id === id) exitThread(false);
          await loadProjects();
        } },"""
if old in s:
    s = s.replace(old, new, 1); n += 1

# 5. 右键项目菜单补全：归档全部会话 + 删除项目（真实删目录）
old = """    items.push(
      { label: '✏️ 重命名', act: () => renameVia('project', '', path, name) },
      { label: '📦 从列表移除', act: async () => {
          if (!confirm(`把项目从列表移除？\\n${path}\\n\\n真实目录不会被删除。`)) return;
          await fetch('/api/hide-project', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ path }) });
          await loadProjects();
        }, danger: true },
    );"""
new = """    items.push(
      { label: '✏️ 重命名', act: () => renameVia('project', '', path, name) },
      { label: '📦 归档全部会话', act: async () => {
          if (!confirm(`归档项目「${name}」下的全部会话？\\nAgent 侧的会话文件不会被删除。`)) return;
          await fetch('/api/archive-project', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ path }) });
          if (S.project && S.project.path === path) exitThread(false);
          await loadProjects();
        } },
      { label: '📂 从列表移除', act: async () => {
          if (!confirm(`把项目从列表移除？\\n${path}\\n\\n真实目录不会被删除。`)) return;
          await fetch('/api/hide-project', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ path }) });
          await loadProjects();
        } },
      { label: '🗑 删除项目（含目录）', act: async () => {
          if (!confirm(`⚠️ 将真实删除整个项目目录：\\n${path}\\n\\n目录内所有文件（含 Agent 会话）都会被删除，不可恢复！`)) return;
          if (!confirm('再次确认：真的要删除整个目录吗？此操作不可逆。')) return;
          const r = await fetch('/api/delete-project', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ path }) });
          const j = await r.json();
          if (!r.ok) { alert(j.error || '删除失败'); return; }
          if (S.project && S.project.path === path) exitThread(false);
          await loadProjects();
        }, danger: true },
    );"""
if old in s:
    s = s.replace(old, new, 1); n += 1

# 6. rename 修复：blur 延迟（避免与菜单点击焦点竞态导致一闪而过）
old = """  input.addEventListener('blur', () => {
    if (document.body.contains(input)) commit();
  });"""
new = """  input.addEventListener('blur', () => {
    // 延迟检查：菜单点击的焦点迁移是瞬时的，立即 commit 会表现为「没反应」
    setTimeout(() => {
      if (document.body.contains(input)) commit();
    }, 180);
  });"""
if old in s:
    s = s.replace(old, new, 1); n += 1

io.open(p, "w", encoding="utf-8").write(s)
print("前端第一批：", n, "处")
