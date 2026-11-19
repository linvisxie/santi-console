"""服务端第二批：重命名/隐藏/删除 API + codex name DSH + 项目过滤别名"""
import io

p = r"D:\santi-console\runtime\resources\app\server.mjs"
s = io.open(p, encoding="utf-8").read()
n = 0

# 1. 新 API：rename / delete-session / hide-project（挂在 archive 路由旁）
anchor = """  if (url.pathname === '/api/sessions/archive' && req.method === 'POST') {"""
new = """  if (url.pathname === '/api/rename' && req.method === 'POST') {
    const body = await readBody(req);
    const name = String(body.name || '').trim().slice(0, 80);
    if (!name) return sendJson(res, 400, { error: '名称不能为空' });
    const st = readConsoleState();
    if (!st.aliases || typeof st.aliases !== 'object') st.aliases = { sessions: {}, projects: {} };
    if (!st.aliases.sessions) st.aliases.sessions = {};
    if (!st.aliases.projects) st.aliases.projects = {};
    if (body.kind === 'session' && body.id) st.aliases.sessions[body.id] = name;
    else if (body.kind === 'project' && body.path) st.aliases.projects[body.path] = name;
    else return sendJson(res, 400, { error: '缺少 kind/id/path' });
    writeConsoleState(st);
    return sendJson(res, 200, { ok: true });
  }

  if (url.pathname === '/api/hide-project' && req.method === 'POST') {
    const body = await readBody(req);
    const p = String(body.path || '');
    if (!p) return sendJson(res, 400, { error: '缺少 path' });
    const st = readConsoleState();
    if (!Array.isArray(st.hiddenProjects)) st.hiddenProjects = [];
    if (!st.hiddenProjects.some((x) => x.toLowerCase() === p.toLowerCase())) st.hiddenProjects.push(p);
    writeConsoleState(st);
    return sendJson(res, 200, { ok: true });
  }

  // 删除会话：把对应 Agent 的会话文件真实删除（Agent 桌面端同步消失）。
  // codex 的 rollouts 同目录还有 shards 等伴生文件，按前缀一起删。
  if (url.pathname === '/api/delete-session' && req.method === 'POST') {
    const body = await readBody(req);
    const s = sessionIndex().get(String(body.id || ''));
    if (!s) return sendJson(res, 404, { error: '会话不存在' });
    const file = String(s.file || '');
    if (!file || !path.isAbsolute(file)) return sendJson(res, 400, { error: '路径非法' });
    let removed = 0;
    if (s.agent === 'codex') {
      const dir = path.dirname(file);
      const base = path.basename(file, '.jsonl');
      for (const f of safe(() => fs.readdirSync(dir), [])) {
        if (f.startsWith(base)) {
          safe(() => fs.rmSync(path.join(dir, f), { force: true }));
          removed++;
        }
      }
    } else {
      safe(() => fs.rmSync(file, { force: true }));
      removed = 1;
    }
    const st = readConsoleState();
    if (st.archived && st.archived[body.id]) delete st.archived[body.id];
    if (st.aliases && st.aliases.sessions) delete st.aliases.sessions[body.id];
    writeConsoleState(st);
    SESSION_INDEX = new Map();
    SESSION_INDEX_AT = 0;
    return sendJson(res, 200, { ok: true, removed });
  }

  if (url.pathname === '/api/sessions/archive' && req.method === 'POST') {"""
if anchor in s:
    s = s.replace(anchor, new, 1); n += 1

# 2. dsh 显示名 DSH（server 数据源）
c = s.count("name: 'dsh'")
s = s.replace("name: 'dsh'", "name: 'DSH'")
n += c

io.open(p, "w", encoding="utf-8").write(s)
print("server 第二批：", n, "处")
