/* 三体控制台 · 前端 v2
   SSE 实时流 + Codex 流式对话 + 额度面板 */

const $ = (id) => document.getElementById(id);

const HUE = { codex: 265, workbuddy: 45, dsh: 175 };
const KIND_LABEL = { done: '完成', ask: '提问', tool: '工具', info: '日志', warn: '异常', session: '会话' };

const state = {
  data: null,
  selected: null,
  live: true,
  es: null,
  feedStore: new Map(),
  renderedIds: new Set(),
  freshIds: new Set(),
  run: null,
  mode: 'read',
  busy: false,
};

const esc = (s) =>
  String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const hhmmss = (ts) => {
  if (!ts) return '--:--';
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
};

const fmtNum = (n) => {
  if (!Number.isFinite(n)) return '—';
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return String(Math.round(n));
};

const levelOf = (pct) => (pct >= 90 ? 'bad' : pct >= 70 ? 'warn' : 'ok');

const fmtReset = (ms) => {
  if (!ms) return '—';
  const diff = ms - Date.now();
  if (diff <= 0) return '已重置';
  const h = Math.floor(diff / 3600000);
  const m = Math.round((diff % 3600000) / 60000);
  return h > 0 ? `${h}h${m}m 后` : `${m}m 后`;
};

function statusWord(a) {
  return ({running:'正在执行',waiting:'等待确认',idle:'本轮已结束',unknown:'已启动 · 状态未确认',offline:'未运行'})[a.activity?.phase] || '状态未确认';
}

/* ---------------- 顶部 ---------------- */

function renderTop(d) {
  $('sum-running').textContent = `${d.summary.running}/3`;
  $('sum-busy').textContent = String(d.summary.busy);
  const memKB = d.summary.memKB;
  $('sum-mem').textContent = memKB > 1024 * 1024 ? `${(memKB / 1024 / 1024).toFixed(1)}G` : `${Math.round(memKB / 1024)}M`;
  $('sum-clock').textContent = d.clock;
  $('foot-host').textContent = `${d.host} · ${d.platform}`;
  $('foot-ts').textContent = `采样于 ${hhmmss(d.ts)}`;
}

/* ---------------- 执行端卡片 ---------------- */

function quotaStrip(a) {
  const q = a.quota;
  if (!q || q.kind !== 'quota') return '';
  const rows = [];
  for (const [label, w] of [
    ['5h', q.primary],
    ['7d', q.secondary],
  ]) {
    if (!w) continue;
    if(w.stale){rows.push(`<div class="q-line"><span>${label}</span><span>重置后待新采样</span></div>`);continue;}
    const left = w.leftPercent ?? Math.max(0, 100 - (w.usedPercent || 0));
    const lv = left <= 10 ? 'bad' : left <= 30 ? 'warn' : 'ok';
    rows.push(`<div class="q-line" data-level="${lv}">
      <span>${label}</span>
      <span class="track"><i style="width:${left}%"></i></span>
      <span class="pct">剩 ${left}%</span>
    </div>`);
  }
  return rows.length ? `<div class="quota-strip">${rows.join('')}</div>` : '';
}

