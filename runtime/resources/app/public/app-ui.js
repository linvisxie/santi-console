/* 三体控制台 · 一体化界面
   项目 → 对话 → 改动/预览 */

const $ = (id) => document.getElementById(id);

const S = {
  projects: [],
  project: null,
  agent: 'codex',
  model: '',
  mode: 'read',
  atts: [],
  run: null,
  busy: false,
  es: null,
  changes: null,
  open: new Set(),
  tab: 'changes',
  assistantEl: null,
  history: [],
  archived: [],
  expandAll: false,
  role: '',
  agents: [],
  thread: null,
};

const esc = (s) =>
  String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const TAG = { codex: 'CX', workbuddy: 'WB', dsh: 'DS', unknown: '?' };
const NAME = { codex: 'Codex', workbuddy: 'WorkBuddy', dsh: 'DSH', unknown: '未归属' };

const hhmm = (ts) => {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

async function apiPost(url, body) {
  const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const data = await res.json();
  if (!res.ok || data.error) throw new Error(data.error || `服务返回 ${res.status}`);
  return data;
}
function notify(text, bad = false) {
  let el = $('operation-status');
  if (!el) { el = document.createElement('div'); el.id = 'operation-status'; el.setAttribute('role', 'status'); document.body.append(el); }
  el.textContent = text; el.dataset.bad = String(bad); el.hidden = false;
  clearTimeout(notify.timer); notify.timer = setTimeout(() => { el.hidden = true; }, bad ? 9000 : 3500);
}

/* ================= 项目 ================= */

const STORE = {
  get(key, fallback) {
    try {
      const v = localStorage.getItem(key);
      return v === null ? fallback : JSON.parse(v);
    } catch {
      return fallback;
    }
  },
  set(key, val) {
    try {
      localStorage.setItem(key, JSON.stringify(val));
    } catch {}
  },
};

/* ================= 加载 ================= */

function setRailStatus(text, tone) {
  const el = $('rail-status');
  if (!el) return;
  if (!text) {
    el.hidden = true;
    el.innerHTML = '';
    return;
  }
  el.hidden = false;
  el.dataset.tone = tone || '';
  el.innerHTML = `<span>${esc(text)}</span><br><button id="btn-rail-retry">重新加载</button>`;
  $('btn-rail-retry').addEventListener('click', () => loadProjects());
}

function projectsSkeleton() {
  $('projects').innerHTML = `<div class="skel"><i></i><i></i><i></i><i></i></div>`;
}

async function fetchProjects() {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 25_000);
  try {
    const res = await fetch('/api/projects', { signal: ctl.signal });
    if (!res.ok) throw new Error(`服务返回 ${res.status}`);
    const j = await res.json();
    if (j.error) throw new Error(j.error);
    return j;
  } finally {
    clearTimeout(timer);
  }
}

let projectsRequest = 0;
async function loadProjects(opts = {}) {
  const request = ++projectsRequest;
  if (!opts.silent) {
    const rl = document.getElementById('sess-search');
    if (rl) rl.placeholder = '⏳ 正在刷新项目与会话…';
  }
  const silent = opts.silent === true;
  if (!silent && !S.projects.length) projectsSkeleton();

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const j = await fetchProjects();
      if (request !== projectsRequest) return;
      S.agents = j.agents || [];
      S.projects = j.projects || [];
      S.archived = j.archived || [];
      S.hiddenProjects = j.hiddenProjects || [];
      renderHiddenProjects(j.hiddenProjects || []);
      setRailStatus('');
      renderProjects();
      renderArchive();

      const savedAgent = localStorage.getItem('console-project-agent');
      const saved = localStorage.getItem('console-project');
      const pick =
        S.projects.find((p) => p.path === saved && p.agent === savedAgent) ||
        S.projects.find((p) => p.path === S.project?.path && p.agent === S.project?.agent) ||
        S.projects[0];

      if (pick) {
        if (!isOpen(pick) && !S.expandAll) setOpen(pick, true);
        if (!S.project || S.project.path !== pick.path || S.project.agent !== pick.agent) {
          selectProject(pick, { keepFold: true });
        } else { S.project = pick; $('proj-name').textContent = pick.name; }

      } else {
        $('projects').innerHTML = `<div class="changes-empty" style="padding:12px 10px">
          还没有项目。点击「新建项目」选择文件夹，开始你的第一段会话。</div>`;
      }
      return;
    } catch (e) {
      if (request !== projectsRequest) return;
      const last = attempt === 2;
      const msg = e.name === 'AbortError' ? '请求超时（服务没有响应）' : e.message || String(e);
      if (last) {
        if (!S.projects.length) $('projects').innerHTML = '';
        setRailStatus(`项目列表加载失败：${msg}`, 'bad');
        return;
      }
      await new Promise((r) => setTimeout(r, 700 * (attempt + 1)));
    }
  }
}

/* ================= 折叠状态 ================= */

function openMap() {
  return STORE.get('console-open', {}) || {};
}

const pkey = (p) => `${p.agent || 'codex'}|${p.path.toLowerCase()}`;

function isOpen(p) {
  const m = openMap();
  const k = pkey(p);
  return k in m ? !!m[k] : !!S.expandAll;
}

function setOpen(p, v) {
  const m = openMap();
  m[pkey(p)] = v;
  STORE.set('console-open', m);
  syncCollapseAll();
}

function agentOpenMap() {
  return STORE.get('console-agent-open', {}) || {};
}

function isAgentOpen(id) {
  const m = agentOpenMap();
  return id in m ? !!m[id] : true;
}

function setAgentOpen(id, v) {
  const m = agentOpenMap();
  m[id] = v;
  STORE.set('console-agent-open', m);
}

