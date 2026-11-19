"""成熟平台补强三件套：会话搜索 / 导出 Markdown / 会话置顶"""
import io

# ============ server.mjs ============
p = r"D:\santi-console\runtime\resources\app\server.mjs"
s = io.open(p, encoding="utf-8").read()
n = 0

# 1. state 加 pinnedSessions
old = """    aliases: j && typeof j.aliases === 'object' && j.aliases ? j.aliases : { sessions: {}, projects: {} },
    hiddenProjects: Array.isArray(j && j.hiddenProjects) ? j.hiddenProjects : [],
  };"""
new = """    aliases: j && typeof j.aliases === 'object' && j.aliases ? j.aliases : { sessions: {}, projects: {} },
    hiddenProjects: Array.isArray(j && j.hiddenProjects) ? j.hiddenProjects : [],
    pinnedSessions: Array.isArray(j && j.pinnedSessions) ? j.pinnedSessions : [],
  };"""
if old in s:
    s = s.replace(old, new, 1); n += 1

# 2. collectSessions 出口：标记置顶
old = """  for (const s of out) {
    const a = __st.aliases && __st.aliases.sessions ? __st.aliases.sessions[s.id] : '';
    if (a) s.title = a;
  }
  return out;
}"""
new = """  for (const s of out) {
    const a = __st.aliases && __st.aliases.sessions ? __st.aliases.sessions[s.id] : '';
    if (a) s.title = a;
    s.pinned = Array.isArray(__st.pinnedSessions) && __st.pinnedSessions.includes(s.id);
  }
  // 置顶会话排最前（同级仍按时间倒序）
  out.sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) || b.ts - a.ts);
  return out;
}"""
if old in s:
    s = s.replace(old, new, 1); n += 1

# 3. pin API（挂在 rename 路由旁）
old = """  if (url.pathname === '/api/hide-project' && req.method === 'POST') {"""
new = """  if (url.pathname === '/api/sessions/pin' && req.method === 'POST') {
    const body = await readBody(req);
    const id = String(body.id || '');
    if (!id) return sendJson(res, 400, { error: '缺少 id' });
    const st = readConsoleState();
    if (!Array.isArray(st.pinnedSessions)) st.pinnedSessions = [];
    st.pinnedSessions = st.pinnedSessions.filter((x) => x !== id);
    if (body.pinned) st.pinnedSessions.push(id);
    writeConsoleState(st);
    return sendJson(res, 200, { ok: true, pinned: !!body.pinned });
  }

  if (url.pathname === '/api/hide-project' && req.method === 'POST') {"""
if old in s:
    s = s.replace(old, new, 1); n += 1

# 4. 项目会话列表带 pinned 字段（两处 projectsByAgent 的 sessions.push）
old = """    cur.sessions.push({
      id: s.id,
      agent: s.agent,
      title: s.title ? short(s.title, 46) : `会话 ${String(s.id).split(':').pop().slice(-6)}`,
      ts: s.ts,
      archived: !!(state.archived && state.archived[s.id]),
    });"""
new = """    cur.sessions.push({
      id: s.id,
      agent: s.agent,
      title: s.title ? short(s.title, 46) : `会话 ${String(s.id).split(':').pop().slice(-6)}`,
      ts: s.ts,
      archived: !!(state.archived && state.archived[s.id]),
      pinned: !!s.pinned,
    });"""
c = s.count(old)
s = s.replace(old, new)
n += c

# 5. 会话排序：置顶优先（两处 sessions.sort）
old = "const sessions = v.sessions.sort((a, b) => b.ts - a.ts);"
new = """const sessions = v.sessions.sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) || b.ts - a.ts);"""
c = s.count(old)
s = s.replace(old, new)
n += c

io.open(p, "w", encoding="utf-8").write(s)
print("server 置顶：", n, "处")