function renderStage(d) {
  const maxMem = Math.max(...d.agents.map((a) => (a.procs && a.procs.memKB) || 0), 1);
  const host = $('stage');

  for (const a of d.agents) {
    let card = host.querySelector(`[data-id="${a.id}"]`);
    if (!card) {
      card = document.createElement('article');
      card.className = 'glass agent';
      card.dataset.id = a.id;
      card.tabIndex = 0;
      card.innerHTML = `
        <div class="wash" aria-hidden="true"></div>
        <div class="agent-head">
          <div class="agent-title"><h2></h2><p></p></div>
          <span class="orb" aria-hidden="true"></span>
        </div>
        <p class="state-line"></p><p class="activity-evidence"></p>
        <div class="headline">
          <div class="model"><small>模型</small><span data-f="model"></span></div>
          <div class="kv-row"></div>
          <div class="mem"><span data-f="mem"></span><span class="bar"><i></i></span></div>
          <div data-f="quota"></div>
          <p class="now"></p>
        </div>`;
      card.addEventListener('click', () => selectAgent(state.selected === a.id ? null : a.id));
      card.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          selectAgent(state.selected === a.id ? null : a.id);
        }
      });
      host.appendChild(card);
    }

    card.dataset.running = String(!!(a.procs && a.procs.running));
    card.dataset.busy = String(!!a.busy);
    card.setAttribute('aria-selected', String(state.selected === a.id));
    card.style.setProperty('--h', HUE[a.id] ?? 265);

    card.querySelector('h2').textContent = a.name;
    card.querySelector('.agent-title p').textContent = a.subtitle || '';
    card.querySelector('.state-line').innerHTML =
      `<span class="k">${esc(statusWord(a))}</span>` +
      `<span>${a.procs ? a.procs.count : 0} 进程</span>` +
      `<span>· ${esc(a.activityLabel || '—')}</span>`;
    card.querySelector('.state-line').title = `${a.activity?.detail || ''} · ${a.activity?.source || '未知来源'} · 采样 ${hhmmss(a.activity?.sampledAt)}`;
    card.querySelector('.activity-evidence').textContent = `${a.activity?.source || '来源未确认'} · ${a.activity?.detail || ''}`;
    card.querySelector('.model small').textContent = a.headline?.modelSource || '模型记录';
    card.querySelector('[data-f="model"]').textContent = (a.headline && a.headline.model) || '—';

    card.querySelector('.kv-row').innerHTML = (a.metrics || [])
      .map((m) => `<div class="kv" title="${esc(m.hint || '')}"><b>${esc(m.value)}</b><span>${esc(m.label)}</span></div>`)
      .join('');

    card.querySelector('[data-f="quota"]').innerHTML = quotaStrip(a);

    const nowEl = card.querySelector('.now');
    const lastAction = (a.current && a.current.lastAction) || '';
    nowEl.textContent = lastAction && lastAction !== '暂无记录' ? lastAction : '';
    nowEl.style.display = nowEl.textContent ? '-webkit-box' : 'none';

    const memKB = (a.procs && a.procs.memKB) || 0;
    card.querySelector('[data-f="mem"]').textContent = a.procs && a.procs.running ? a.procs.memText : '—';
    card.querySelector('.mem .bar i').style.width = `${Math.min(100, Math.max(2, (memKB / maxMem) * 100))}%`;
  }
}

function selectAgent(id) {
  state.selected = id;
  if (state.data) {
    renderStage(state.data);
    renderFilter();
    renderTabs();
    renderConfig();
    renderFeed(true);
    // 选 Codex 时，把工作目录默认填上
    if (id === 'codex') {
      const c = state.data.agents.find((a) => a.id === 'codex');
      if (c && c.current && c.current.workspace && c.current.workspace !== '—' && !$('opt-cwd').value) {
        $('opt-cwd').value = c.current.workspace;
      }
    }
  }
}

/* ---------------- 活动流 ---------------- */

function filteredFeed() {
  return [...state.feedStore.values()]
    .filter((f) => !state.selected || f.source === state.selected)
    .sort((a, b) => b.ts - a.ts)
    .slice(0, 40);
}

function feedRow(f) {
  const row = document.createElement('div');
  row.className = 'feed-item';
  row.dataset.id = f.id;
  const agent = (state.data?.agents || []).find((a) => a.id === f.source);
  row.innerHTML = `
    <div class="t">${hhmmss(f.ts)}</div>
    <div class="feed-body">
      <span class="feed-tag" style="--tag-h:${HUE[f.source] ?? 265}">
        <i></i>${esc(agent ? agent.name : f.source)} · ${esc(KIND_LABEL[f.kind] || f.kind)}
      </span>
      <span class="txt">${esc(f.text)}</span>
      ${f.meta ? `<span class="m">${esc(f.meta)}</span>` : ''}
    </div>`;
  if (!state.freshIds.has(f.id)) row.style.animation = 'none';
  return row;
}