const relTime = (ts) => {
  if (!ts) return '';
  const d = new Date(ts);
  const today = new Date().setHours(0, 0, 0, 0);
  if (ts >= today) return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  return `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/* ================= 三层树渲染 ================= */

function sessionRow(x) {
  const on = S.thread && S.thread.id === x.id;
  return `<div class="sess${on ? ' on' : ''}${x.pinned ? ' pinned' : ''}" data-agent="${esc(x.agent)}" data-id="${esc(x.id)}" title="${esc(x.title)}">
      <i class="sbadge">${esc(TAG[x.agent] || '?')}</i>
      <span class="stitle">${esc(x.title)}</span>
      <time class="${x.busy?'session-running':''}">${x.busy?'执行中':relTime(x.ts)}</time>
      <button class="arc" data-arc="${esc(x.id)}" title="归档这个会话">归档</button>
    </div>`;
}

function projectNode(p) {
  const open = isOpen(p);
  const active = (p.sessions || []).filter((x) => !x.archived);
  return `
  <div class="pnode" data-agent="${esc(p.agent)}" data-path="${esc(p.path)}" data-open="${open}">
    <div class="proj-row">
      <button class="project" title="${esc(p.path)}" aria-current="${
        S.project && S.project.path === p.path && S.project.agent === p.agent
      }">
        <span class="project-name"><i class="dot"></i>${esc(p.name)}<i class="sess-count">${active.length}</i></span>
        ${p.isRepo ? `<span class="proj-tags"><i class="tag">git</i></span>` : ''}
      </button>
      <button class="proj-new" aria-label="在这个项目里新建会话" title="在这个项目里新建会话"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 3v10M3 8h10"/></svg></button>
      <button class="proj-tw" title="${open ? '收起会话' : '展开会话'}"><i>▾</i></button>
    </div>
    <div class="sess-list">${active.map(sessionRow).join('') || `<div class="sess empty"><span class="stitle">暂无会话</span></div>`}</div>
  </div>`;
}

function agentNode(a) {
  const open = isAgentOpen(a.id);
  return `
  <div class="anode" data-agent="${esc(a.id)}" data-open="${open}">
    <button class="ahead" title="${esc(a.hint || '')}">
      <i class="abadge">${esc(TAG[a.id] || '?')}</i>
      <span class="aname">${esc(a.name)}</span>
      <span class="acount">${a.projectCount} 项目 · ${a.sessionCount} 会话</span>
      <i class="tw">▾</i>
    </button>
    <div class="abody">${
      (a.projects || []).map((p) => projectNode({ ...p, agent: p.agent || a.id })).join('') ||
      `<div class="sess empty"><span class="stitle">暂无未归档项目</span><button class="rail-mini" data-open-recovery>查看归档与隐藏项目</button></div>`
    }</div>
  </div>`;
}

function renderProjects() {
  window.workbench?.integrateProjects();
  const rl0 = document.getElementById('sess-search');
  if (rl0 && rl0.placeholder.indexOf('⏳') === 0) rl0.placeholder = '🔍 搜索会话…';
  const host = $('projects');
  const scrollTop = host.scrollTop;
  if (!S.agents || !S.agents.length) {
    host.innerHTML = `<div class="changes-empty" style="padding:12px 10px">还没有项目。点上面「新建项目」填一个绝对路径。</div>`;
    return;
  }

  host.innerHTML = S.agents.map(agentNode).join('');

  host.querySelectorAll('.ahead').forEach((b) =>
    b.addEventListener('click', () => {
      const node = b.parentElement;
      const id = node.dataset.agent;
      const next = node.dataset.open === 'false';
      node.dataset.open = String(next);
      setAgentOpen(id, next);
    }),
  );

  host.querySelectorAll('.pnode').forEach((node) => {
    const agentId = node.dataset.agent;
    const pathVal = node.dataset.path;
    const p =
      S.projects.find((x) => x.path === pathVal && (x.agent || '') === agentId) ||
      S.projects.find((x) => x.path === pathVal);
    if (!p) {
      console.warn('[console] 找不到项目节点对应的数据', agentId, pathVal);
      return;
    }
    // 数据里可能缺 agent，补上后再用
    const proj = { ...p, agent: p.agent || agentId };
    node.querySelector('.project').addEventListener('click', () => {
      $('rail').classList.remove('dim-current');
      // 点项目名：先写入折叠状态，再由 selectProject 的渲染按新状态出图
      const next = node.dataset.open === 'false';
      setOpen(proj, next);
      selectProject(proj, { keepFold: true });
    });
    node.querySelector('.proj-new').addEventListener('click', (e) => {
      e.stopPropagation();
      selectProject(proj, { keepFold: true });
      startNewThread(proj);
    });
    node.querySelector('.proj-tw').addEventListener('click', (e) => {
      e.stopPropagation();
      const next = node.dataset.open === 'false';
      setOpen(proj, next);
      node.dataset.open = String(next); // CSS 直接生效，不必整树重绘
      syncCollapseAll();
    });
    node.querySelectorAll('.sess[data-id]').forEach((row) =>
      row.addEventListener('click', (e) => {
        if (e.target.closest('.arc')) return;
        openThread(row.dataset.id, proj);
      }),
    );
    node.querySelectorAll('.arc').forEach((b) =>
      b.addEventListener('click', async (e) => {
        e.stopPropagation();
        try { await archiveSession(b.dataset.arc, true); } catch (error) { notify(error.message, true); }
      }),
    );
  });

  syncCollapseAll();
  host.scrollTop = scrollTop;
  host.querySelectorAll('[data-open-recovery]').forEach((button) => button.addEventListener('click', () => openSheet(true)));
}

function syncCollapseAll() {
  const btn = $('btn-collapse-all');
  if (!btn) return;
  // 以真实 DOM 状态为准，避免存储与渲染不同步时按钮文案误导
  const anyOpen = !!$('projects').querySelector('.pnode[data-open="true"]');
  btn.textContent = anyOpen ? '全部收起' : '全部展开';
  btn.setAttribute('aria-pressed', String(anyOpen));
}

/* ================= 归档 ================= */

async function archiveSession(id, archived) {
  if(id.startsWith('workbench:') && window.workbench) return window.workbench.archive(id.slice(10), archived);
  await apiPost('/api/sessions/archive', { id, archived });

  for (const a of S.agents || []) {
    for (const p of a.projects || []) {
      for (const x of p.sessions || []) if (x.id === id) x.archived = archived;
      p.activeCount = (p.sessions || []).filter((x) => !x.archived).length;
      p.archivedCount = (p.sessions || []).length - p.activeCount;
    }
  }
  await loadProjects({ silent: true });
  notify(archived ? '会话已归档' : '会话已恢复');
}

async function loadArchiveOnly() {
  try {
    const res = await fetch('/api/projects');
    const j = await res.json();
    S.archived = j.archived || [];
    renderArchive();
  } catch {}
}

function renderArchive() {
  const host = $('archive-list');
  if (!host) return;
  const list = S.archived || [];
  if (!list.length) {
    host.innerHTML = `<p class="sheet-empty">还没有归档的会话。在左侧会话行点「归档」即可收起历史。</p>`;
    return;
  }
  host.innerHTML = list
    .map(
      (a) => `<div class="arc-row" data-id="${esc(a.id)}">
        <i class="sbadge" style="--h:${a.agent === 'dsh' ? '175' : a.agent === 'workbuddy' ? '45' : '265'}">${esc(TAG[a.agent] || '?')}</i>
        <span class="stitle" title="${esc(a.cwd || '')}">${esc(a.title || a.id)}</span>
        <button data-restore="${esc(a.id)}">恢复</button>
      </div>`,
    )
    .join('');
  host.querySelectorAll('[data-restore]').forEach((b) =>
    b.addEventListener('click', () => archiveSession(b.dataset.restore, false).catch((error) => notify(error.message, true))),
  );
}

function renderHiddenProjects(paths) {
  const host = $('hidden-project-list');
  if (!host) return;
  host.replaceChildren();
  if (!paths.length) { host.textContent = '没有隐藏的项目'; return; }
  for (const path of paths) {
    const row = document.createElement('div'); row.className = 'arc-row';
    const label = document.createElement('span'); label.className = 'stitle'; label.textContent = path; label.title = path;
    const button = document.createElement('button'); button.textContent = '恢复';
    button.addEventListener('click', async () => {
      try { await apiPost('/api/hide-project', { path, hidden: false }); await loadProjects({ silent: true }); notify('项目已恢复'); }
      catch (error) { notify(error.message, true); }
    });
    row.append(label, button); host.append(row);
  }
}

/* ================= 选中项目 ================= */

function selectProject(p, opts = {}) {
  if (!p) return;
  window.workbench?.beforeProject(p);
  const same = S.project && S.project.path === p.path && S.project.agent === p.agent;
  S.project = p;
  localStorage.setItem('console-project', p.path);
  localStorage.setItem('console-project-agent', p.agent || 'codex');

  $('proj-name').textContent = p.name;
  $('proj-path').textContent = p.path;

  // 项目的归属代理决定发消息时的默认代理
  if (p.agent && p.agent !== S.agent) {
    S.agent = p.agent;
    if (ddAgent) ddAgent.set(AGENTS, S.agent);
    loadModels(S.agent);
  }

  if (!opts.keepFold && !isOpen(p)) setOpen(p, true);
  renderProjects();
  if (!opts.keepThread) exitThread();
  restoreHistory();
  loadChanges();
  guessPreview(p);
  window.workbench?.projectSelected(p);
}

/* 新建项目：Electron 不支持 window.prompt（点了没反应的根因），
   改成按钮下方滑出的行内输入框，Enter 提交、Esc 收起 */
let choosingProjectFolder=false;
$('btn-new-project').title='选择项目文件夹；Shift+点击可手动输入路径';
async function addProjectPath(target){
  const response=await fetch('/api/projects',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({path:target,agent:S.agent})});const result=await response.json();if(!response.ok)throw new Error(result.error||'添加项目失败');
  await loadProjects();const normalized=target.replaceAll('\\','/').replace(/\/$/,'').toLowerCase();const created=S.projects.find(p=>p.agent===S.agent&&p.path.replaceAll('\\','/').replace(/\/$/,'').toLowerCase()===normalized)||S.projects.find(p=>p.path.replaceAll('\\','/').toLowerCase()===normalized);
  if(created){setOpen(created,true);selectProject(created,{keepFold:true});}
}
$('btn-new-project').addEventListener('click',async event=>{
  if(event.shiftKey||!window.consoleNative?.chooseProjectFolder){const f=$('new-project-form');f.hidden=!f.hidden;if(!f.hidden)$('new-project-input').focus();return;}
  if(choosingProjectFolder)return;choosingProjectFolder=true;
  try{const target=await window.consoleNative.chooseProjectFolder();if(target)await addProjectPath(target);}
  catch(error){notify(error.message,true);}finally{choosingProjectFolder=false;}
});

document.addEventListener('click', (e) => {
  const f = $('new-project-form');
  if (f.hidden) return;
  if (f.contains(e.target) || $('btn-new-project').contains(e.target)) return;
  f.hidden = true;
});

$('new-project-input').addEventListener('keydown', async (e) => {
  if (e.key === 'Escape') {
    $('new-project-form').hidden = true;
    return;
  }
  if (e.key !== 'Enter') return;
  const target = e.target.value.trim();
  if (!target) return;
  try{await addProjectPath(target);e.target.value='';$('new-project-form').hidden=true;}catch(error){notify(error.message,true);}

});

$('btn-collapse-all').addEventListener('click', () => {
  const anyOpen = (S.projects || []).some((p) => isOpen(p));
  const next = !anyOpen;
  const m = {};
  for (const p of S.projects) m[pkey(p)] = next;
  STORE.set('console-open', m);
  if (next && S.agents) for (const a of S.agents) setAgentOpen(a.id, true);
  renderProjects();
});

/* ================= 模型 ================= */

const AGENTS = [
  { id: 'codex', name: 'Codex' },
  { id: 'workbuddy', name: 'WorkBuddy' },
  { id: 'dsh', name: 'DSH' },
];

// 档位以服务端 /api/models 返回的为主（三家各不相同），这里是兜底
const EFFORTS_FALLBACK = [
  { id: 'low', name: '低' },
  { id: 'medium', name: '中' },
  { id: 'high', name: '高' },
];

let ddAgent = null;
let ddModel = null;
let ddEffort = null;

/** 自绘下拉：原生 select 的浮层在暗色主题下无法控制配色 */
function makeDD(label, onPick) {
  const el = document.createElement('div');
  el.className = 'dd';
  el.innerHTML = `<button type="button" class="dd-btn"><span>${label}</span><b>—</b><i>▾</i></button><div class="dd-menu" hidden></div>`;
  const btn = el.querySelector('.dd-btn');
  const menu = el.querySelector('.dd-menu');
  const valEl = el.querySelector('b');

  let items = [];
  let cur = '';

  const close = () => {
    el.dataset.open = 'false';
    menu.hidden = true;
  };
  const closeOthers = () => document.querySelectorAll('.dd[data-open="true"]').forEach((d) => {
    if (d !== el) {
      d.dataset.open = 'false';
      const m = d.querySelector('.dd-menu');
      if (m) m.hidden = true;
    }
  });

  function paint() {
    valEl.textContent = items.find((i) => i.id === cur)?.name ?? '—';
    menu.innerHTML =
      items
        .map((i) => `<button type="button" class="dd-item" data-v="${esc(i.id)}" aria-selected="${i.id === cur}">${esc(i.name)}</button>`)
        .join('') || `<div class="dd-item">暂无选项</div>`;
    menu.querySelectorAll('.dd-item[data-v]').forEach((x) =>
      x.addEventListener('click', (e) => {
        e.stopPropagation();
        cur = x.dataset.v;
        paint();
        close();
        onPick?.(cur);
      }),
    );
  }

  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (menu.hidden) {
      closeOthers();
      el.dataset.open = 'true';
      menu.hidden = false;
    } else close();
  });
  document.addEventListener('click', () => close());
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') close();
  });

  const api = {
    el,
    set(list, value) {
      items = list;
      cur = value && list.some((i) => i.id === value) ? value : list[0]?.id ?? '';
      paint();
    },
    get: () => cur,
    show(v) {
      el.hidden = !v;
    },
  };
  paint();
  return api;
}

function buildDds() {
  const box = $('dds');
  box.innerHTML = '';
  ddAgent = makeDD('代理', (v) => {
    S.agent = v;
    refreshComposerHint();
    S.agent = v;
    loadModels(v);
  });
  ddModel = makeDD('模型', (v) => {
    S.model = v;
    remember();
    window.workbench?.modelChanged();
  });
  ddEffort = makeDD('档位', (v) => {
    S.effort = v;
    remember();
    window.workbench?.pickerChanged();
  });
  box.append(ddAgent.el, ddModel.el, ddEffort.el);

  ddAgent.set(AGENTS, S.agent);
  const saved = loadRemembered();
  if (saved.agent) {
    S.agent = saved.agent;
    ddAgent.set(AGENTS, S.agent);
  }
  if (saved.effort) S.effort = saved.effort;
}

function remember() {
  try {
    const previous = loadRemembered();
    localStorage.setItem('console-picker', JSON.stringify({ agent: S.agent, model: S.model, effort: S.effort, agents: { ...(previous.agents || {}), [S.agent]: { model: S.model, effort: S.effort } } }));
  } catch {}
}

function loadRemembered() {
  try {
    return JSON.parse(localStorage.getItem('console-picker') || '{}');
  } catch {
    return {};
  }
}

let modelsRequest = 0;
async function loadModels(agent, options = {}) {
  const request = ++modelsRequest;
  const requestedAgent = agent || S.agent;
  S.agent = requestedAgent;
  refreshComposerHint();
  let models = [];
  let efforts = EFFORTS_FALLBACK;
  let modelEfforts = null;
  try {
    const res = await fetch(`/api/models?agent=${requestedAgent}`);
    if (!res.ok) throw new Error(`模型加载失败：${res.status}`);
    const j = await res.json();
    modelEfforts = j.modelEfforts;
    models = (j.models || []).map((m) => ({ id: m.id, name: m.name }));
    if (Array.isArray(j.efforts) && j.efforts.length) efforts = j.efforts;
  } catch (error) {
    if (request === modelsRequest) notify(error.message, true);
  }
  if (request !== modelsRequest || S.agent !== requestedAgent) return;
  if (!models.length) models = [{ id: '', name: '默认' }];

  const remembered = loadRemembered();
  const savedAgent = remembered.agents?.[requestedAgent] || (remembered.agent === requestedAgent ? remembered : {});
  const prefer = options.model || savedAgent.model || (models.some((m) => m.id === S.model) ? S.model : '');
  ddModel.set(models, prefer);
  S.model = ddModel.get();
  if(modelEfforts?.[S.model]?.length)efforts=modelEfforts[S.model];

  // 三家都支持推理档位，但档位集合不同：
  // Codex 走 -c model_reasoning_effort，WorkBuddy 走 --effort，dsh 走 --patch 覆盖 agent-default-model
  const prev = options.effort !== undefined ? options.effort : savedAgent.effort || S.effort || '';
  const fallback = efforts.some((e) => e.id === 'medium') ? 'medium' : efforts[0].id;
  const pick = efforts.some((e) => e.id === prev) ? prev : fallback;
  ddEffort.set(efforts, pick);
  S.effort = ddEffort.get();
  remember();
}

$('messages').addEventListener('click', (e) => {
  const link = e.target.closest('a[href]');
  if (!link || link.dataset.file || !/^https?:\/\//i.test(link.href)) return;
  e.preventDefault();
  if (window.consoleNative) window.consoleNative.openExternal(link.href);
  else window.open(link.href, '_blank', 'noopener');
});

/* ================= 消息 ================= */

function histKey() {
  return `console-msgs:${S.project ? `${S.project.agent || 'codex'}|${S.project.path}` : 'none'}`;
}

function saveHistory() {
  try {
    localStorage.setItem(histKey(), JSON.stringify(S.history.slice(-200)));
  } catch {}
}

function refreshComposerHint() {
  const name = NAME[S.agent] || S.agent || 'Codex';
  promptEl.placeholder = `让 ${name} 做什么？Enter 发送，Shift+Enter 换行`;
}

/* 会话搜索：输入即过滤左侧树（标题与项目名匹配，置顶优先不受影响） */
document.addEventListener('input', async (e) => {
  if (e.target.id !== 'sess-search') return;
  const q = e.target.value.trim().toLowerCase();
  if (q) {
    // 展开全部项目，否则折叠项目里的会话根本搜不到
    (S.projects || []).forEach((pp) => setOpen(pp, true));
    renderProjects();
  }
  document.querySelectorAll('.sess[data-id]').forEach((el) => {
    if (!q) {
      el.style.display = '';
      return;
    }
    const hit = (el.title || el.textContent || '').toLowerCase().includes(q);
    el.style.display = hit ? '' : 'none';
  });
  document.querySelectorAll('.pnode').forEach((node) => {
    if (!q) {
      node.style.display = '';
      return;
    }
    const anyVisible = [...node.querySelectorAll('.sess[data-id]')].some((el) => el.style.display !== 'none');
    node.style.display = anyVisible ? '' : 'none';
  });
  // 归档会话也纳入搜索：匹配的归档会话显示在搜索框下方，可直接打开回放
  const old = document.getElementById('arch-search-hits');
  if (old) old.remove();
  if (!q) return;
  try {
    const proj2 = await (await fetch('/api/projects')).json();
    const hits = (proj2.archived || []).filter((a) => !a.missing && (a.title || '').toLowerCase().includes(q)).slice(0, 8);
    if (!hits.length) return;
    const box = document.createElement('div');
    box.id = 'arch-search-hits';
    box.className = 'arch-hits';
    box.innerHTML = '<div class="arch-hits-head">📦 归档中的匹配</div>';
    for (const a of hits) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'arch-hit';
      b.innerHTML = `<span class="arch-title">${esc(a.title || '会话')}</span><span class="arch-meta">${esc(NAME[a.agent] || a.agent)}</span>`;
      b.addEventListener('click', () => {
        const p2 = (S.projects || []).find((x) => x.agent === a.agent && String(x.path).toLowerCase() === String(a.cwd).toLowerCase());
        document.getElementById('sess-search').value = '';
        box.remove();
        openThread(a.id, p2 || { path: a.cwd, agent: a.agent, name: (a.cwd || '').split(/[\\/]/).pop() });
      });
      box.appendChild(b);
    }
    const anchor = document.querySelector('.sess-search');
    if (anchor) anchor.after(box);
  } catch {}
});

/** 在指定项目里开始一段全新会话（清空对话区，第一条消息发出即建会话） */
function startNewThread(proj) {
  if (window.workbench) return window.workbench.newConversation(proj);
  replayGeneration++;
  S.replaying = false;
  S.thread = null;
  if (S.replayTimer) {
    clearInterval(S.replayTimer);
    S.replayTimer = null;
  }
  $('thread-bar').hidden = true;
  $('messages').innerHTML = `<div class="empty" id="empty">
      <h2>新会话 · ${esc(NAME[proj.agent] || proj.agent)}</h2>
      <p>项目：${esc(proj.name)}。写下第一条消息，${esc(NAME[proj.agent] || proj.agent)} 就会在项目里开始工作。</p>
    </div>`;
  S.history = [];
  saveHistory();
  refreshComposerHint();
  promptEl.focus();
}

function restoreHistory() {
  S.history = [];
  try {
    S.history = JSON.parse(localStorage.getItem(histKey()) || '[]');
  } catch {}
  const host = $('messages');
  host.innerHTML = '';
  if (!S.history.length) {
    host.innerHTML = `<div class="empty" id="empty">
      <h2>开始一段新的对话</h2>
      <p>选一个项目，在下面写下任务。Codex 会在该项目里真执行，改动与预览会实时出现在右侧。</p>
    </div>`;
    return;
  }
  S.replaying = true;
  for (const m of S.history) {
    if (m.kind === 'tool') addToolRow(m.text, m.label);
    else if (m.kind === 'dim') addDimRow(m.text, m.label);
    else addMessage({ role: m.role, agent: m.agent, text: m.text, attachments: m.attachments });
  }
  $('messages').scrollTop = $('messages').scrollHeight;
  S.replaying = false;
}

function clearEmpty() {
  const e = $('empty');
  if (e) e.remove();
}

function addMessage({ role, text, agent, attachments, streaming, ts }) {
  clearEmpty();
  const wrap = document.createElement('div');
  wrap.className = `msg ${role}${role === 'assistant' ? ' ' + agent : ''}`;
  const label = role === 'user' ? '你' : NAME[agent] || agent;
  const tag = role === 'user' ? 'YOU' : TAG[agent] || agent;
  // 回放用消息真实时间，实时流用当前时间
  const when = ts ? hhmm(ts) : hhmm(Date.now());
  wrap.innerHTML = `
    <div class="msg-head">
      <span class="badge">${esc(tag)}</span>
      <span>${esc(label)}</span>
      <span>· ${when}</span>
    </div>
    <div class="msg-body"></div>`;
  const body = wrap.querySelector('.msg-body');
  if (text) body.textContent = text;
  if (streaming) body.classList.add('caret');

  if (attachments && attachments.length) {
    const box = document.createElement('div');
    box.className = 'msg-attach';
    for (const a of attachments) {
      if (!a.isImage) continue;
      const img = document.createElement('img');
      // 实时发送带 dataUrl；回放用服务端落盘文件的 /uploads/ 地址
      img.src = a.dataUrl || (a.path ? '/uploads/' + encodeURIComponent(String(a.path).split(/[\\/]/).pop()) : '');
      img.alt = a.name || '';
      img.loading = 'lazy';
      box.appendChild(img);
    }
    if (box.children.length) wrap.appendChild(box);
  }

  $('messages').appendChild(wrap);
  scrollBottom();
  if (!S.replaying) {
    S.history.push({
      role,
      agent,
      text,
      ts: Date.now(),
      attachments: (attachments || []).map((a) => ({ name: a.name, isImage: a.isImage, path: a.path })),
    });
    saveHistory();
  }
  return body;
}

function addToolRow(text, label) {
  const wrap = document.createElement('div');
  wrap.className = 'msg tool';
  wrap.innerHTML = `<div class="msg-head"><span class="badge">$ </span><span>${esc(label || 'shell')}</span></div><div class="msg-body"></div>`;
  wrap.querySelector('.msg-body').textContent = text;
  $('messages').appendChild(wrap);
  scrollBottom();
  if (!S.replaying) {
    S.history.push({ kind: 'tool', text, label, ts: Date.now() });
    saveHistory();
  }
}

function addDimRow(text, label) {
  const wrap = document.createElement('div');
  wrap.className = 'msg dim';
  // 思考/信息默认折叠，点头部展开 —— 回放和实时流都一样
  wrap.innerHTML = `<div class="dim-head"><span class="dim-arrow">▸</span><span>${esc(label || '信息')}</span></div><div class="msg-body" hidden></div>`;
  const dimBody = wrap.querySelector('.msg-body');
  dimBody.textContent = text;
  wrap.querySelector('.dim-head').addEventListener('click', () => {
    dimBody.hidden = !dimBody.hidden;
    wrap.querySelector('.dim-arrow').textContent = dimBody.hidden ? '▸' : '▾';
  });
  $('messages').appendChild(wrap);
  scrollBottom();
  if (!S.replaying) {
    S.history.push({ kind: 'dim', text, label, ts: Date.now() });
    saveHistory();
  }
}

function scrollBottom() {
  if (S.replaying) return;
  const m = $('messages');
  if (m.scrollHeight - m.scrollTop - m.clientHeight < 160) m.scrollTop = m.scrollHeight;
}

function typeInto(el, text) {
  let i = 0;
  const step = Math.max(2, Math.ceil(text.length / 120));
  const timer = setInterval(() => {
    i += step;
    el.textContent = text.slice(0, i);
    scrollBottom();
    if (i >= text.length) {
      clearInterval(timer);
      el.classList.remove('caret');
    }
  }, 16);
}

/* UI 校验用样例（?fixture=1），只渲染不落库 */
function renderFixture() {
  S.replaying = true;
  $('messages').innerHTML = '';
  addMessage({ role: 'user', text: '把 console 的 README 补一节，说明右侧改动面板的数据来源。' });
  addToolRow('rg -n "changes" console/server.mjs', 'shell');
  addMessage({
    role: 'assistant',
    agent: 'codex',
    text: '已补好，写在 README 的「改动面板」小节：git 仓库走 git status/diff，非 git 项目从会话里的编辑调用还原；归属按最近一次编辑它的代理判定。',
  });
  addMessage({ role: 'assistant', agent: 'workbuddy', text: '顺带把 README 里的旧截图路径也改成了 ui-light.png。' });
  $('messages').scrollTop = $('messages').scrollHeight;
  S.replaying = false;
}

/* ================= 附件 ================= */

$('btn-attach').addEventListener('click', () => $('file').click());

async function addAttFiles(fileList) {
  let i = 0;
  for (const f of fileList) {
    if (f.size > 40 * 1024 * 1024) {
      addDimRow(`${f.name || '图片'} 超过 40MB，已跳过`, '附件');
      continue;
    }
    // 剪贴板粘贴的图片没有名字（或一律叫 image.png），补个可辨识的
    const name = f.name && f.name !== 'image.png' ? f.name : `paste-${Date.now()}-${++i}.png`;
    const dataUrl = await new Promise((resolve) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.readAsDataURL(f);
    });
    const res = await fetch('/api/upload', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name, dataUrl }),
    });
    const j = await res.json();
    if (!res.ok) {
      addDimRow(`${name}：${j.error || '上传失败'}`, '附件');
      continue;
    }
    S.atts.push({ ...j, name, dataUrl });
    renderAtts();
  }
}

$('file').addEventListener('change', async (e) => {
  const files = [...(e.target.files || [])];
  e.target.value = '';
  await addAttFiles(files);
});


function renderAtts() {
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
}

/* ================= 发送 ================= */

const promptEl = $('prompt');
promptEl.addEventListener('input', () => {
  promptEl.style.height = 'auto';
  promptEl.style.height = `${Math.min(150, promptEl.scrollHeight)}px`;
});
promptEl.addEventListener('keydown', (e) => {
  if(e.isComposing || e.keyCode===229)return;
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    send();
  }
});
$('btn-send').addEventListener('click', send);

// 像 Codex 一样：输入框直接 Ctrl+V 粘贴截图
promptEl.addEventListener('paste', (e) => {
  const files = [...(e.clipboardData?.items || [])]
    .filter((it) => it.kind === 'file' && /^image\//.test(it.type))
    .map((it) => it.getAsFile())
    .filter(Boolean);
  if (!files.length) return;
  e.preventDefault();
  addAttFiles(files);
});

$('btn-mode').addEventListener('click', () => {
  S.mode = S.mode === 'read' ? 'edit' : 'read';
  $('btn-mode').dataset.mode = S.mode;
  $('btn-mode').textContent = S.mode === 'edit' ? '可写' : '只读';
});

async function send() {
  if (window.workbench) return window.workbench.send();
  const text = promptEl.value.trim();
  if (!text || S.busy) return;
  if (!S.project) return notify('先选一个项目', true);
  // 历史会话是只读回放：一旦发消息就进入新一轮，把它收掉
  if (S.thread) {
    replayGeneration++;
    S.replaying = false;
    S.thread = null;
    // 关键：同时清回放轮询与计数 —— 否则在途的轮询请求会把旧会话的
    // 消息/产物卡片渲染进刚清空的新对话里
    if (S.replayTimer) {
      clearInterval(S.replayTimer);
      S.replayTimer = null;
    }
    S.replayCount = 0;
    $('thread-bar').hidden = true;
    $('messages').innerHTML = '';
    S.history = [];
    saveHistory();
    renderProjects();
  }
  addMessage({ role: 'user', text, attachments: S.atts });
  promptEl.value = '';
  promptEl.style.height = 'auto';
  setBusy(true, '提交中');

  const attachments = S.atts.map((a) => a.path);
  S.atts = [];
  renderAtts();

  try {
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        prompt: text,
        cwd: S.project.path,
        agent: S.agent,
        model: S.model || undefined,
        effort: S.effort || undefined,
        mode: S.mode,
        attachments,
      }),
    });
    const j = await res.json();
    if (!res.ok) {
      addDimRow(j.error || '提交失败', '错误');
      setBusy(false, '待命');
    }
  } catch (e) {
    addDimRow(String(e.message || e), '错误');
    setBusy(false, '待命');
  }
}

function setBusy(busy, label) {
  S.busy = busy;
  $('btn-send').disabled = busy;
  $('btn-stop').hidden = !busy;
  $('run-state').textContent = label || (busy ? '运行中' : '待命');
  $('run-state').dataset.busy = String(!!busy);
  if (!busy) S.assistantEl = null;
}

$('btn-stop').addEventListener('click', () => {
  fetch('/api/chat/stop', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ runId: S.run }),
  }).catch(() => {});
});

/* ================= SSE ================= */

function connect() {
  if (S.es) S.es.close();
  const es = new EventSource('/api/stream');
  S.es = es;

  es.addEventListener('run', (e) => {
    const ev = JSON.parse(e.data);
    handleRun(ev);
  });

  es.onerror = () => {
    setTimeout(() => {
      if (!S.es || S.es.readyState === 2) connect();
    }, 2000);
  };
}

function handleRun(ev) {
  switch (ev.status) {
    case 'started':
      S.run = ev.runId;
      setBusy(true, '启动中');
      break;
    case 'thread':
      break;
    case 'thinking':
      setBusy(true, '思考中');
      break;
    case 'tool':
      setBusy(true, '执行中');
      addToolRow(ev.detail || '', 'shell');
      break;
    case 'reasoning':
      if (ev.text) addDimRow(ev.text, '思考');
      break;
    case 'delta':
      setBusy(true, '输出中');
      if (!S.assistantEl) {
        S.assistantEl = addMessage({ role: 'assistant', agent: ev.agent || S.agent, text: '', streaming: true });
      }
      S.assistantEl.textContent += ev.text;
      scrollBottom();
      break;
    case 'message': {
      setBusy(true, '输出中');
      const text = ev.text || '';
      if (S.assistantEl) {
        S.assistantEl.textContent += text;
        scrollBottom();
      } else {
        S.assistantEl = addMessage({ role: 'assistant', agent: ev.agent || S.agent, text: '', streaming: true });
        typeInto(S.assistantEl, text);
      }
      break;
    }
    case 'usage': {
      const u = ev.usage || {};
      const parts = [];
      if (u.input_tokens) parts.push(`输入 ${fmtNum(u.input_tokens)}`);
      if (u.output_tokens) parts.push(`输出 ${fmtNum(u.output_tokens)}`);
      if (u.cached_input_tokens) parts.push(`缓存 ${fmtNum(u.cached_input_tokens)}`);
      if (parts.length) addDimRow(parts.join(' · '), '用量');
      break;
    }
    case 'error':
    case 'stderr':
      addDimRow(ev.message || '执行出错', '错误');
      break;
    case 'done': {
      const last = [...S.history].reverse().find((m) => m.role === 'assistant');
      if (last && S.assistantEl) last.text = S.assistantEl.textContent;
      saveHistory();
      const ok = ev.code === 0 || ev.code === null;
      const secs = ev.elapsedMs ? `${(ev.elapsedMs / 1000).toFixed(1)}s` : '';
      if (S.assistantEl) {
        S.assistantEl.classList.remove('caret');
        // 打字机结束后用 Markdown 正式渲染（流式过程保持纯文本避免闪烁）
        const finalText = S.assistantEl.textContent;
        S.assistantEl.innerHTML = mdToHtml(finalText);
      }
      if (ev.error) addDimRow(ev.error, '错误');
      setBusy(false, ok ? `完成 · ${secs}` : `结束 · 码 ${ev.code ?? '—'}`);
      loadChanges();
      break;
    }
    default:
      break;
  }
}

/* ================= 改动 ================= */

async function loadChanges() {
  if (!S.project) return;
  if(window.workbench?.showChanges())return;
  try {
    const res = await fetch(`/api/changes?root=${encodeURIComponent(S.project.path)}`);
    const j = await res.json();
    if (!res.ok) throw new Error(j.error || '读取失败');
    S.changes = j;
    if (new URLSearchParams(location.search).get('open') === '1' && j.files && j.files.length && !S.open.size) {
      S.open.add(j.files[0].path);
    }
    renderChanges();
  } catch (e) {
    $('changes-summary').innerHTML = `<span style="color:var(--bad)">${esc(e.message)}</span>`;
    $('changes-list').innerHTML = '';
  }
}

function renderChanges() {
  const c = S.changes;
  if (!c) return;
  const agg = c.byAgent || {};
  $('changes-summary').innerHTML = `
    <span>${c.sourceLabel ? esc(c.sourceLabel) : c.isRepo ? `git · ${esc(c.branch || 'HEAD')}` : '非 git · 按会话归属'}</span>
    <span><b>${c.summary.files}</b> 文件</span>
    <span class="sum-add">+${c.summary.added}</span>
    <span class="sum-del">−${c.summary.removed}</span>
    ${Object.entries(agg)
      .map(([a, v]) => `<span class="tag">${esc(NAME[a] || a)} ${v.files}</span>`)
      .join('')}`;

  const host = $('changes-list');
  if (!c.files.length) {
    host.innerHTML = `<div class="changes-empty">这个项目暂时没有可识别的改动。<br>Codex / WorkBuddy 在这里改文件后，会按代理分组出现在这里。</div>`;
    return;
  }

  const groups = {};
  for (const f of c.files) (groups[f.agent || 'unknown'] = groups[f.agent || 'unknown'] || []).push(f);

  host.innerHTML = Object.entries(groups)
    .sort((a, b) => b[1].length - a[1].length)
    .map(([agent, files]) => {
      const added = files.reduce((x, f) => x + f.added, 0);
      const removed = files.reduce((x, f) => x + f.removed, 0);
      return `
      <div class="agent-group">
        <div class="agent-head">
          <span class="badge ${esc(agent)}">${esc(TAG[agent] || '?')}</span>
          <span>${esc(NAME[agent] || agent)}</span>
          <span class="stat">${files.length} 文件 · +${added} / −${removed}</span>
        </div>
        ${files.map((f) => fileRow(f)).join('')}
      </div>`;
    })
    .join('');

  host.querySelectorAll('.file-btn').forEach((b) =>
    b.addEventListener('click', () => {
      const path = b.dataset.path;
      const row = b.parentElement;
      const d = row.querySelector('.diff');
      if (S.open.has(path)) {
        S.open.delete(path);
        if (d) d.remove();
      } else {
        S.open.add(path);
        if (!d) insertDiff(row, path);
      }
    }),
  );
}

function fileRow(f) {
  const open = S.open.has(f.path);
  return `
    <div class="file-row" data-path="${esc(f.path)}">
      <button class="file-btn" data-path="${esc(f.path)}">
        <span class="file-status ${esc(f.status)}">${esc({ added: '新增', modified: '修改', deleted: '删除', clean: '未变' }[f.status] || f.status)}</span>
        <span class="file-path">${esc(f.path)}</span>
        <span class="file-num"><span class="a">+${f.added}</span> <span class="d">−${f.removed}</span></span>
      </button>
      ${open ? diffHtml(f) : ''}
    </div>`;
}

function diffHtml(f) {
  if (!f.patch) return `<pre class="diff"><div class="hunk">${esc(f.patchNotice || '（没有可显示的差异文本）')}</div></pre>`;
  const lines = f.patch.split(/\r?\n/);
  const html = lines
    .map((l) => {
      let cls = 'ctx';
      if (l.startsWith('@@')) cls = 'hunk';
      else if (l.startsWith('+++') || l.startsWith('---')) cls = 'hunk';
      else if (l.startsWith('+')) cls = 'add';
      else if (l.startsWith('-')) cls = 'del';
      return `<div class="${cls}">${esc(l) || ' '}</div>`;
    })
    .join('');
  return `<pre class="diff">${html}</pre>`;
}

function insertDiff(row, path) {
  const f = (S.changes?.files || []).find((x) => x.path === path);
  if (!f) return;
  row.insertAdjacentHTML('beforeend', diffHtml(f));
}

$('btn-refresh').addEventListener('click', loadChanges);

/* ================= 预览 ================= */

function guessPreview(p) {
  const el = $('preview-url');
  if (el.value) return;
  el.value = 'http://localhost:5173';
}

$('urlbar').addEventListener('submit', (e) => {
  e.preventDefault();
  openPreview($('preview-url').value.trim());
});

function openPreview(raw) {
  if (!raw) return;
  const url = /^https?:\/\//i.test(raw) ? raw : `http://${raw}`;
  $('preview-url').value = url;
  $('preview-frame').src = url;
  $('btn-preview-external').href = url;
  $('preview-tips').textContent = `正在加载 ${url}。若空白，多半是该站点禁止被 iframe 嵌入。`;
}

