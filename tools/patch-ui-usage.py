"""前端：assistant 底部用量小字 / 轮询同步带用量 / 状态感"""
import io

p = r"D:\santi-console\runtime\resources\app\public\app-ui.js"
s = io.open(p, encoding="utf-8").read()
n = 0

# 1. 回放 assistant 渲染带 usage 小字
old = """    if (m.role === 'user') addMessage({ role: 'user', text: m.text, ts: m.ts });
    else if (m.role === 'assistant') {
      // addMessage 返回 .msg-body 元素，assistant 直接以 Markdown 渲染
      const body = addMessage({ role: 'assistant', agent: d.agent, text: '', ts: m.ts });
      body.innerHTML = mdToHtml(m.text);
    } else if (m.role === 'usage') {
      if (!threadCompact) addDimRow(`输入 ${fmtNum(m.input)} · 输出 ${fmtNum(m.output)}${m.cached ? ` · 缓存 ${fmtNum(m.cached)}` : ''}`, '用量');
    } else if (m.role === 'tool') addToolRow(m.text, m.meta || 'tool');"""
new = """    if (m.role === 'user') addMessage({ role: 'user', text: m.text, ts: m.ts });
    else if (m.role === 'assistant') {
      // addMessage 返回 .msg-body 元素，assistant 直接以 Markdown 渲染
      const body = addMessage({ role: 'assistant', agent: d.agent, text: '', ts: m.ts });
      body.innerHTML = mdToHtml(m.text);
      if (m.usage) body.insertAdjacentHTML('beforeend', usageLine(m.usage));
    } else if (m.role === 'tool') addToolRow(m.text, m.meta || 'tool');"""
if old in s:
    s = s.replace(old, new, 1); n += 1

# 2. usageLine 辅助函数（放在 mdToHtml 后）
old = """const fmtTime = (ts) => {"""
new = """function usageLine(u) {
  if (!u) return '';
  const parts = [];
  if (u.input) parts.push(`输入 ${fmtNum(u.input)}`);
  if (u.output) parts.push(`输出 ${fmtNum(u.output)}`);
  if (u.cached) parts.push(`缓存 ${fmtNum(u.cached)}`);
  return parts.length ? `<div class="msg-usage">⚡ ${parts.join(' · ')}</div>` : '';
}

const fmtTime = (ts) => {"""
if old in s:
    s = s.replace(old, new, 1); n += 1

# 3. 轮询同步的 assistant 也带 usage；去掉 usage 分支
old = """        for (const m of add) {
          if (m.role === 'user') addMessage({ role: 'user', text: m.text, ts: m.ts });
          else if (m.role === 'assistant') {
            const body = addMessage({ role: 'assistant', agent: d.agent, text: '', ts: m.ts });
            body.innerHTML = mdToHtml(m.text);
          } else if (m.role === 'usage') {
            addDimRow(`输入 ${fmtNum(m.input)} · 输出 ${fmtNum(m.output)}${m.cached ? ` · 缓存 ${fmtNum(m.cached)}` : ''}`, '用量');
          }
        }"""
new = """        for (const m of add) {
          if (m.role === 'user') addMessage({ role: 'user', text: m.text, ts: m.ts });
          else if (m.role === 'assistant') {
            const body = addMessage({ role: 'assistant', agent: d.agent, text: '', ts: m.ts });
            body.innerHTML = mdToHtml(m.text);
            if (m.usage) body.insertAdjacentHTML('beforeend', usageLine(m.usage));
          }
        }
        // 有新内容时给出「实时同步」的呼吸指示
        if (add.length) {
          $('tb-meta').textContent = '● 实时同步中';
          $('tb-meta').classList.add('live');
          setTimeout(() => $('tb-meta').classList.remove('live'), 2500);
        }"""
if old in s:
    s = s.replace(old, new, 1); n += 1

# 4. 轮询追加计数基于消息条数（usage 合并后数量语义变化）——保持现逻辑即可

io.open(p, "w", encoding="utf-8").write(s)
print("前端用量合并：", n, "处")
