"""前端第二批：lightbox / 附件 Codex 式预览 / placeholder 动态 / 新建项目外点收起 / DSH 大写 / 产物卡收起位置"""
import io

p = r"D:\santi-console\runtime\resources\app\public\app-ui.js"
s = io.open(p, encoding="utf-8").read()
n = 0

# F4. 图片 lightbox：点击消息里的图片放大（全屏遮罩，点击关闭）
old = """/* ================= 选中消息的浮动操作条 ================= */"""
new = """/* ================= 图片 lightbox ================= */

const lightbox = document.createElement('div');
lightbox.className = 'lightbox';
lightbox.hidden = true;
document.body.appendChild(lightbox);
lightbox.addEventListener('click', () => {
  lightbox.hidden = true;
  lightbox.innerHTML = '';
});
document.addEventListener('click', (e) => {
  const img = e.target.closest('.msg-attach img, .att img');
  if (!img) return;
  e.preventDefault();
  e.stopPropagation();
  const big = img.dataset.full || img.src;
  lightbox.innerHTML = `<img src="${big}" alt="">`;
  lightbox.hidden = false;
});

/* ================= 选中消息的浮动操作条 ================= */"""
if old in s:
    s = s.replace(old, new, 1); n += 1

# F5. renderAtts 改 Codex 式（大缩略图块 + 右上角 ×）
old = """function renderAtts() {
  const host = $('attachments');
  host.hidden = S.atts.length === 0;
  host.innerHTML = S.atts
    .map(
      (a, i) => `
      <span class="att">
        ${a.isImage ? `<img src="${a.dataUrl}" alt="">` : '📄'}
        <span>${esc(a.name)}</span>
        <span class="x" data-i="${i}" title="移除">×</span>
      </span>`,
    )
    .join('');
  host.querySelectorAll('.x').forEach((b) =>
    b.addEventListener('click', () => {
      S.atts.splice(Number(b.dataset.i), 1);
      renderAtts();
    }),
  );
}"""
new = """function renderAtts() {
  const host = $('attachments');
  host.hidden = S.atts.length === 0;
  host.innerHTML = S.atts
    .map(
      (a, i) => `
      <span class="att${a.isImage ? ' img' : ''}" title="${esc(a.name)}">
        ${a.isImage ? `<img src="${a.dataUrl}" alt="">` : '<span class="att-file">📄</span>'}
        <span class="x" data-i="${i}" title="移除">×</span>
        ${a.isImage ? '' : `<span class="att-name">${esc(a.name)}</span>`}
      </span>`,
    )
    .join('');
  host.querySelectorAll('.x').forEach((b) =>
    b.addEventListener('click', () => {
      S.atts.splice(Number(b.dataset.i), 1);
      renderAtts();
    }),
  );
}"""
if old in s:
    s = s.replace(old, new, 1); n += 1

# F6. placeholder 动态（selectProject / agent 切换后刷新）
old = """function restoreHistory() {"""
new = """function refreshComposerHint() {
  const name = NAME[S.agent] || S.agent || 'Codex';
  promptEl.placeholder = `让 ${name} 做什么？Enter 发送，Shift+Enter 换行`;
}

function restoreHistory() {"""
if old in s:
    s = s.replace(old, new, 1); n += 1

# 在 paintThread 的 S.replaying = false; 后刷新 hint（覆盖所有入口）
old = """    } else if (m.role === 'tool') addToolRow(m.text, m.meta || 'tool');
    else if (m.role === 'reasoning') addDimRow(m.text, '思考');
    else if (m.role === 'gap') addDimRow(m.text, '省略');
  }
  S.replaying = false;"""
new = """    } else if (m.role === 'tool') addToolRow(m.text, m.meta || 'tool');
    else if (m.role === 'reasoning') addDimRow(m.text, '思考');
    else if (m.role === 'gap') addDimRow(m.text, '省略');
  }
  S.replaying = false;
  refreshComposerHint();"""
if old in s:
    s = s.replace(old, new, 1); n += 1

# agent/model 下拉变化时也刷新：ddAgent 回调（找 setBusy 前的 send 里 agent 确定）—— 挂在 ddAgent 变更处
old = """const promptEl = $('prompt');"""
new = """const promptEl = $('prompt');"""
c = s.count(old)

# F7. 新建项目：点击外部自动收起
old = """$('new-project-input').addEventListener('keydown', async (e) => {"""
new = """document.addEventListener('click', (e) => {
  const f = $('new-project-form');
  if (f.hidden) return;
  if (f.contains(e.target) || $('btn-new-project').contains(e.target)) return;
  f.hidden = true;
});

$('new-project-input').addEventListener('keydown', async (e) => {"""
if old in s:
    s = s.replace(old, new, 1); n += 1

io.open(p, "w", encoding="utf-8").write(s)
print("前端第二批：", n, "处")