$('btn-preview-reload').addEventListener('click', () => {
  const f = $('preview-frame');
  const src = f.src;
  f.src = 'about:blank';
  setTimeout(() => (f.src = src), 60);
});

$('insp-tabs').addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-tab]');
  if (!btn) return;
  S.tab = btn.dataset.tab;
  $('insp-tabs')
    .querySelectorAll('button')
    .forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.tab === S.tab)));
  $('pane-changes').hidden = S.tab !== 'changes';
  $('pane-preview').hidden = S.tab !== 'preview';
  if (S.tab === 'changes') loadChanges();
});

$('btn-toggle-inspector').addEventListener('click', () => {
  setInspector($('shell').dataset.inspector === 'off');
});

/* ================= 额度小条 ================= */

async function tickQuota() {
  try {
    const res = await fetch('/api/state');
    const j = await res.json();
    const cx = (j.agents || []).find((a) => a.id === 'codex');
    const q = cx && cx.quota;
    const rq = $('rail-quota');
    if (q && q.kind === 'quota' && q.primary) {
      const bar = (label, left, stale) => {
        if(stale||left===undefined||left==='—')return `<div class="rq-row"><span>${label}</span><span class="rq-val">待采样</span></div>`;
        const v = Math.max(0, Math.min(100, Number(left) || 0));
        const tone = v <= 10 ? 'var(--bad, oklch(72% 0.18 22))' : v <= 30 ? 'var(--warn, oklch(82% 0.14 72))' : 'var(--good, oklch(78% 0.15 158))';
        return `<div class="rq-row"><span class="rq-label">${label}</span><span class="rq-bar"><i style="width:${v}%;background:${tone}"></i></span><span class="rq-val">剩 ${v}%</span></div>`;
      };
      rq.classList.add('card');
      rq.innerHTML = `<div class="rq-head">Codex 额度</div>${bar('5h', q.primary.leftPercent, q.primary.stale)}${bar('7d', q.secondary?.leftPercent ?? '—', q.secondary?.stale)}`;
    } else {
      rq.classList.remove('card');
      rq.textContent = 'Codex 额度未知';
    }
  } catch {
    /* ignore */
  }
}