function renderFeed(reset = false) {
  const host = $('feed');
  const items = filteredFeed();

  if (reset) {
    host.replaceChildren();
    state.renderedIds.clear();
  }

  if (!items.length) {
    host.innerHTML = `<div class="feed-empty">这个来源还没有可显示的记录。跑一轮任务就会出现在这里。</div>`;
    return;
  }

  const existing = host.querySelector('.feed-empty');
  if (existing) existing.remove();

  for (const f of items) {
    if (state.renderedIds.has(f.id)) continue;
    const row = feedRow(f);
    state.renderedIds.add(f.id);
    // 时间倒序：插到正确位置（新条目几乎总在最前）
    const before = [...host.children].find((c) => Number(c.dataset.ts || 0) < f.ts);
    if (before) host.insertBefore(row, before);
    else host.appendChild(row);
    row.dataset.ts = String(f.ts);
  }

  // 裁剪多余节点
  while (host.children.length > 40) host.removeChild(host.lastElementChild);
  state.freshIds.clear();
}

function renderFilter() {
  const d = state.data;
  if (!d) return;
  const host = $('feed-filter');
  const opts = [{ id: null, name: '全部' }, ...d.agents.map((a) => ({ id: a.id, name: a.name }))];
  host.innerHTML = opts
    .map((o) => `<button class="chip" data-src="${o.id || ''}" aria-pressed="${(state.selected || null) === o.id}">${esc(o.name)}</button>`)
    .join('');
  host.querySelectorAll('.chip').forEach((b) => b.addEventListener('click', () => selectAgent(b.dataset.src || null)));
}

/* ---------------- 额度面板 ---------------- */

function renderQuota(d) {
  const host = $('quota');
  const blocks = [];

  for (const a of d.agents) {
    const q = a.quota;
    if (!q) {
      blocks.push(`<div class="q-block">
        <div class="q-head"><b>${esc(a.name)}</b><span class="q-src">无数据</span></div>
        <div class="q-foot">本地没有可读的额度记录。</div>
      </div>`);
      continue;
    }

    if (q.kind === 'quota') {
      // 与 Codex 本体一致：主数字是"剩余"，进度条也按剩余填充
      const rows = [];
      const bar = (label, w) => {
        if (!w) return '';
        if(w.stale)return `<div class="q-meter"><span>${label}</span><span>已到重置时间 · 待新采样</span></div>`;
        const left = w.leftPercent ?? Math.max(0, 100 - (w.usedPercent || 0));
        const lv = left <= 10 ? 'bad' : left <= 30 ? 'warn' : 'ok';
        return `<div class="q-meter" data-level="${lv}" data-left="${lv === 'ok'}">
          <span>${label}</span>
          <span class="track"><i style="width:${left}%"></i></span>
          <span class="num">剩 ${left}%</span>
        </div>`;
      };
      rows.push(bar(`${Math.round((q.primary?.windowMinutes || 300) / 60)}h`, q.primary));
      rows.push(bar(`${Math.round((q.secondary?.windowMinutes || 10080) / 1440)}d`, q.secondary));
      const foot = [
        q.primary && !q.primary.stale ? `已用 <b>${q.primary.usedPercent}%</b>，${fmtReset(q.primary.resetsAt)}重置` : '',
        q.secondary && !q.secondary.stale ? `7d 已用 <b>${q.secondary.usedPercent}%</b>` : '',
        q.credits ? `积分 <b>${q.credits.has_credits ? q.credits.balance : '无（订阅制）'}</b>` : '',
        q.sampledAt ? `采样 ${hhmmss(q.sampledAt)}` : '',
      ].filter(Boolean);
      blocks.push(`<div class="q-block">
        <div class="q-head"><b>${esc(a.name)}</b><span class="q-src">订阅额度</span></div>
        ${rows.join('')}
        <div class="q-foot">${foot.join('')}</div>
      </div>`);
      continue;
    }

    // usage 型（本地计数）
    const foot = [
      `调用 <b>${fmtNum(q.requests)}</b>`,
      q.inputTokens !== undefined ? `输入 <b>${fmtNum(q.inputTokens)}</b>` : '',
      q.outputTokens !== undefined ? `输出 <b>${fmtNum(q.outputTokens)}</b>` : '',
      q.cachedTokens ? `缓存命中 <b>${fmtNum(q.cachedTokens)}</b>` : '',
      q.dailyLimitHit ? `<b style="color:var(--bad)">已达日限</b>` : '',
    ].filter(Boolean);
    const total = q.totalTokens ?? q.tokens ?? 0;
    blocks.push(`<div class="q-block">
      <div class="q-head"><b>${esc(a.name)}</b><span class="q-src">${q.stale ? '最近一次用量' : '今日用量'}</span></div>
      <div class="q-figures">
        <div><b>${fmtNum(total)}</b><span>token</span></div>
        <div><b>${fmtNum(q.requests)}</b><span>调用</span></div>
        <div><b>${q.dailyLimitHit ? '已满' : '正常'}</b><span>日限</span></div>
      </div>
      <div class="q-foot">${foot.join('')}</div>
    </div>`);
  }

  host.innerHTML = blocks.join('');
  $('quota-hint').textContent = '本地可读部分';
}

