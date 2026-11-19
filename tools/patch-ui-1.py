"""前端批量：链接修复 / usage 中文 / 轮询同步 / lightbox / 附件预览 / placeholder / DSH / 右键菜单"""
import io

p = r"D:\santi-console\runtime\resources\app\public\app-ui.js"
s = io.open(p, encoding="utf-8").read()
n = 0

# F1. inlineMd 链接占位符修复（先保护 [t](u)，再做裸 URL，避免嵌套 <a>）
old = """  // 链接 [文字](url) 与裸 URL —— 点击交给 openExternal（事件委托统一处理）
  s = s.replace(/\\[([^\\]]+)\\]\\((https?:\\/\\/[^)\\s]+)\\)/g, (_, t, u) => `<a href="${u}" data-ext="1">${t}</a>`);
  s = s.replace(/(^|[\\s(])((?:https?:\\/\\/)[^\\s<)"']+)/g, (_, p, u) => `${p}<a href="${u}" data-ext="1">${u}</a>`);"""
new = """  // 链接 [文字](url)：先生成并占位，避免裸 URL 正则把已生成的 <a> 再包一层
  const links = [];
  s = s.replace(/\\[([^\\]]+)\\]\\((https?:\\/\\/[^)\\s]+)\\)/g, (_, t, u) => {
    links.push(`<a href="${u}" data-ext="1">${t}</a>`);
    return `\\u0001L${links.length - 1}\\u0001`;
  });
  // 裸 URL（此时文本里已无 href 属性，不会重复匹配）
  s = s.replace(/(^|[\\s(])((?:https?:\\/\\/)[^\\s<)"']+)/g, (_, p, u) => `${p}<a href="${u}" data-ext="1">${u}</a>`);
  s = s.replace(/\\u0001L(\\d+)\\u0001/g, (_, i) => links[+i]);"""
if old in s:
    s = s.replace(old, new, 1); n += 1

# F2. usage 中文（实时流）
old = """    case 'usage': {
      const u = ev.usage || {};
      const parts = [];
      if (u.input_tokens) parts.push(`in ${u.input_tokens}`);
      if (u.output_tokens) parts.push(`out ${u.output_tokens}`);
      if (u.cached_input_tokens) parts.push(`cached ${u.cached_input_tokens}`);
      if (parts.length) addDimRow(parts.join(' · '), '用量');
      break;
    }"""
new = """    case 'usage': {
      const u = ev.usage || {};
      const parts = [];
      if (u.input_tokens) parts.push(`输入 ${fmtNum(u.input_tokens)}`);
      if (u.output_tokens) parts.push(`输出 ${fmtNum(u.output_tokens)}`);
      if (u.cached_input_tokens) parts.push(`缓存 ${fmtNum(u.cached_input_tokens)}`);
      if (parts.length) addDimRow(parts.join(' · '), '用量');
      break;
    }"""
if old in s:
    s = s.replace(old, new, 1); n += 1

# F3. paintThread：usage 行 + 轮询同步 + files-head 收起按钮
old = """  for (const m of msgs) {
    // 回放显示消息的真实时间；assistant 用 Markdown 渲染（其余保持纯文本）"""
new = """  // 回放实时同步：每 3 秒拉一次会话，有新消息就追加（Agent 桌面端继续干活时能看到流式进展）
  if (S.replayTimer) clearInterval(S.replayTimer);
  const replayId = d.id;
  S.replayTimer = setInterval(async () => {
    if (S.replaying || !S.thread || S.thread.id !== replayId || $('thread-bar').hidden) {
      clearInterval(S.replayTimer);
      return;
    }
    try {
      const j = await (await fetch(`/api/session?id=${encodeURIComponent(replayId)}`)).json();
      if (j.error) return;
      const all = j.messages || [];
      const visible = all.filter((m) => !(threadCompact && (m.role === 'tool' || m.role === 'reasoning')));
      const existing = document.querySelectorAll('#messages > .msg, #messages > .file-card').length;
      if (visible.length + ((j.files || []).length ? 1 : 0) > existing) {
        const add = visible.slice(existing);
        for (const m of add) {
          if (m.role === 'user') addMessage({ role: 'user', text: m.text, ts: m.ts });
          else if (m.role === 'assistant') {
            const body = addMessage({ role: 'assistant', agent: d.agent, text: '', ts: m.ts });
            body.innerHTML = mdToHtml(m.text);
          } else if (m.role === 'usage') {
            addDimRow(`输入 ${fmtNum(m.input)} · 输出 ${fmtNum(m.output)}${m.cached ? ` · 缓存 ${fmtNum(m.cached)}` : ''}`, '用量');
          }
        }
        $('messages').scrollTop = $('messages').scrollHeight;
      }
    } catch {}
  }, 3000);

  for (const m of msgs) {
    // 回放显示消息的真实时间；assistant 用 Markdown 渲染（其余保持纯文本）"""
if old in s:
    s = s.replace(old, new, 1); n += 1

# usage 行渲染（回放循环里）
old = """    } else if (m.role === 'tool') addToolRow(m.text, m.meta || 'tool');
    else if (m.role === 'reasoning') addDimRow(m.text, '思考');
    else if (m.role === 'gap') addDimRow(m.text, '省略');
  }
  S.replaying = false;"""
new = """    } else if (m.role === 'usage') {
      if (!threadCompact) addDimRow(`输入 ${fmtNum(m.input)} · 输出 ${fmtNum(m.output)}${m.cached ? ` · 缓存 ${fmtNum(m.cached)}` : ''}`, '用量');
    } else if (m.role === 'tool') addToolRow(m.text, m.meta || 'tool');
    else if (m.role === 'reasoning') addDimRow(m.text, '思考');
    else if (m.role === 'gap') addDimRow(m.text, '省略');
  }
  S.replaying = false;"""
if old in s:
    s = s.replace(old, new, 1); n += 1

# exitThread 清轮询
old = """function exitThread(redraw = true) {
  if (!S.thread) return;
  S.thread = null;"""
new = """function exitThread(redraw = true) {
  if (!S.thread) return;
  S.thread = null;
  if (S.replayTimer) {
    clearInterval(S.replayTimer);
    S.replayTimer = null;
  }"""
if old in s:
    s = s.replace(old, new, 1); n += 1

io.open(p, "w", encoding="utf-8").write(s)
print("前端第一批：", n, "处")