/* ================= 主题 / 设置 / 视图切换 ================= */

function applyTheme(theme) {
  const dark = theme === 'dark';
  const cur = dark ? 'dark' : 'light';
  document.documentElement.dataset.theme = cur;
  const btn = $('btn-theme');
  btn.textContent = dark ? '☀' : '☾';
  btn.title = dark ? '切到亮色' : '切到暗色';
  $('set-theme')
    .querySelectorAll('button')
    .forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.theme === cur)));
  // 注意：这里必须写裸字符串。监控台 iframe 读的是原值，
  // 用 JSON.stringify 会变成带引号的 "dark"，比较失败就回退成亮色。
  try {
    localStorage.setItem('console-theme', cur);
  } catch {}

  // 标题栏按钮区（原生绘制）跟随明暗主题
  window.consoleNative?.setOverlayColor(
    dark ? '#16161f' : '#f5f3ef',
    dark ? '#e8e8f0' : '#5a5568',
  );

  // 监控台是同源 iframe，主题跟着工作台走
  const f = $('monitor-frame');
  if (f && f.dataset.loaded) {
    try {
      f.contentWindow?.postMessage({ type: 'console:theme', theme: cur }, location.origin);
    } catch {}
  }
}

function setInspector(on, persist = true) {
  $('shell').dataset.inspector = on ? 'on' : 'off';
  $('btn-toggle-inspector').setAttribute('aria-pressed', String(on));
  $('set-inspector').checked = on;
  if (persist) STORE.set('console-inspector', on);
}