/* ---------------- 桥接 / 配置 ---------------- */

function renderBridges(d) {
  const host = $('bridges');
  if (!d.bridges || !d.bridges.length) {
    host.innerHTML = `<div class="feed-empty">没有配置任何桥接。</div>`;
    return;
  }
  host.innerHTML =
    `<div class="bridge-pills">` +
    d.bridges
      .map(
        (b) =>
          `<span class="bridge-pill" data-ok="${b.ok !== false}">${esc(b.from)} <i>→</i> ${esc(b.to)}</span>`,
      )
      .join('') +
    `</div>`;
}

function renderTabs() {
  const d = state.data;
  if (!d) return;
  const active = state.selected || d.agents[0].id;
  const host = $('tabs');
  host.innerHTML = d.agents.map((a) => `<button class="tab" data-id="${a.id}" aria-pressed="${a.id === active}">${esc(a.name)}</button>`).join('');
  host.querySelectorAll('.tab').forEach((btn) => btn.addEventListener('click', () => selectAgent(btn.dataset.id)));
}

function renderConfig() {
  const d = state.data;
  if (!d) return;
  const active = state.selected || d.agents[0].id;
  const a = d.agents.find((x) => x.id === active);
  if (!a) return;
  $('cfg-hint').textContent = a.config && a.config.exists ? '已读到' : '文件缺失';

  if (a.error) {
    $('cfg').innerHTML = `<div class="feed-empty">采集失败：${esc(a.error)}</div>`;
    $('cfg-path').textContent = '';
    return;
  }

  $('cfg').innerHTML = (a.config.groups || [])
    .map(
      (g) => `<div class="cfg-group"><h4>${esc(g.title)}</h4>${(g.items || [])
        .map((it) => `<div class="cfg-row"><span class="k">${esc(it.k)}</span><span class="v" data-tone="${esc(it.tone || 'plain')}">${esc(it.v)}</span></div>`)
        .join('')}</div>`,
    )
    .join('');

  const cur = a.current || {};
  $('cfg-path').innerHTML = [
    cur.workspace && cur.workspace !== '—' ? `工作区 ${esc(cur.workspace)}` : '',
    cur.session && cur.session !== '—' ? `会话 ${esc(String(cur.session).slice(0, 26))}` : '',
    a.config.path ? esc(a.config.path) : '',
  ]
    .filter(Boolean)
    .join('<br>');
}

/* ---------------- 对话 ---------------- */


/* ---------------- SSE ---------------- */

function connect() {
  if (state.es) state.es.close();
  const es = new EventSource('/api/stream');
  state.es = es;

  es.addEventListener('state', (e) => {
    const d = JSON.parse(e.data);
    state.data = d;
    renderTop(d);
    renderStage(d);
    renderQuota(d);
    renderBridges(d);
    renderTabs();
    renderConfig();

    let added = false;
    for (const f of d.feed || []) {
      if (!state.feedStore.has(f.id)) {
        state.feedStore.set(f.id, f);
        state.freshIds.add(f.id);
        added = true;
      }
    }
    if (added || !$('feed').children.length) renderFeed(!$('feed').children.length);
  });

  es.addEventListener('feed', (e) => {
    const { items } = JSON.parse(e.data);
    for (const f of items || []) {
      if (state.feedStore.has(f.id)) continue;
      state.feedStore.set(f.id, f);
      state.freshIds.add(f.id);
    }
    renderFeed(false);
  });

  es.onerror = () => {
    if (!state.live) return;
    $('subline').textContent = '实时通道断开，正在重连…';
    setTimeout(() => {
      if (state.live && (!state.es || state.es.readyState === 2)) connect();
    }, 2000);
  };

  es.onopen = () => {
    $('subline').textContent = 'Codex · WorkBuddy · dsh 实时观察';
  };
}

