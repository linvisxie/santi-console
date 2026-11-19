"""用量合并进 assistant / 去重增强 / UUID 清理 / 状态感"""
import io

# ============ server.mjs ============
p = r"D:\santi-console\runtime\resources\app\server.mjs"
s = io.open(p, encoding="utf-8").read()
n = 0

# 1. toolDetail：纯 UUID/hash 的参数显示为内部标识
old = """  if (!args || typeof args !== 'object') return short(String(args || ''), 110);"""
new = """  if (!args || typeof args !== 'object') {
    const raw2 = String(args || '');
    if (/^[0-9a-f]{8}-[0-9a-f]{4}/i.test(raw2) || /^[0-9a-f]{24,}$/i.test(raw2)) return '(内部调用标识)';
    return short(raw2, 110);
  }"""
if old in s:
    s = s.replace(old, new, 1); n += 1

# toolDetail 的字符串早退分支（JSON.parse 失败）也做 UUID 清理
old = """    try {
      args = JSON.parse(args);
    } catch {
      return short(args, 110);
    }"""
new = """    try {
      args = JSON.parse(args);
    } catch {
      if (/^[0-9a-f]{8}-[0-9a-f]{4}/i.test(String(args)) || /^[0-9a-f]{24,}$/i.test(String(args))) return '(内部调用标识)';
      return short(args, 110);
    }"""
c = s.count(old)
s = s.replace(old, new)
n += c

# 2. codexMessages：usage 合并进前一条 assistant（不再独立成行），去重在合并后做
old = """      // token_count：回合级用量（回放里显示在消息下方）
      if (j.type === 'event_msg' && j.payload && j.payload.type === 'token_count') {
        const u = j.payload.info && (j.payload.info.total_token_usage || j.payload.info.last_token_usage);
        if (u && (u.input_tokens || u.output_tokens)) {
          items.push({ ts, kind: 'usage', role: 'usage', input: u.input_tokens || 0, output: u.output_tokens || 0, cached: u.cached_input_tokens || 0 });
        }
        continue;
      }"""
new = """      // token_count：回合级用量（暂存，稍后合并进前面最近的 assistant 消息）
      if (j.type === 'event_msg' && j.payload && j.payload.type === 'token_count') {
        const u = j.payload.info && (j.payload.info.total_token_usage || j.payload.info.last_token_usage);
        if (u && (u.input_tokens || u.output_tokens)) {
          items.push({ ts, role: 'usage', input: u.input_tokens || 0, output: u.output_tokens || 0, cached: u.cached_input_tokens || 0 });
        }
        continue;
      }"""
if old in s:
    s = s.replace(old, new, 1); n += 1

# codexMessages 的去重段前插入合并（特征：相邻去重注释）
old = """    // 去重：codex 对同一条消息会走 event_msg 与 response_item 双通道，
    // 相邻且完全相同的对话消息只保留一条
    const out = [];
    for (const it of items) {
      const prev = out[out.length - 1];
      if (prev && prev.role === it.role && prev.text === it.text && prev.role !== 'tool') continue;
      out.push(it);
    }
    return out;
  };"""
new = """    // 用量行合并进前面最近的 assistant（作为消息底部小字，不独立成行 ——
    // 独立行会把「相邻去重」隔断，也是用户看到一排「用量」的原因）
    const merged = [];
    for (const it of items) {
      if (it.role === 'usage') {
        for (let i = merged.length - 1; i >= 0; i--) {
          if (merged[i].role === 'assistant') {
            if (!merged[i].usage) merged[i].usage = { input: it.input, output: it.output, cached: it.cached };
            break;
          }
        }
        continue;
      }
      merged.push(it);
    }
    // 去重：codex 对同一条消息会走 event_msg 与 response_item 双通道，
    // 相邻且相同（或互为前缀，长的那条来自截断旧数据）的对话消息只保留一条
    const out = [];
    for (const it of merged) {
      const prev = out[out.length - 1];
      if (prev && prev.role === it.role && prev.role !== 'tool' && prev.role !== 'usage') {
        if (prev.text === it.text) continue;
        if (prev.text.length > 80 && (prev.text.startsWith(it.text) || it.text.startsWith(prev.text))) {
          if (it.text.length > prev.text.length) out[out.length - 1] = it;
          continue;
        }
      }
      out.push(it);
    }
    return out;
  };"""
if old in s:
    s = s.replace(old, new, 1); n += 1

io.open(p, "w", encoding="utf-8").write(s)
print("server 用量合并：", n, "处")