/* ---------------- 渲染档位：流畅 / 质感 ----------------
 * 软件渲染下质感模式只有 4 FPS（瓶颈在光栅化，不在 JS），
 * 所以默认 lite。切到 full 只是恢复背景动画和玻璃模糊。
 */
const normPerf = (v) => {
  try {
    if (v) v = JSON.parse(v); // 兼容 STORE 写的带引号格式
  } catch {}
  return v === 'lite' ? 'lite' : 'full';
};

function applyPerf(mode, persist = true) {
  const cur = normPerf(mode);
  document.documentElement.dataset.perf = cur;
  const seg = $('set-perf');
  if (seg) {
    seg.querySelectorAll('button').forEach((b) =>
      b.setAttribute('aria-pressed', String(b.dataset.perf === cur)),
    );
  }
  if (persist) {
    try {
      localStorage.setItem('console-perf', cur);
    } catch {}
  }
  const f = $('monitor-frame');
  if (f && f.dataset.loaded) {
    try {
      f.contentWindow?.postMessage({ type: 'console:perf', perf: cur }, location.origin);
    } catch {}
  }
}

function openSheet(open) {
  $('sheet').hidden = !open;
  $('sheet-scrim').hidden = !open;
  $('btn-settings').setAttribute('aria-pressed', String(open));
  if (open) renderArchive();
}

/* 加载/重载监控台 iframe。
   注意：本机 Chromium 环境下 iframe 改 src 后 **load 事件不触发**
   （contentDocument 已 complete 但事件不来，实测复现），所以不能用
   load 事件清加载态 —— 改为轮询 contentDocument.readyState。 */
function loadMonitorFrame() {
  const v = $('view-monitor');
  const f = $('monitor-frame');
  v.dataset.loading = '1';
  f.src = SNAP ? '/monitor/?nolive=1' : `/monitor/?t=${Date.now()}`;
  const t0 = Date.now();
  const timer = setInterval(() => {
    let done = false;
    try {
      // 关键：src 改变后 contentDocument 会先停留在 about:blank（complete 但空），
      // 必须确认文档地址真的是 /monitor/ 且渲染出了内容才算就绪
      const d = f.contentDocument;
      done =
        !!d &&
        d.readyState === 'complete' &&
        String(d.location?.href || '').includes('/monitor/') &&
        !!d.body &&
        d.body.children.length > 0;
    } catch {
      done = true; // 跨域等情况，别无限转圈
    }
    if (done || Date.now() - t0 > 10_000) {
      clearInterval(timer);
      v.dataset.loading = '';
      try {
        f.contentWindow?.postMessage(
          { type: 'console:theme', theme: document.documentElement.dataset.theme },
          location.origin,
        );
        f.contentWindow?.postMessage(
          { type: 'console:perf', perf: document.documentElement.dataset.perf },
          location.origin,
        );
      } catch {}
    }
  }, 200);
}

/** 监控台不跳页：同源 iframe 铺满工作区，返回即回工作台 */
function showMonitor(on) {
  if(on){window.workbench?.dismissOverlays?.();openSheet(false);hideCtx();document.querySelector('.sel-bar')?.setAttribute('hidden','');}
  const v = $('view-monitor');
  const f = $('monitor-frame');
  if (on) {
    // 先显示再加载：display:none 容器里的 iframe 会被 Chromium 推迟加载，
    // 导致"打开后一直卡在加载中"
    v.hidden = false;
    $('btn-view-monitor').setAttribute('aria-pressed', 'true');document.body.dataset.view='monitor';
    if (!f.dataset.loaded) {
      f.dataset.loaded = '1';
      loadMonitorFrame();
    }
  } else {
    v.hidden = true;
    v.dataset.loading = '';
    $('btn-view-monitor').setAttribute('aria-pressed', 'false');document.body.dataset.view='workbench';
  }
}