/* ---------------- 交互 ---------------- */

$('btn-live').addEventListener('click', () => {
  state.live = !state.live;
  $('btn-live').setAttribute('aria-pressed', String(state.live));
  // 文字跟着切换，不然点了像没反应
  $('btn-live').textContent = state.live ? '实时' : '已暂停';
  if (state.live) {
    connect();
  } else if (state.es) {
    state.es.close();
  }
});

// 内嵌在工作台里时：返回按钮通知父级切视图，而不是整页跳转
$('btn-back').addEventListener('click', () => {
  if (window.parent !== window) parent.postMessage({ type: 'console:back' }, location.origin);
  else location.href = '/';
});

// 跟随工作台的主题与渲染档位
addEventListener('message', (e) => {
  if (e.origin !== location.origin) return;
  const d = e.data || {};
  if (d.type === 'console:theme') {
    document.documentElement.dataset.theme = d.theme;
    $('btn-theme').textContent = d.theme === 'dark' ? '亮色' : '暗色';
  }
  if (d.type === 'console:perf') {
    document.documentElement.dataset.perf = d.perf === 'full' ? 'full' : 'lite';
  }
});

$('btn-theme').addEventListener('click', () => {
  const dark = document.documentElement.dataset.theme === 'dark';
  const next = dark ? 'light' : 'dark';
  document.documentElement.dataset.theme = next;
  $('btn-theme').textContent = next === 'dark' ? '亮色' : '暗色';
  try {
    localStorage.setItem('console-theme', next);
  } catch {}
  // 通知父级：工作台主题 + 标题栏按钮区颜色跟着一起变
  if (window.parent !== window) {
    try {
      parent.postMessage({ type: 'console:theme', theme: next }, location.origin);
    } catch {}
  } else {
    window.consoleNative?.setOverlayColor(
      next === 'dark' ? '#16161f' : '#f5f3ef',
      next === 'dark' ? '#e8e8f0' : '#5a5568',
    );
  }
});

$('btn-probe').addEventListener('click', async () => {
  const id = state.selected || (state.data && state.data.agents[0] && state.data.agents[0].id) || 'codex';
  const out = $('probe-out');
  const btn = $('btn-probe');
  out.dataset.ok = '';
  out.textContent = `正在探测 ${id}（1~2 秒）…`;
  btn.disabled = true;
  try {
    const res = await fetch('/api/probe', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id }),
    });
    const j = await res.json();
    out.dataset.ok = String(!!j.ok);
    out.textContent = j.ok ? `✓ ${id} 可用：${j.detail}` : `✗ ${id} 不可用：${j.detail}`;
  } catch (e) {
    out.dataset.ok = 'false';
    out.textContent = `✗ 探测请求失败：${e.message}`;
  } finally {
    btn.disabled = false;
  }
});

addEventListener('pointermove', (e) => {
  // 流畅模式下光效是隐藏的，别再每帧写样式触发重绘
  if (document.documentElement.dataset.perf !== 'full') return;
  const g = $('cursor-glow');
  if (g) {
    g.style.setProperty('--mx', `${e.clientX}px`);
    g.style.setProperty('--my', `${e.clientY}px`);
  }
});

if (window.parent !== window) {
  // 内嵌时由父级提供返回与主题，避免出现两个返回入口
  $('btn-theme').hidden = true;
  $('btn-back').hidden = true;
}

const qsTheme = new URLSearchParams(location.search).get('theme');
try {
  const saved = qsTheme || localStorage.getItem('console-theme');
  if (saved === 'dark') {
    document.documentElement.dataset.theme = 'dark';
    $('btn-theme').textContent = '亮色';
  }
} catch {}

// ?nolive=1：不连长连接，只取一次快照
if (new URLSearchParams(location.search).get('nolive') === '1') {
  fetch('/api/state')
    .then((r) => r.json())
    .then((d) => {
      state.data = d;
      for (const f of d.feed || []) state.feedStore.set(f.id, f);
      renderTop(d);
      renderStage(d);
      renderQuota(d);
      renderBridges(d);
      renderTabs();
      renderConfig();
      renderFeed(true);
    })
    .catch(() => {});
} else {
  connect();
}
