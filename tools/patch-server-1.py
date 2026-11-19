"""服务端批量修改：全量消息/用量/重命名/隐藏/删除 API"""
import io

p = r"D:\santi-console\runtime\resources\app\server.mjs"
s = io.open(p, encoding="utf-8").read()
n = 0

# S1. readConsoleState 扩展 aliases / hiddenProjects
old = """function readConsoleState() {
  const j = safe(() => JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')), {});
  return {
    archived: j && typeof j.archived === 'object' && j.archived ? j.archived : {},
    pinned: Array.isArray(j && j.pinned) ? j.pinned : [],
  };
}"""
new = """function readConsoleState() {
  const j = safe(() => JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')), {});
  return {
    archived: j && typeof j.archived === 'object' && j.archived ? j.archived : {},
    pinned: Array.isArray(j && j.pinned) ? j.pinned : [],
    aliases: j && typeof j.aliases === 'object' && j.aliases ? j.aliases : { sessions: {}, projects: {} },
    hiddenProjects: Array.isArray(j && j.hiddenProjects) ? j.hiddenProjects : [],
  };
}"""
if old in s:
    s = s.replace(old, new, 1); n += 1

# S2. collectSessions 出口应用会话别名
old = """function collectSessions() {
  const out = [];"""
new = """function collectSessions() {
  const out = [];
  const __st = readConsoleState();"""
if old in s:
    s = s.replace(old, new, 1); n += 1

# collectSessions 的 return out（第一个出现于该函数内）应用别名 —— 用「return out;\n}」紧跟 collectSessions 的特征不可靠，
# 改为在函数 return 前处理：找 "  return out;\n}" 在 collectSessions 段 —— 简化：对 out 数组统一后处理放在函数尾。
# 直接替换 collectSessions 函数体内首个 "  return out;\n}" 为带别名的版本。
idx = s.index("function collectSessions() {")
seg_end = s.index("\nfunction ", idx + 10)
seg = s[idx:seg_end]
if "  return out;\n}" in seg:
    seg = seg.replace(
        "  return out;\n}",
        """  for (const s of out) {
    const a = __st.aliases && __st.aliases.sessions ? __st.aliases.sessions[s.id] : '';
    if (a) s.title = a;
  }
  return out;
}""",
        1,
    )
    s = s[:idx] + seg + s[seg_end:]
    n += 1

# S3. codexLineToItem full 参数
old = """function codexLineToItem(line) {
  let j;
  try {
    j = JSON.parse(line);
  } catch {
    return null;
  }
  const p = j.payload || {};
  const ts = Date.parse(j.timestamp) || now();"""
new = """function codexLineToItem(line, full) {
  let j;
  try {
    j = JSON.parse(line);
  } catch {
    return null;
  }
  const p = j.payload || {};
  const ts = Date.parse(j.timestamp) || now();
  const cut = (t, m) => (full ? String(t || '') : short(t, m));"""
if old in s:
    s = s.replace(old, new, 1); n += 1

pairs = [
    ("short(p.last_agent_message || '回合完成', 240)", "cut(p.last_agent_message || '回合完成', 240)"),
    ("short(ask, 220)", "cut(ask, 220)"),
    ("short(body, 260)", "cut(body, 260)"),
]
for a, b in pairs:
    c = s.count(a)
    s = s.replace(a, b)
    n += c

# S4. codexMessages 调 full=true；并注入 token_count 用量
old = """  const collect = (text) => {
    const items = [];
    for (const j of parseJsonLines(text)) {
      const ts = Date.parse(j.timestamp) || 0;
      const it = codexLineToItem(JSON.stringify(j));
      if (!it) continue;"""
new = """  const collect = (text) => {
    const items = [];
    for (const j of parseJsonLines(text)) {
      const ts = Date.parse(j.timestamp) || 0;
      // token_count：回合级用量（回放里显示在消息下方）
      if (j.type === 'event_msg' && j.payload && j.payload.type === 'token_count') {
        const u = j.payload.info && (j.payload.info.total_token_usage || j.payload.info.last_token_usage);
        if (u && (u.input_tokens || u.output_tokens)) {
          items.push({ ts, kind: 'usage', role: 'usage', input: u.input_tokens || 0, output: u.output_tokens || 0, cached: u.cached_input_tokens || 0 });
        }
        continue;
      }
      const it = codexLineToItem(JSON.stringify(j), true);
      if (!it) continue;"""
if old in s:
    s = s.replace(old, new, 1); n += 1

# S5. wbLineToItem full + wbMessages 调 full
old = """function wbLineToItem(line) {"""
if old in s:
    s = s.replace(old, """function wbLineToItem(line, full) {""", 1); n += 1
old = """      return { ts, kind: j.role === 'user' ? 'ask' : 'done', text: short(body, j.role === 'user' ? 220 : 260), meta: '' };"""
if old in s:
    s = s.replace(old, """      return { ts, kind: j.role === 'user' ? 'ask' : 'done', text: full ? body : short(body, j.role === 'user' ? 220 : 260), meta: '' };""", 1); n += 1
old = """      const it = wbLineToItem(JSON.stringify(j));"""
if old in s:
    s = s.replace(old, """      const it = wbLineToItem(JSON.stringify(j), true);""", 1); n += 1

io.open(p, "w", encoding="utf-8").write(s)
print("server 第一批：", n, "处")