/* ================= 右键菜单：会话 / 项目 的 归档·重命名·删除 ================= */

const ctxMenu = document.createElement('div');
ctxMenu.className = 'ctx-menu';
ctxMenu.hidden = true;
document.body.appendChild(ctxMenu);
let ctxTarget = null;

function hideCtx() {
  ctxMenu.hidden = true;
}

document.addEventListener('click', hideCtx);
window.addEventListener('blur', hideCtx);
window.addEventListener('scroll', hideCtx, true);

async function renameVia(kind, id, path, oldName) {
  const input = document.createElement('input');
  input.className = 'ctx-rename';
  input.value = oldName || '';
  input.style.left = '20px';
  input.style.top = '20px';
  document.body.appendChild(input);
  input.focus();
  input.select();
  const commit = async () => {
    const name = input.value.trim();
    input.remove();
    if (!name || name === oldName) return;
    await apiPost('/api/rename', { kind, id, path, name });
    await loadProjects();
  };
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') commit();
    if (e.key === 'Escape') input.remove();
  });
  input.addEventListener('blur', () => {
    // 延迟检查：菜单点击的焦点迁移是瞬时的，立即 commit 会表现为「没反应」
    setTimeout(() => {
      if (document.body.contains(input)) commit();
    }, 180);
  });
}

document.addEventListener('contextmenu', (e) => {
  const sessEl = e.target.closest('.sess[data-id]');
  const projEl = e.target.closest('.proj-row');
  if (!sessEl && !projEl) {
    hideCtx();
    return;
  }
  e.preventDefault();
  const items = [];
  if (sessEl) {
    const id = sessEl.dataset.id;
    const title = (sessEl.title || sessEl.textContent || '').trim();
    const pinnedNow = sessEl.classList.contains('pinned');
    ctxTarget = { kind: 'session', id, title };
    items.push(
      { label: pinnedNow ? '📉 取消置顶' : '📌 置顶', act: async () => {
          await apiPost('/api/sessions/pin', { id, pinned: !pinnedNow });
          await loadProjects();
        } },
      { label: '✏️ 重命名', act: () => renameVia('session', id, '', title) },
      { label: '📦 归档', act: async () => {
          await apiPost('/api/sessions/archive', { id, archived: true });
          if (S.thread && S.thread.id === id) exitThread(false);
          await loadProjects();
        } },
      { label: '🗑 删除会话', act: async () => {
          if (!confirm(`删除这条会话？
${title}

将删除本机对应的会话记录文件，不可恢复。`)) return;
          await apiPost('/api/delete-session', { id });
          if (S.thread && S.thread.id === id) exitThread(false);
          await loadProjects();
        }, danger: true },
    );
  } else {
    const row = projEl.querySelector('.project');
    const path = projEl.closest('.pnode')?.dataset.path || '';
    const agent = projEl.closest('.pnode')?.dataset.agent || '';
    const nameEl = projEl.querySelector('.project-name');
    const name = (nameEl ? nameEl.textContent.replace(/\d+$/, '').trim() : '') || path;
    ctxTarget = { kind: 'project', path };
    items.push(
      { label: '✏️ 重命名', act: () => renameVia('project', '', path, name) },
      { label: '📦 归档全部会话', act: async () => {
          if (!confirm(`归档项目「${name}」下的全部会话？\nAgent 侧的会话文件不会被删除。`)) return;
          await apiPost('/api/archive-project', { path, agent });
          exitThread(false);
          await loadProjects();
        } },
      { label: '📂 从列表移除', act: async () => {
          if (!confirm(`把项目从列表移除？\n${path}\n\n真实目录不会被删除。`)) return;
          await apiPost('/api/hide-project', { path });
          await loadProjects();
        } },
      { label: '🗑 删除项目（含目录）', act: async () => {
          if (!confirm(`⚠️ 将真实删除整个项目目录：\n${path}\n\n目录内所有文件都会被删除，不可恢复！代理集中保存的历史会话仍保留。`)) return;
          if (!confirm('再次确认：真的要删除整个目录吗？此操作不可逆。')) return;
          await apiPost('/api/delete-project', { path });

          if (S.project && S.project.path === path) exitThread(false);
          await loadProjects();
        }, danger: true },
    );
  }
  ctxMenu.innerHTML = '';
  for (const it of items) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = it.label;
    if (it.danger) b.className = 'danger';
    b.addEventListener('click', async () => {
      hideCtx();
      try { notify('正在处理…'); await it.act(); notify('操作完成'); }
      catch (error) { notify(error.message || '操作失败', true); }
    });
    ctxMenu.appendChild(b);
  }
  ctxMenu.hidden = false;
  const mw = 168, mh = items.length * 34 + 10;
  ctxMenu.style.left = `${Math.min(e.clientX, innerWidth - mw - 8)}px`;
  ctxMenu.style.top = `${Math.min(e.clientY, innerHeight - mh - 8)}px`;
});

/* ================= 图片 lightbox ================= */

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

/* 项目高亮淡化：点击侧栏以外的区域后，选中项目的黑色高亮退为圆点标识 */
document.addEventListener('pointerdown', (e) => {
  const rail = document.getElementById('rail');
  if (!rail) return;
  const project = e.target.closest('.project');
  rail.classList.toggle('dim-current', !project);
});

document.addEventListener('focusin', (e) => { if (!e.target.closest('.project')) $('rail').classList.add('dim-current'); });

/* ================= 选中消息的浮动操作条 ================= */

let selText = '';
const selBar = document.createElement('div');
selBar.className = 'sel-bar';
selBar.hidden = true;
selBar.innerHTML = `<button type="button" id="sel-copy">⧉ 复制</button><button type="button" id="sel-toinput">↩ 添加到对话</button>`;
document.body.appendChild(selBar);

document.addEventListener('mouseup', (e) => {
  if (selBar.contains(e.target)) return;
  setTimeout(() => {
    const sel = window.getSelection();
    const text = sel ? sel.toString().trim() : '';
    const host = $('messages');
    if (!text || !host.contains(sel.anchorNode) || S.replaying) {
      selBar.hidden = true;
      return;
    }
    selText = text;
    const rect = sel.getRangeAt(0).getBoundingClientRect();
    selBar.hidden = false;
    selBar.style.left = `${Math.max(8, Math.min(innerWidth - 190, rect.left + rect.width / 2 - 85))}px`;
    selBar.style.top = `${Math.max(8, rect.top - 42)}px`;
  }, 10);
});

selBar.querySelector('#sel-copy').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(selText);
  } catch {}
  selBar.hidden = true;
  window.getSelection()?.removeAllRanges();
});

selBar.querySelector('#sel-toinput').addEventListener('click', () => {
  const quoted = selText
    .split(/\r?\n/)
    .map((l) => `> ${l}`)
    .join('\n');
  promptEl.value = (promptEl.value ? promptEl.value + '\n' : '') + quoted + '\n';
  promptEl.dispatchEvent(new Event('input'));
  promptEl.focus();
  selBar.hidden = true;
  window.getSelection()?.removeAllRanges();
});

/* ================= 会话回放（主区） ================= */

/* ---------- 轻量 Markdown 渲染（安全：先转义 HTML 再生成标签） ---------- */
function fmtNum(v) {
  const x = Number(v || 0);
  if (x >= 1e6) return (x / 1e6).toFixed(x >= 1e7 ? 0 : 1) + 'M';
  if (x >= 1e3) return (x / 1e3).toFixed(x >= 1e5 ? 0 : 1) + 'k';
  return String(x);
}

function escHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function inlineMd(s) {
  // 行内代码（先保护起来，避免里面的星号被二次处理）
  const codes = [];
  s = s.replace(/`([^`]+)`/g, (_, c) => {
    codes.push(c);
    return `\u0000${codes.length - 1}\u0000`;
  });
  // 粗体 / 斜体
  s = s.replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');
  s = s.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<i>$2</i>');
  // 未闭合的 **（消息被截断时常见）：配对失败的按普通文本处理，去掉星号
  s = s.replace(/\*\*/g, '');
  // 链接 [文字](url)：先生成并占位，避免裸 URL 正则把已生成的 <a> 再包一层
  const links = [];
  s = s.replace(/\[([^\]]+)\]\((?:&lt;)?((?:[A-Za-z]:[\\/]|\/|\.{1,2}\/)[^)]+?)(?:&gt;)?\)/g, (_, title, file) => { links.push(`<a href="#" data-file="${file}">${title}</a>`); return `\u0001L${links.length - 1}\u0001`; });
  s = s.replace(/\[([^\]]+)\]\(([^:)\s]+\.[A-Za-z0-9]{1,12}(?::\d+(?::\d+)?)?)\)/g, (_, title, file) => { links.push(`<a href="#" data-file="${file}">${title}</a>`); return `\u0001L${links.length - 1}\u0001`; });
  s = s.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, (_, t, u) => {
    links.push(`<a href="${u}" data-ext="1">${t}</a>`);
    return `\u0001L${links.length - 1}\u0001`;
  });
  // 裸 URL（此时文本里已无 href 属性，不会重复匹配）
  s = s.replace(/(^|[\s(])((?:https?:\/\/)[^\s<)"']+)/g, (_, p, u) => `${p}<a href="${u}" data-ext="1">${u}</a>`);
  s = s.replace(/\u0001L(\d+)\u0001/g, (_, i) => links[+i]);
  // 还原行内代码
  s = s.replace(/\u0000(\d+)\u0000/g, (_, i) => `<code class="ic">${escHtml(codes[+i])}</code>`);
  return s;
}

function mdToHtml(text) {
  const lines = String(text).split(/\r?\n/);
  let html = '';
  let para = [];
  let listType = null;
  let listStart = 1;
  let listBuf = [];
  let inCode = false;
  let codeBuf = [];

  const flushPara = () => {
    if (para.length) {
      // 段落整体渲染：粗体/斜体可能跨行（**开头↔结尾各在一行）
      html += `<p>${inlineMd(para.join('\n')).replace(/\n/g, '<br>')}</p>`;
      para = [];
    }
  };
  const flushList = () => {
    if (listType) {
      html += `<${listType}${listType === 'ol' ? ` start="${listStart}"` : ''}>${listBuf.map((li) => `<li>${inlineMd(li)}</li>`).join('')}</${listType}>`;
      listType = null;
      listBuf = [];
    }
  };

  for (const raw of lines) {
    // 代码块围栏
    if (/^```/.test(raw.trim())) {
      if (inCode) {
        html += `<pre class="cb"><code>${escHtml(codeBuf.join('\n'))}</code></pre>`;
        codeBuf = [];
        inCode = false;
      } else {
        flushPara();
        flushList();
        inCode = true;
      }
      continue;
    }
    if (inCode) {
      codeBuf.push(raw);
      continue;
    }
    const t = raw.trim();
    if (!t) {
      flushPara();
      flushList();
      continue;
    }
    const h = t.match(/^(#{1,4})\s+(.*)/);
    if (h) {
      flushPara();
      flushList();
      html += `<h4 class="md-h">${inlineMd(h[2])}</h4>`;
      continue;
    }
    if (/^>\s?/.test(t)) {
      flushPara();
      flushList();
      html += `<blockquote class="md-q">${inlineMd(t.replace(/^>\s?/, ''))}</blockquote>`;
      continue;
    }
    const ul = t.match(/^[-*]\s+(.*)/);
    const ol = t.match(/^(\d+)[.、]\s+(.*)/);
    if (ul && !/^[-*]{2,}/.test(t)) {
      flushPara();
      if (listType !== 'ul') {
        flushList();
        listType = 'ul';
      }
      listBuf.push(ul[1]);
      continue;
    }
    if (ol) {
      flushPara();
      if (listType !== 'ol') {
        flushList();
        listType = 'ol';
        listStart = Number(ol[1]) || 1;
      }
      listBuf.push(ol[2]);
      continue;
    }
    if (/^(---|\*\*\*|___)\s*$/.test(t)) {
      flushPara();
      flushList();
      html += '<hr class="md-hr">';
      continue;
    }
    para.push(t);
  }
  if (inCode && codeBuf.length) html += `<pre class="cb"><code>${escHtml(codeBuf.join('\n'))}</code></pre>`;
  flushPara();
  flushList();
  return html;
}

