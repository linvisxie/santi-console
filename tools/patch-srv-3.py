"""服务端：扫描范围扩大 + 删除/归档项目 API"""
import io

p = r"D:\santi-console\runtime\resources\app\server.mjs"
s = io.open(p, encoding="utf-8").read()
n = 0

# 1. codex 扫描上限 40 → 300
old = "for (const r of codexRollouts().slice(0, 40)) {"
if old in s:
    s = s.replace(old, "for (const r of codexRollouts().slice(0, 300)) {", 1); n += 1

# 2. collectDsh 的 dshSessions(8) → 60
old = "const sessions = dshSessions(8);"
if old in s:
    s = s.replace(old, "const sessions = dshSessions(60);", 1); n += 1

# 3. 删除项目（真实递归删除，带安全校验）+ 归档项目 API
anchor = """  if (url.pathname === '/api/sessions/pin' && req.method === 'POST') {"""
new = """  // 归档项目：把该项目下所有会话标记归档（Agent 侧文件不动）
  if (url.pathname === '/api/archive-project' && req.method === 'POST') {
    const body = await readBody(req);
    const p = String(body.path || '');
    if (!p) return sendJson(res, 400, { error: '缺少 path' });
    const st = readConsoleState();
    if (!st.archived || typeof st.archived !== 'object') st.archived = {};
    let count = 0;
    for (const s2 of collectSessions()) {
      if (String(s2.cwd).toLowerCase() === p.toLowerCase()) {
        st.archived[s2.id] = true;
        count++;
      }
    }
    writeConsoleState(st);
    SESSION_INDEX = new Map();
    SESSION_INDEX_AT = 0;
    return sendJson(res, 200, { ok: true, archived: count });
  }

  // 删除项目：真实递归删除目录（不可恢复，前端需双重确认）。
  // 安全校验：必须是绝对路径、至少两级深度、不落在一个保留名单里。
  if (url.pathname === '/api/delete-project' && req.method === 'POST') {
    const body = await readBody(req);
    const target = path.resolve(String(body.path || ''));
    if (!/^([a-zA-Z]:[\\\\/])/.test(target)) return sendJson(res, 400, { error: '路径非法' });
    const depth = target.split(/[\\\\/]+/).filter(Boolean).length;
    if (depth < 3) return sendJson(res, 400, { error: '拒绝删除过浅的目录' });
    const BLOCK = ['c:\\\\', 'c:\\\\users', 'c:\\\\windows', 'c:\\\\program files', 'd:\\\\', 'c:\\\\users\\\\<user>'];
    if (BLOCK.includes(target.toLowerCase()) || BLOCK.some((b) => target.toLowerCase() === path.resolve(b).toLowerCase()))
      return sendJson(res, 400, { error: '拒绝删除受保护目录' });
    if (!fs.existsSync(target)) return sendJson(res, 404, { error: '目录不存在' });
    fs.rmSync(target, { recursive: true, force: true });
    // 同步从控制台的列表里移除
    const st = readConsoleState();
    if (Array.isArray(st.hiddenProjects)) st.hiddenProjects.push(target);
    st.pinned = (st.pinned || []).filter((x) => x.toLowerCase() !== target.toLowerCase());
    writeConsoleState(st);
    return sendJson(res, 200, { ok: true });
  }

  if (url.pathname === '/api/sessions/pin' && req.method === 'POST') {"""
if anchor in s:
    s = s.replace(anchor, new, 1); n += 1

io.open(p, "w", encoding="utf-8").write(s)
print("server：", n, "处")