function usageLine(u) {
  if (!u) return '';
  const parts = [];
  if (u.input) parts.push(`输入 ${fmtNum(u.input)}`);
  if (u.output) parts.push(`输出 ${fmtNum(u.output)}`);
  if (u.cached) parts.push(`缓存 ${fmtNum(u.cached)}`);
  return parts.length ? `<div class="msg-usage">⚡ ${parts.join(' · ')}</div>` : '';
}

const fmtTime = (ts) => {
  if (!ts) return '';
  const d = new Date(ts);
  return `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(
    2,
    '0',
  )}:${String(d.getMinutes()).padStart(2, '0')}`;
};

function exitThread(redraw = true) {
  replayGeneration++;
  S.replaying = false;
  if (!S.thread) return;
  S.thread = null;
  if (S.replayTimer) {
    clearInterval(S.replayTimer);
    S.replayTimer = null;
  }
  $('thread-bar').hidden = true;
  if (redraw) {
    restoreHistory();
    if (new URLSearchParams(location.search).get('fixture') === '1') renderFixture();
  }
  renderProjects();
}

async function openThread(id, project) {
  if (window.workbench && id.startsWith('workbench:')) return window.workbench.open(id.slice(10));
  if (!project) return;
  // 已在同一条会话的回放里：不再重复 selectProject/fetch/重渲染
  // （防止任何自动 click 造成「click→渲染→click」的循环风暴）
  if (S.thread && S.thread.id === id && !S.replaying) return;
  // 先切换项目（同一项目不重置会话），再拉正文
  if (!S.project || S.project.path !== project.path || S.project.agent !== project.agent) {
    selectProject(project, { keepThread: true });
  } else {
    selectProject(project, { keepThread: true, keepFold: true });
  }

  window.workbench?.historical(id, project);
  replayGeneration++;
  S.replaying = false;
  S.filesExpanded = false;
  S.thread = { id, agent: project.agent, title: '' };
  const bar = $('thread-bar');
  bar.hidden = false;
  $('tb-badge').textContent = TAG[project.agent] || '?';
  $('tb-title').textContent = '正在读取会话…';
  $('tb-meta').textContent = '';

  const host = $('messages');
  host.innerHTML = `<div class="thread-loading">正在读取这条会话的正文…</div>`;
  renderProjects();

  try {
    const res = await fetch(`/api/session?id=${encodeURIComponent(id)}`);
    const j = await res.json();
    // 读取期间用户可能已切换/关闭会话 —— 丢弃过期数据，防止显示别的会话
    if (!S.thread || S.thread.id !== id) return;
    if (!res.ok) throw new Error(j.error || `服务返回 ${res.status}`);
    await paintThread(j);
  } catch (e) {
    host.innerHTML = `<div class="thread-loading">${esc(e.message || '读取失败')}</div>`;
    $('tb-title').textContent = '读取失败';
  }
}

let threadData = null;
let threadCompact = true;

let replayGeneration = 0;
async function paintThread(d, keepScroll) {
  const generation = ++replayGeneration;
  threadData = d;
  S.replayCount = (d.messages || []).length;
  const __last = (d.messages || [])[(d.messages || []).length - 1];
  S.replayFp = __last ? __last.ts + '|' + String(__last.text || '').length + '|' + String(__last.text || '').slice(-80) : '';
  S.thread = { id: d.id, agent: d.agent, title: d.title || '' };
  $('tb-title').textContent = d.title || '(无标题会话)';
  $('tb-title').title = d.title || '';
  $('tb-meta').textContent = `${d.count} 条 · ${fmtTime(d.ts)}${d.truncated ? ' · 中间有省略' : ''}`;

  const host = $('messages');
  const oldTop = host.scrollTop;
  const wasAtBottom = host.scrollHeight - host.scrollTop - host.clientHeight < 80;
  const readerVersion = window.workbench?.readerVersion || 0;
  const hostTop = host.getBoundingClientRect().top;
  const anchor = (S.replayNodes || []).find(node => node?.isConnected && node.getBoundingClientRect().bottom > hostTop);
  const anchorOffset = anchor ? anchor.getBoundingClientRect().top - hostTop : 0;
  const msgs = (d.messages || []).filter((m) => !(threadCompact && (m.role === 'tool' || m.role === 'reasoning')));
  let unchanged = 0;
  if (keepScroll && S.replayRenderId === d.id && S.replayCompact === threadCompact) {
    const previous = S.replayRendered || [];
    while (unchanged < previous.length && unchanged < msgs.length && previous[unchanged].role === msgs[unchanged].role && previous[unchanged].text === msgs[unchanged].text && JSON.stringify(previous[unchanged].usage) === JSON.stringify(msgs[unchanged].usage)) unchanged++;
    for (const node of (S.replayNodes || []).slice(unchanged)) node?.remove();
    S.replayNodes = (S.replayNodes || []).slice(0, unchanged);
    host.querySelector('.files-card')?.remove();
  } else { host.replaceChildren(); S.replayNodes = []; }
  S.replayRenderId = d.id; S.replayCompact = threadCompact;


  S.replaying = true;
  if (!msgs.length) {
    host.innerHTML = `<div class="thread-loading">这条会话里没有可显示的消息${
      threadCompact ? '（关掉「只看对话」可以看到工具调用）' : ''
    }。</div>`;
    S.replaying = false;
    return;
  }

  // 回放实时同步：每 3 秒拉一次会话，有新消息就追加（Agent 桌面端继续干活时能看到流式进展）
  if (S.replayTimer) clearInterval(S.replayTimer);
  const replayId = d.id;
  S.replayTimer = setInterval(async () => {
    // 渲染中跳过本轮（58 条全量 Markdown 可能超过一个 tick），但不清定时器
    if (S.replaying) return;
    if (!S.thread || S.thread.id !== replayId || $('thread-bar').hidden) {
      clearInterval(S.replayTimer);
      return;
    }
    try {
      const j = await (await fetch(`/api/session?id=${encodeURIComponent(replayId)}`)).json();
      // 请求在途时用户可能已发消息进入新对话 —— 此刻再校验，防止旧内容污染
      if (!S.thread || S.thread.id !== replayId || $('thread-bar').hidden) return;
      if (j.error) return;
      const all = j.messages || [];
      // 变化检测用「最后一条消息指纹」：长会话有 head/tail 截断（中间有省略），
      // 消息总数会恒定，数量对比永远检测不到新消息
      const last = all[all.length - 1];
      const fp = last ? last.ts + '|' + String(last.text || '').length + '|' + String(last.text || '').slice(-80) : '';
      if (fp === S.replayFp && all.length === S.replayCount) return;
      // 节流：会话被 Agent 持续写入时每个 tick 都有变化，全量重渲染限频 10 秒
      if (Date.now() - (S.replayPaintAt || 0) < 10_000) return;
      S.replayPaintAt = Date.now();
      S.replayFp = fp;
      S.replayCount = all.length;
      // 有变化：整屏重渲染（重建用量小字/产物卡），尽量不打扰当前滚动位置
      const host = $('messages');
      S.replayStick = host.scrollHeight - host.scrollTop - host.clientHeight < 80;
      S.replayScrollTop = S.replayStick ? 0 : host.scrollTop;
      await paintThread(j, true);
      // 实时同步呼吸指示
      $('tb-meta').textContent = '● 实时同步中';
      $('tb-meta').classList.add('live');
      setTimeout(() => {
        $('tb-meta').classList.remove('live');
        if (S.thread && threadData && S.thread.id === threadData.id) {
          $('tb-meta').textContent = `${threadData.count} 条 · ${fmtTime(threadData.ts)}${threadData.truncated ? ' · 中间有省略' : ''}`;
        }
      }, 2500);
    } catch {}
  }, 3000);

  let rendered = 0;
  for (const m of msgs.slice(unchanged)) {
    if (++rendered % 40 === 0) {
      await new Promise((resolve) => setTimeout(resolve, 0));
      if (generation !== replayGeneration || S.thread?.id !== d.id) return;
    }
    // 回放显示消息的真实时间；assistant 用 Markdown 渲染（其余保持纯文本）
    if (m.role === 'user') addMessage({ role: 'user', text: m.text, ts: m.ts, attachments: m.attachments });
    else if (m.role === 'assistant') {
      // addMessage 返回 .msg-body 元素，assistant 直接以 Markdown 渲染
      const body = addMessage({ role: 'assistant', agent: d.agent, text: '', ts: m.ts });
      body.innerHTML = mdToHtml(m.text);
      if (m.usage) body.insertAdjacentHTML('beforeend', usageLine(m.usage));
    } else if (m.role === 'tool') addToolRow(m.text, m.meta || 'tool');
    else if (m.role === 'reasoning') addDimRow(m.text, '思考');
    else if (m.role === 'gap') addDimRow(m.text, '省略');
    S.replayNodes.push(host.lastElementChild);
  }
  S.replayRendered = msgs;
  S.replaying = false;
  refreshComposerHint();

  // 产物卡片：默认只预览 2 个最相关交付物（源码/文档优先，截图降权），可展开
  if ((d.files || []).length) {
    const weight = (p) => {
      const ext = (p.split('.').pop() || '').toLowerCase();
      if (['md', 'html', 'htm', 'mjs', 'js', 'ts', 'tsx', 'jsx', 'py', 'css', 'json', 'yml', 'yaml', 'toml'].includes(ext)) return 3;
      if (['png', 'jpg', 'jpeg', 'gif', 'webp'].includes(ext)) return /(^|[\\/])shot/i.test(p) ? 0 : 1;
      return 2;
    };
    const files = [...d.files].sort((a, b) => weight(b) - weight(a)); // sort 稳定，同分保持出现顺序
    const card = document.createElement('div');
    card.className = 'files-card';
    card.innerHTML = `<div class="files-head">产物 / 涉及文件 <b>${files.length}</b></div>`;
    const head = card.querySelector('.files-head');
    const body = document.createElement('div');
    body.className = 'files-body';
    const makeRow = (p) => {
      const row = document.createElement('button');
      row.className = 'file-row';
      row.type = 'button';
      row.title = `在资源管理器中显示：${p}`;
      row.innerHTML = `<span class="file-ico">📄</span><span class="file-body"><span class="file-name">${esc(
        p.split(/[\\/]/).pop(),
      )}</span><span class="file-path">${esc(p)}</span></span>`;
      row.addEventListener('click', () => {
        row.classList.add('clicked');
        setTimeout(() => row.classList.remove('clicked'), 600);
        window.consoleNative?.revealFile(p);
      });
      return row;
    };
    const renderFiles = (expanded) => {
      body.replaceChildren();
      head.querySelector('.files-less-top')?.remove();
      for (const p of expanded ? files : files.slice(0, 2)) body.appendChild(makeRow(p));
      if (files.length <= 2) return;
      const toggle = document.createElement('button');
      toggle.className = 'files-more'; toggle.type = 'button';
      toggle.setAttribute('aria-expanded', String(expanded));
      toggle.textContent = expanded ? '收起' : `展开其余 ${files.length - 2} 个文件`;
      toggle.addEventListener('click', () => {
        const top = host.scrollTop;
        S.filesExpanded = !expanded; renderFiles(!expanded); host.scrollTop = top;
      });
      body.appendChild(toggle);
      if (expanded) {
        const less = toggle.cloneNode(true); less.className = 'files-less-top';
        less.addEventListener('click', () => { S.filesExpanded = false; renderFiles(false); });
        head.appendChild(less);
      }
    };
    renderFiles(!!S.filesExpanded);
    card.appendChild(body);
    host.appendChild(card);
  }

  if (keepScroll) {
    if ((window.workbench?.readerVersion || 0) !== readerVersion) return;
    if (wasAtBottom) host.scrollTop = host.scrollHeight;
    else if (anchor?.isConnected) host.scrollTop += anchor.getBoundingClientRect().top - host.getBoundingClientRect().top - anchorOffset;
    else host.scrollTop = oldTop;
    const notice = $('wb-new-output'); if (notice) notice.hidden = wasAtBottom;
    return;
  }
  const savedScroll=window.workbench?.historicalId===d.id?window.workbench.draftScroll:undefined;
  host.scrollTop = Number.isFinite(savedScroll)?savedScroll:host.scrollHeight;
}

$('btn-thread-close').addEventListener('click', () => exitThread());

/* 导出当前会话为 Markdown */
$('btn-tb-export').addEventListener('click', () => {
  if (!threadData) return;
  const d = threadData;
  const lines = [`# ${d.title || '会话'}`, '', `- Agent：${NAME[d.agent] || d.agent}`, `- 导出时间：${new Date().toLocaleString('zh-CN')}`, `- 会话文件：${d.file || '—'}`, ''];
  for (const m of d.messages || []) {
    const t = m.ts ? new Date(m.ts).toLocaleString('zh-CN') : '';
    if (m.role === 'user') lines.push(`## 你${t ? ` · ${t}` : ''}`, '', m.text, '');
    else if (m.role === 'assistant') lines.push(`## ${NAME[d.agent] || d.agent}${t ? ` · ${t}` : ''}`, '', m.text, '');
    else if (m.role === 'usage') lines.push(`> 用量：输入 ${fmtNum(m.input)} · 输出 ${fmtNum(m.output)}${m.cached ? ` · 缓存 ${fmtNum(m.cached)}` : ''}`, '');
    else if (m.role === 'tool') lines.push(`- 🔧 ${m.text}${m.meta ? ` — ${m.meta}` : ''}`);
    else if (m.role === 'reasoning') lines.push(`> 💭 ${m.text}`);
  }
  if ((d.files || []).length) {
    lines.push('', '## 产物 / 涉及文件', '');
    for (const f of d.files) lines.push(`- ${f}`);
  }
  const blob = new Blob([lines.join('\n')], { type: 'text/markdown;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${(d.title || '会话').replace(/[\\/:*?"<>|]/g, '_').slice(0, 40)}.md`;
  a.click();
  URL.revokeObjectURL(a.href);
});
$('btn-tb-filter').addEventListener('click', () => {
  threadCompact = !threadCompact;
  $('btn-tb-filter').setAttribute('aria-pressed', String(threadCompact));
  $('btn-tb-filter').textContent = threadCompact ? '只看对话' : '含工具调用';
  if (window.workbench?.selected) return window.workbench.render();
  if (threadData) paintThread(threadData);
});

$('btn-settings').addEventListener('click', () => openSheet($('sheet').hidden));
$('btn-sheet-close').addEventListener('click', () => openSheet(false));
$('sheet-scrim').addEventListener('click', () => openSheet(false));
$('btn-archive-refresh').addEventListener('click', () => loadArchiveOnly());

$('set-theme').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-theme]');
  if (b) applyTheme(b.dataset.theme);
});

$('set-perf').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-perf]');
  if (b) applyPerf(b.dataset.perf);
});

$('set-inspector').addEventListener('change', (e) => setInspector(e.target.checked));
$('set-expand-all').addEventListener('change', (e) => {
  S.expandAll = e.target.checked;
  STORE.set('console-expand-all', S.expandAll);
  // 打开时把现有项目全部展开
  if (S.expandAll) {
    const m = {};
    for (const p of S.projects) m[p.path.toLowerCase()] = true;
    STORE.set('console-open', m);
  }
  renderProjects();
});

$('btn-theme').addEventListener('click', () =>
  applyTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'),
);

$('btn-view-monitor').addEventListener('click', () => showMonitor(true));
$('btn-view-back').addEventListener('click', () => showMonitor(false));

// 监控台卡住时的自救：重载 iframe（重新走加载提示 → 轮询就绪后清除）
$('btn-view-reload').addEventListener('click', () => {
  const v = $('view-monitor');
  if (v.hidden) return;
  loadMonitorFrame();
});

addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (!$('view-monitor').hidden) return showMonitor(false);
  if (!$('sheet').hidden) openSheet(false);
});

// 监控台里的「返回工作台」按钮通过 postMessage 通知父级；
// 监控台自己切主题时也通知父级，让标题栏按钮区颜色跟着变
addEventListener('message', (e) => {
  if (e.origin !== location.origin) return;
  const d = e.data || {};
  if (d.type === 'console:back') showMonitor(false);
  if (d.type === 'console:theme' && (d.theme === 'dark' || d.theme === 'light')) {
    applyTheme(d.theme);
  }
});

/* ================= 启动 ================= */

const PARAMS = new URLSearchParams(location.search);
const SNAP = PARAMS.get('snap') === '1';

S.expandAll = !!STORE.get('console-expand-all', false);
$('set-expand-all').checked = S.expandAll;
// 主题存的是裸字符串（监控台 iframe 也读它），不能走 JSON 反序列化
const savedTheme = (() => {
  try {
    return localStorage.getItem('console-theme') || 'light';
  } catch {
    return 'light';
  }
})();
applyTheme(PARAMS.get('theme') || savedTheme);
applyPerf(PARAMS.get('perf') || document.documentElement.dataset.perf || 'lite', false);
setInspector(false, false); // 默认折叠

if (!SNAP) connect();
buildDds();
// 两者互不依赖：项目列表不被模型接口拖住，模型挂了也照样能看到项目
loadProjects();
loadModels(S.agent);

// 校验用：?ddopen=1 自动展开第 2 个下拉
if (PARAMS.get('ddopen') === '1') {
  setTimeout(() => document.querySelectorAll('.dd-btn')[1]?.click(), 900);
}
// 校验用：?sheet=1 直接打开设置
if (PARAMS.get('sheet') === '1') setTimeout(() => openSheet(true), 600);
// 校验用：?monitor=1 直接进监控台
if (PARAMS.get('monitor') === '1') setTimeout(() => showMonitor(true), 600);
// 直接打开某条会话（可收藏 / 排障）：?session=codex:rollout-...
const qsSession = PARAMS.get('session');
if (qsSession) {
  const openById = () => {
    for (const a of S.agents || []) {
      for (const p of a.projects || []) {
        if ((p.sessions || []).some((x) => x.id === qsSession)) return openThread(qsSession, p);
      }
    }
  };
  setTimeout(openById, 1200);
}

tickQuota();
setInterval(tickQuota, 30000);
setInterval(() => {
  if (S.tab === 'changes' && !S.busy) loadChanges();
}, 4000);

// 项目/会话在别处也会新增，静默刷新（不打断当前选中）
setInterval(() => {
  if (!S.busy && !S.thread) loadProjects({ silent: true });
}, 60_000);

$('btn-close-inspector')?.addEventListener('click',()=>setInspector(false));
