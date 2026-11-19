#!/usr/bin/env node
/**
 * 三体控制台 · 服务端 v2
 *
 * 只监听 127.0.0.1，零依赖。在原状态/配置采集之上，新增：
 * SSE 实时流、三家原生适配器、持久任务服务及本地可读用量。
 *
 *   GET  /api/state            一次性快照
 *   GET  /api/stream           SSE：state / feed / run
 *   /api/workbench/*          持久会话、任务、审批、文件与事件
 *   POST /api/chat             旧客户端入口，拒绝并提示刷新
 *   POST /api/chat/stop        按 taskId 中止持久任务
 *   POST /api/probe            {id} 廉价探测
 *   GET  /api/raw?src=codex    原始配置文本
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { spawn, execFileSync, execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline';
import { StringDecoder } from 'node:string_decoder';
import { DatabaseSync } from 'node:sqlite';
import { WorkbenchClient } from './lib/workbench-client.mjs';
import { classifyActivity } from './lib/activity.mjs';
import { dshRecordItems, dshTime } from './lib/dsh-events.mjs';
import { UiControl, automationToken } from './lib/ui-control.mjs';
import { mcpManagement } from './lib/mcp-management.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SERVER_REVISION = crypto.createHash('sha256').update(fs.readFileSync(fileURLToPath(import.meta.url))).digest('hex').slice(0, 16);
const PUBLIC_DIR = path.join(HERE, 'public');
const uiControl = new UiControl(automationToken(HERE));
const manageMcp = mcpManagement(HERE);
const workbench = new WorkbenchClient(HERE);
const PORT = Number(process.env.CONSOLE_PORT || 7788);

const HOME = os.homedir();

/* 桥接目录：搬到了 D 盘（bridges\wb-bridge、bridges\dsh-bridge），
   但旧路径要留着兼容——用户可能自己还放了一份在别处。
   解析顺序：环境变量 → 应用同级的 bridges\ → 家目录 → 旧的家目录直下。 */
const BRIDGE_ROOTS = [
  process.env.CONSOLE_BRIDGES_DIR,
  path.join(HERE, '..', '..', '..', 'bridges'),
  path.join(HOME, 'bridges'),
  HOME,
].filter(Boolean);

function resolveBridgeDir(name) {
  for (const root of BRIDGE_ROOTS) {
    const p = path.join(root, name);
    try {
      if (fs.statSync(p).isDirectory()) return p;
    } catch {
      /* 继续找下一个 */
    }
  }
  return path.join(BRIDGE_ROOTS[0], name);
}

const P = {
  codexHome: path.join(process.env.CONSOLE_DATA_HOME || HOME, '.codex'),
  wbHome: path.join(process.env.CONSOLE_DATA_HOME || HOME, '.workbuddy'),
  dshHome: path.join(process.env.CONSOLE_DATA_HOME || HOME, '.dsh'),
  wbBridge: resolveBridgeDir('wb-bridge'),
  dshBridge: resolveBridgeDir('dsh-bridge'),
};

const cleanPath = (value) => String(value || '').replace(/^\\\\\?\\/, '');
const pathKey = (value) => path.resolve(cleanPath(value)).replace(/[\\/]+$/, '').toLowerCase();
const samePath = (a, b) => !!a && !!b && pathKey(a) === pathKey(b);

function readDatabase(file, query) {
  let db;
  try { db = new DatabaseSync(file, { readOnly: true }); return db.prepare(query).all(); }
  catch { return []; }
  finally { db?.close(); }
}

function codexMetadata() {
  return readDatabase(path.join(P.codexHome, 'state_5.sqlite'),
    'SELECT id, cwd, title, first_user_message, archived, is_pinned FROM threads');
}

const now = () => Date.now();
const safe = (fn, fallback = null) => {
  try {
    return fn();
  } catch {
    return fallback;
  }
};

/* ================================================================== *
 * 基础工具
 * ================================================================== */

function readText(p, max = 400_000) {
  const st = fs.statSync(p);
  const fd = fs.openSync(p, 'r');
  try {
    const len = Math.min(st.size, max);
    const buf = Buffer.alloc(len);
    fs.readSync(fd, buf, 0, len, Math.max(0, st.size - len));
    return buf.toString('utf8');
  } finally {
    fs.closeSync(fd);
  }
}

function readHeadText(p, max = 32_000) {
  const fd = fs.openSync(p, 'r');
  try {
    const buf = Buffer.alloc(Math.min(fs.statSync(p).size, max));
    fs.readSync(fd, buf, 0, buf.length, 0);
    return buf.toString('utf8');
  } finally {
    fs.closeSync(fd);
  }
}

function readFrom(p, offset) {
  const st = fs.statSync(p);
  if (st.size <= offset) return '';
  const fd = fs.openSync(p, 'r');
  try {
    const len = st.size - offset;
    const buf = Buffer.alloc(len);
    fs.readSync(fd, buf, 0, len, offset);
    return buf.toString('utf8');
  } finally {
    fs.closeSync(fd);
  }
}

const mtime = (p) => safe(() => fs.statSync(p).mtimeMs, 0);
const fileSize = (p) => safe(() => fs.statSync(p).size, 0);
const isDir = (p) => safe(() => fs.statSync(p).isDirectory(), false);
const listDir = (p) => safe(() => fs.readdirSync(p), []);
const exists = (p) => safe(() => fs.existsSync(p), false);

function newestFile(root, match, { depth = 4, limit = 400 } = {}) {
  let best = null;
  let seen = 0;
  const walk = (dir, d) => {
    if (d > depth || seen > limit) return;
    for (const name of listDir(dir)) {
      const full = path.join(dir, name);
      const st = safe(() => fs.statSync(full));
      if (!st) continue;
      seen++;
      if (st.isDirectory()) walk(full, d + 1);
      else if (match(full) && (!best || st.mtimeMs > best.mtime)) best = { file: full, mtime: st.mtimeMs, size: st.size };
    }
  };
  walk(root, 0);
  return best;
}

function fmtBytes(n) {
  if (!Number.isFinite(n) || n <= 0) return '—';
  const u = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < u.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v < 10 ? 1 : 0)} ${u[i]}`;
}

function fmtNum(n) {
  if (!Number.isFinite(n)) return '—';
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return String(Math.round(n));
}

function ago(ms) {
  if (!ms) return '—';
  const s = Math.max(0, Math.round((now() - ms) / 1000));
  if (s < 60) return `${s} 秒前`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} 分钟前`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} 小时前`;
  return `${Math.round(h / 24)} 天前`;
}

function short(s, n = 160) {
  const t = String(s || '')
    .replace(/\s+/g, ' ')
    .trim();
  return t.length > n ? t.slice(0, n) + '…' : t;
}

const hash = (s) => crypto.createHash('sha1').update(s).digest('hex').slice(0, 12);

const SYS_MSG =
  /^\s*(?:<(task-notification|system-reminder|codex_apps_|external_|environment_context|user_instructions|command-name|local-command|plan-content)|The following is the Codex agent history|Current runtime context)/i;

function toolDetail(raw) {
  let args = raw;
  if (typeof args === 'string') {
    try {
      args = JSON.parse(args);
    } catch {
      if (/^[0-9a-f]{8}-[0-9a-f]{4}/i.test(String(args)) || /^[0-9a-f]{24,}$/i.test(String(args))) return '(内部调用标识)';
      return short(args, 110);
    }
  }
  if (!args || typeof args !== 'object') {
    const raw2 = String(args || '');
    if (/^[0-9a-f]{8}-[0-9a-f]{4}/i.test(raw2) || /^[0-9a-f]{24,}$/i.test(raw2)) return '(内部调用标识)';
    return short(raw2, 110);
  }
  for (const k of ['command', 'description', 'file_path', 'path', 'pattern', 'query', 'url', 'prompt', 'task']) {
    if (typeof args[k] === 'string' && args[k].trim()) return short(args[k], 120);
  }
  const first = Object.entries(args).find(([, v]) => typeof v === 'string' && v.trim());
  return first ? `${first[0]}: ${short(first[1], 100)}` : short(JSON.stringify(args), 100);
}

/** 从工具调用参数里提取「本会话产物/涉及文件」的绝对路径 */
function filePathOf(raw) {
  let args = raw;
  if (typeof args === 'string') {
    try {
      args = JSON.parse(args);
    } catch {
      return '';
    }
  }
  if (!args || typeof args !== 'object') return '';
  for (const k of ['file_path', 'path', 'notebook_path', 'absolute_path']) {
    const v = args[k];
    if (typeof v === 'string' && /^([a-zA-Z]:[\\/]|\/)/.test(v)) return v;
  }
  return '';
}

/* ================================================================== *
 * 进程
 * ================================================================== */

let procCache = { at: 0, rows: [] };
let procLoading = false;

function processes() {
  if (now() - procCache.at < 1500) return procCache.rows;
  if(procLoading)return procCache.rows;
  procLoading=true;
  execFile('tasklist',['/FO','CSV','/NH'],{encoding:'utf8',windowsHide:true,maxBuffer:8<<20,timeout:8000},(error,out='')=>{
  const rows = [];
  for (const line of out.split(/\r?\n/)) {
    const m = line.match(/^"([^"]+)","(\d+)","([^"]*)","(\d+)","([^"]*)"/);
    if (!m) continue;
    rows.push({ image: m[1], pid: Number(m[2]), memKB: Number(String(m[5]).replace(/[^\d]/g, '')) || 0 });
  }
  procCache = { at: now(), rows };
  procLoading=false;
  });
  return procCache.rows;
}

const procsFor = (re) => processes().filter((r) => re.test(r.image));

function summarizeProcs(list) {
  const memKB = list.reduce((a, b) => a + b.memKB, 0);
  return {
    running: list.length > 0,
    count: list.length,
    memKB,
    memText: list.length ? fmtBytes(memKB * 1024) : '—',
    pids: list.map((r) => r.pid).slice(0, 8),
  };
}

/* ================================================================== *
 * TOML
 * ================================================================== */

function tomlValue(raw) {
  const v = raw.trim().replace(/\s+#.*$/, '');
  if (v.startsWith("'") && v.endsWith("'")) return v.slice(1, -1);
  if (v.startsWith('"') && v.endsWith('"')) return v.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, '\\');
  if (v.startsWith('[') && v.endsWith(']')) {
    return v
      .slice(1, -1)
      .split(',')
      .map((s) => tomlValue(s))
      .filter((s) => s !== '');
  }
  if (v === 'true') return true;
  if (v === 'false') return false;
  if (/^-?\d+(\.\d+)?$/.test(v)) return Number(v);
  return v;
}

function parseToml(text) {
  const root = {};
  let cur = root;
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim() || /^\s*#/.test(line)) continue;
    const sec = line.match(/^\s*\[([^\]]+)\]\s*$/);
    if (sec) {
      const keys = sec[1].split('.').map((k) => k.trim().replace(/^"|"$/g, ''));
      cur = root;
      for (const k of keys) {
        if (typeof cur[k] !== 'object' || cur[k] === null) cur[k] = {};
        cur = cur[k];
      }
      continue;
    }
    const kv = line.match(/^\s*([A-Za-z0-9_.\-"]+)\s*=\s*(.*)$/);
    if (!kv) continue;
    let val = kv[2].trim();
    if (val.startsWith('[') && !val.includes(']')) {
      while (i + 1 < lines.length && !val.includes(']')) {
        i++;
        val += ' ' + lines[i].trim();
      }
    }
    cur[kv[1].replace(/^"|"$/g, '')] = tomlValue(val);
  }
  return root;
}

/* ================================================================== *
 * 额度 / 用量
 * ================================================================== */

let codexQuotaCache = { key: '', data: null };
const quotaFileCache = new Map();

function collectCodexQuota(rollouts) {
  if (!rollouts.length) return null;

  // Windows can leave mtime unchanged while an open rollout continues growing.
  // Scan active text rollouts by event timestamp, caching each tail by size + mtime.
  let best = null;
  for (const r of rollouts.filter(record=>!record.file.endsWith('.zst'))) {
    const key=fileSize(r.file)+':'+r.mtime;let cached=quotaFileCache.get(r.file);
    if(!cached||cached.key!==key){let candidate=cached?.data||null;
      for(const j of parseJsonLines(safe(()=>readText(r.file,900000),''))){
        if(j?.payload?.type!=='token_count'||!j.payload.rate_limits)continue;
        const ts=Date.parse(j.timestamp)||0;if(!candidate||ts>candidate.ts)candidate={ts,payload:j.payload,file:r.file};
      }
      cached={key,data:candidate};quotaFileCache.set(r.file,cached);
    }
    if(cached.data&&(!best||cached.data.ts>best.ts))best=cached.data;
  }
  if (!best) return null;

  const key = `${best.file}:${best.ts}:${Number((best.payload.rate_limits?.primary?.resets_at||Infinity)*1000<now())}:${Number((best.payload.rate_limits?.secondary?.resets_at||Infinity)*1000<now())}`;
  if (codexQuotaCache.key === key) return codexQuotaCache.data;

  const rl = best.payload.rate_limits || {};
  const win = (w) =>
    w
      ? {
          stale: !!w.resets_at && w.resets_at*1000<=now() && best.ts<w.resets_at*1000,
          usedPercent: w.used_percent,
          leftPercent: Math.max(0, 100 - (w.used_percent || 0)),
          windowMinutes: w.window_minutes,
          resetsAt: w.resets_at ? w.resets_at * 1000 : null,
        }
      : null;

  const data = {
    kind: 'quota',
    primary: win(rl.primary),
    secondary: win(rl.secondary),
    credits: rl.credits || null,
    tokens: best.payload.info?.last_token_usage || null,
    total: best.payload.info?.total_token_usage || null,
    contextWindow: best.payload.info?.model_context_window || null,
    sampledAt: best.ts,
    source: 'session rollout · token_count',
    at: now(),
  };
  codexQuotaCache = { key, data };
  return data;
}

const wbUsageFiles = new Map();
function collectWorkBuddyUsage() {
  const todayStart = new Date().setHours(0,0,0,0);
  let requests=0,inputTokens=0,outputTokens=0,cachedTokens=0,sampledAt=0,sessions=0;
  for(const record of wbTranscriptFiles(Infinity)) {
    const size=fileSize(record.file);let cached=wbUsageFiles.get(record.file);
    if(!cached||cached.day!==todayStart||size<cached.offset)cached={day:todayStart,offset:0,seen:new Set(),requests:0,input:0,output:0,cached:0,sampledAt:0};
    if(size>cached.offset){
      const fd=fs.openSync(record.file,'r'),decoder=new StringDecoder('utf8'),buffer=Buffer.alloc(65536);let position=cached.offset,carry='';
      try{while(position<size){const count=fs.readSync(fd,buffer,0,Math.min(buffer.length,size-position),position);if(!count)break;position+=count;carry+=decoder.write(buffer.subarray(0,count));let newline;
        while((newline=carry.indexOf('\n'))>=0){const line=carry.slice(0,newline);carry=carry.slice(newline+1);cached.offset+=Buffer.byteLength(line+'\n');
          try{const j=JSON.parse(line),usage=j.providerData?.usage,ts=typeof j.timestamp==='number'?j.timestamp:Date.parse(j.timestamp)||0;
            if(!usage||ts<todayStart||ts>todayStart+86400000)continue;
            const key=j.providerData.messageId||(j.providerData.conversationRequestId&&j.providerData.stepSeq!==undefined?j.providerData.conversationRequestId+':'+j.providerData.stepSeq:null)||j.id||`${ts}:${usage.inputTokens}:${usage.outputTokens}`;
            if(cached.seen.has(key))continue;cached.seen.add(key);cached.requests+=usage.requests||1;cached.input+=usage.inputTokens||0;cached.output+=usage.outputTokens||0;cached.cached+=usage.inputTokensDetails?.[0]?.cached_tokens||0;cached.sampledAt=Math.max(cached.sampledAt,ts);
          }catch{}
        }
      }}finally{fs.closeSync(fd);}
    }
    wbUsageFiles.set(record.file,cached);requests+=cached.requests;inputTokens+=cached.input;outputTokens+=cached.output;cachedTokens+=cached.cached;sampledAt=Math.max(sampledAt,cached.sampledAt);if(cached.requests)sessions++;
  }
  return {kind:'usage',requests,inputTokens,outputTokens,cachedTokens,totalTokens:inputTokens+outputTokens,sessions,sampledAt,source:'按事件日期筛选并按原生 messageId 去重的本地用量记录',at:now()};
}

function collectDshUsage() {
  const today = new Date();
  const day = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  const reqFile = path.join(P.dshHome, `.qoder-request-count.qoder-cn.${day}.json`);
  const tokFile = path.join(P.dshHome, `.qoder-token-count.qoder-cn.${day}.json`);
  let req = safe(() => JSON.parse(fs.readFileSync(reqFile, 'utf8')), null);
  let tok = safe(() => JSON.parse(fs.readFileSync(tokFile, 'utf8')), null);
  let stale = false; // true = dsh 今天没跑，显示的是最近一次的历史计数

  if (!req && !tok) {
    // 今天没有计数文件：退回最近一次的，别让额度卡空白
    let best = null;
    for (const f of safe(() => fs.readdirSync(P.dshHome), [])) {
      if (!/^\.qoder-(request|token)-count\./.test(f)) continue;
      const p = path.join(P.dshHome, f);
      const t = mtime(p);
      if (!t) continue;
      if (!best || t > best.t) best = { f, t };
    }
    if (best) {
      const j = safe(() => JSON.parse(fs.readFileSync(path.join(P.dshHome, best.f), 'utf8')), null);
      if (j) {
        stale = true;
        if (best.f.includes('request')) req = j;
        else tok = j;
      }
    }
    if (!req && !tok) return null;
  }

  return {
    kind: 'usage',
    requests: req?.count ?? 0,
    dailyLimitHit: !!req?.dailyLimitHit,
    tokens: tok?.total ?? 0,
    cachedTokens: tok?.cached ?? 0,
    stale,
    at: Math.max(mtime(reqFile), mtime(tokFile)) || now(),
  };
}

/* ================================================================== *
 * Codex
 * ================================================================== */

function codexRollouts() {
  const files = [];
  for (const base of [path.join(P.codexHome, 'sessions'), path.join(P.codexHome, 'archived_sessions')]) {
  const walk = (dir) => {
    for (const entry of safe(() => fs.readdirSync(dir, { withFileTypes: true }), [])) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.jsonl(?:\.zst)?$/.test(entry.name)) files.push({ file: full, mtime: mtime(full) });
    }
  };
  walk(base);
  }
  return files.sort((a, b) => b.mtime - a.mtime);
}

function codexSessionMeta(file) {
  const head = safe(() => readReplayHead(file, 24_000), '');
  for (const line of head.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const j = JSON.parse(line);
      if (j.type === 'session_meta') return j.payload || {};
    } catch {
      return null;
    }
  }
  return null;
}

function codexLineToItem(line, full) {
  let j;
  try {
    j = JSON.parse(line);
  } catch {
    return null;
  }
  const p = j.payload || {};
  const ts = Date.parse(j.timestamp) || now();
  const cut = (t, m) => (full ? String(t || '') : short(t, m));
  if (j.type === 'event_msg') {
    if (p.type === 'task_complete') {
      return { ts, kind: 'done', text: cut(p.last_agent_message || '回合完成', 240), meta: p.duration_ms ? `耗时 ${(p.duration_ms / 1000).toFixed(1)}s` : '' };
    }
    if (p.type === 'user_message') {
      const ask = extractAsk(p.message || '');
      if (!ask.trim() || SYS_MSG.test(ask)) return null;
      return { ts, kind: 'ask', text: cut(ask, 220), meta: '' };
    }
    // 新版 rollout 用 item_completed 承载对话条目
    if (p.type === 'item_completed' && p.item) {
      const it = p.item;
      const t = String(it.type || '');
      const body = contentBlocks(it.content)
        .filter((c) => c && typeof c.text === 'string')
        .map((c) => c.text)
        .join(' ');
      if (/agentmessage|assistantmessage/i.test(t)) {
        if (it.role && it.role !== 'assistant') return null;
        return body.trim() ? { ts, kind: 'done', text: cut(body, 260), meta: '' } : null;
      }
      if (/usermessage/i.test(t)) {
        const ask = extractAsk(body);
        if (!ask.trim() || SYS_MSG.test(ask)) return null;
        const imgs = contentBlocks(it.content)
          .filter((c) => c && c.type === 'input_image' && typeof c.image_url === 'string' && c.image_url.startsWith('data:'))
          .map((c, i) => ({ name: `image-${i + 1}`, isImage: true, dataUrl: c.image_url }));
        return { ts, kind: 'ask', text: cut(ask, 220), meta: '', atts: imgs.length ? imgs : undefined };
      }
      if (/commandexecution|functioncall|toolcall|mcptool/i.test(t)) {
        return { ts, kind: 'tool', text: short(it.name || it.command || t, 60), meta: toolDetail(it.arguments || it.command), file: filePathOf(it.arguments) };
      }
      return null;
    }
    return null;
  }
  if (j.type === 'response_item') {
    if (p.type === 'custom_tool_call') return { ts, kind: 'tool', text: p.name || 'tool', meta: toolDetail(p.input), files: [...String(p.input || '').matchAll(/^\*\*\* (?:Add|Update|Delete) File: (.+)$/gm)].map((m) => m[1].trim()) };
    if (p.type === 'function_call') return { ts, kind: 'tool', text: short(p.name || 'tool', 60), meta: toolDetail(p.arguments), file: filePathOf(p.arguments) };
    if (p.type === 'message') {
      // system / developer 是 Codex 自己注入的提示词，不算对话
      if (p.role !== 'user' && p.role !== 'assistant') return null;
      const rawBody = contentBlocks(p.content)
        .filter((c) => c && (c.type === 'output_text' || c.type === 'input_text' || c.type === 'text'))
        .map((c) => c.text || '')
        .join(' ');
      const body = p.role === 'user' ? extractAsk(rawBody) : rawBody;
      if (!body.trim() || SYS_MSG.test(body)) return null;
      const atts = contentBlocks(p.content).filter((c) => c.type === 'input_image' && typeof c.image_url === 'string').map((c) => ({ isImage: true, dataUrl: c.image_url }));
      return { atts, ts, kind: p.role === 'user' ? 'ask' : 'done', text: cut(body, 260), meta: '' };
    }
  }
  return null;
}

let codexSessionCache = new Map(); // file -> {size, mtime, items, meta}

function codexSessionItems(file) {
  const st = safe(() => fs.statSync(file));
  if (!st) return { items: [], meta: null };
  const hit = codexSessionCache.get(file);
  if (hit && hit.size === st.size && hit.mtime === st.mtimeMs) return hit;

  const items = [];
  const tail = safe(() => readText(file, 400_000), '');
  for (const line of tail.split(/\r?\n/)) {
    const it = codexLineToItem(line);
    if (it) items.push({ ...it, id: `codex:${hash(line)}`, source: 'codex' });
  }
  const meta = codexSessionMeta(file);
  const rec = { size: st.size, mtime: st.mtimeMs, items, meta };
  codexSessionCache.set(file, rec);
  if (codexSessionCache.size > 40) codexSessionCache.delete(codexSessionCache.keys().next().value);
  return rec;
}

const activityEventsCache = new Map();
function dshExecutionEvents(file) {
  const key = fileSize(file) + ':' + mtime(file);
  const cached = activityEventsCache.get(file); if (cached?.key === key) return cached.events;
  const events = [];
  for(const line of dshSessionLines(file,Infinity)){try{const j=JSON.parse(line),ts=(typeof j.time==='number'?j.time:Date.parse(j.time)||0)||(typeof j.timestamp==='number'?j.timestamp:Date.parse(j.timestamp)||0);if(j.type==='turn/start')events.push({sessionId:file,ts,phase:'start'});else if(j.type==='turn/end')events.push({sessionId:file,ts,phase:'end'});else if(j.type==='step/end'||j.type==='tool/call')events.push({sessionId:file,ts,phase:'work'});}catch{}}
  activityEventsCache.set(file,{key,events});return events;
}
function recentExecutionEvents(agent, files) {
  const events=[];
  for(const file of files) {
    const text=safe(()=>readText(file,450000),'');
    for(const j of parseJsonLines(text)) {
      const ts=typeof j.timestamp==='number'?j.timestamp:Date.parse(j.timestamp)||Date.parse(j.time)||0;
      if(!ts)continue;
      if(agent==='codex') {
        const type=j.payload?.type;
        if(j.type==='event_msg'&&['task_started','turn_started'].includes(type))events.push({sessionId:file,ts,phase:'start'});
        else if(j.type==='event_msg'&&['task_complete','turn_aborted','turn_completed'].includes(type))events.push({sessionId:file,ts,phase:'end'});
        else if(j.type==='event_msg'&&['item_completed','token_count','agent_reasoning'].includes(type))events.push({sessionId:file,ts,phase:'work'});
      } else if(agent==='workbuddy') {
        if(j.type==='message'&&j.role==='user')events.push({sessionId:file,ts,phase:'input'});
        else if(j.type==='function_call')events.push({sessionId:file,ts,phase:'work'});
        else if(j.type==='message'&&j.role==='assistant')events.push({sessionId:file,ts,phase:'reply'});
      }
    }
  }
  return events;
}
function activityFor(agent,files,procs){
  const jobs=safe(()=>JSON.parse(fs.readFileSync(path.join(workbench.dir,'store.json'),'utf8')).tasks,[]);
  return classifyActivity(agent,recentExecutionEvents(agent,files),procs.running,now(),jobs);
}

function collectCodex() {
  const cfgPath = path.join(P.codexHome, 'config.toml');
  const cfg = safe(() => parseToml(fs.readFileSync(cfgPath, 'utf8')), {});
  const mcp = cfg.mcp_servers || {};

  const rollouts = codexRollouts().filter(r=>!r.file.endsWith('.zst'));
  // 控制台自己发起的会话优先，否则取最近修改的那份
  const prefer = activeRun && activeRun.threadId ? rollouts.find((r) => r.file.includes(activeRun.threadId)) : null;
  if (prefer) {
    rollouts.splice(rollouts.indexOf(prefer), 1);
    rollouts.unshift(prefer);
  }
  const todayStart = new Date().setHours(0, 0, 0, 0);
  const todayCount = rollouts.filter((r) => r.mtime >= todayStart).length;
  const latest = rollouts[0] || null;

  // 最近几个会话里挑"真的能解析出对话"的那个：
  // 老会话可能已经涨到几百 MB，尾部只是一条巨大的 token_count 行。
  let sessionFile = latest ? latest.file : null;
  let parsed = { items: [], meta: null };
  for (const r of rollouts.slice(0, 4)) {
    const p = codexSessionItems(r.file);
    if (p.items.length) {
      sessionFile = r.file;
      parsed = p;
      break;
    }
    if (r === rollouts[0]) parsed = p;
  }
  const recent = parsed.items.slice(-14);
  const lastEvent = recent[recent.length - 1] || null;

  const procs = summarizeProcs(procsFor(/chatgpt\.exe$|^codex(-.*)?\.exe$|codex-windows-sandbox-service\.exe$/i));
  const quota = collectCodexQuota(rollouts);
  const activity=activityFor('codex',rollouts.slice(0,12).map(r=>r.file),procs);

  const mcpItems = Object.entries(mcp).map(([name, v]) => ({
    k: name,
    v: v && v.enabled === false ? '已停用' : v && v.command ? 'stdio' : v && v.url ? 'http' : '已启用',
    tone: v && v.enabled === false ? 'muted' : 'good',
  }));

  return {
    id: 'codex',
    name: 'Codex',
    subtitle: 'OpenAI · 桌面版 + CLI',
    hue: 265,
    procs,
    activity,
    lastActivity: activity.lastActivity,
    activityLabel: ago(activity.lastActivity),
    busy: activity.busy,
    headline: { modelSource:'配置默认，非运行状态', model: cfg.model || '未设置', effort: cfg.model_reasoning_effort || '—', sandbox: cfg.sandbox_mode || '—' },
    metrics: [
      { label: '今日会话', value: String(todayCount), hint: 'rollout 文件数' },
      { label: '采样输入', value: quota?.tokens ? fmtNum(quota.tokens.input_tokens) : '—', hint: '最近一回合输入 token' },
      { label: 'MCP', value: String(Object.keys(mcp).length), hint: '含自建桥接' },
    ],
    quota,
    current: {
      workspace: (parsed.meta && parsed.meta.cwd) || '—',
      lastAction: lastEvent ? lastEvent.text : '暂无记录',
      session: sessionFile ? path.basename(sessionFile).replace(/^rollout-|\.jsonl$/g, '') : '—',
    },
    config: {
      path: cfgPath,
      exists: exists(cfgPath),
      groups: [
        { title: '模型', items: [
          { k: 'model', v: cfg.model || '—' },
          { k: 'reasoning', v: cfg.model_reasoning_effort || '—' },
          { k: 'service_tier', v: cfg.service_tier || '—' },
        ] },
        { title: '执行', items: [
          { k: 'sandbox_mode', v: cfg.sandbox_mode || '—' },
          { k: 'locale', v: (cfg.desktop && cfg.desktop.localeOverride) || '—' },
        ] },
        { title: 'MCP 服务器', items: mcpItems.length ? mcpItems : [{ k: '—', v: '无', tone: 'muted' }] },
      ],
    },
    feed: recent,
  };
}

/* ================================================================== *
 * WorkBuddy
 * ================================================================== */

function wbSessions() {
  const dir = path.join(P.wbHome, 'sessions');
  return listDir(dir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => {
      const file = path.join(dir, f);
      const j = safe(() => JSON.parse(fs.readFileSync(file, 'utf8')), null);
      return j ? { file, ...j, mtime: mtime(file) } : null;
    })
    .filter(Boolean)
    .sort((a, b) => (b.lastHeartbeat || b.mtime) - (a.lastHeartbeat || a.mtime));
}

function wbTranscriptPath() {
  const n = newestFile(path.join(P.wbHome, 'projects'), (f) => f.endsWith('.jsonl'), { depth: 2, limit: 300 });
  return n ? n.file : null;
}

function wbLineToItem(line, full) {
  let j;
  try {
    j = JSON.parse(line);
  } catch {
    return null;
  }
  const ts = typeof j.timestamp === 'number' ? j.timestamp : Date.parse(j.timestamp) || now();
  if (j.type === 'message') {
    const raw = contentBlocks(j.content)
      .filter((c) => c && (c.type === 'output_text' || c.type === 'text' || c.type === 'input_text'))
      .map((c) => c.text || '')
      .join(' ');
    if (!raw.trim()) return null;
    // 用户提问被包在 system-reminder 里，真句在 <user_query> 内
    const body = j.role === 'user' ? extractAsk(raw) : raw;
    if (!body.trim() || SYS_MSG.test(body)) return null;
    if (j.role !== 'user' && j.role !== 'assistant') return null;
    return { ts, kind: j.role === 'user' ? 'ask' : 'done', text: full ? body : short(body, j.role === 'user' ? 220 : 260), meta: '' };
  }
  if (j.type === 'function_call') {
    return { ts, kind: 'tool', text: short(j.name || 'tool', 48), meta: toolDetail(j.arguments || j.input), file: filePathOf(j.arguments || j.input) };
  }
  return null;
}

function collectWorkBuddy() {
  const launch = safe(() => JSON.parse(fs.readFileSync(path.join(P.wbHome, 'last-launch.json'), 'utf8')), {});
  const settingsPath = path.join(P.wbHome, 'settings.json');
  const toolList = safe(() => JSON.parse(fs.readFileSync(path.join(P.wbHome, 'mcp-tool-list.json'), 'utf8')), {});
  const models = safe(() => JSON.parse(fs.readFileSync(path.join(P.wbHome, 'models.json'), 'utf8')), []);

  const sessions = wbSessions();
  const live = sessions.filter((s) => now() - (s.lastHeartbeat || 0) < 5 * 60_000);
  const main = live[0] || sessions[0] || null;

  const transcript = wbTranscriptPath();
  const feed = [];
  let cwd = '';
  if (transcript) {
    const tail = safe(() => readText(transcript, 500_000), '');
    for (const line of tail.split(/\r?\n/)) {
      if (!line.trim()) continue;
      const it = wbLineToItem(line);
      if (it) feed.push({ ...it, id: `wb:${hash(line)}`, source: 'workbuddy' });
      if (!cwd) {
        const m = line.match(/"cwd":"([^"]+)"/);
        if (m) cwd = m[1].replace(/\\\\/g, '\\');
      }
    }
  }
  const recent = feed.slice(-14);
  const lastMsg = [...recent].reverse().find((i) => i.kind === 'done' || i.kind === 'ask');

  const procs = summarizeProcs(procsFor(/^workbuddy\.exe$/i));
  const lastActivity = Math.max(transcript ? mtime(transcript) : 0, main ? main.lastHeartbeat || 0 : 0);

  const plugins = listDir(path.join(P.wbHome, 'plugins')).filter((f) => !f.startsWith('.'));
  const entries = (toolList && toolList.entries) || {};
  const servers = Object.keys(entries);
  const toolCount = servers.reduce((n, k) => n + (entries[k] || []).length, 0);

  const todayStart = new Date().setHours(0, 0, 0, 0);
  const todaySessions = sessions.filter((s) => (s.startedAt || s.mtime) >= todayStart).length;
  const uptimeMin = main && main.startedAt ? Math.round((now() - main.startedAt) / 60000) : 0;
  const usage = collectWorkBuddyUsage();
  const activity=activityFor('workbuddy',wbTranscriptFiles(12).map(r=>r.file),procs);

  return {
    id: 'workbuddy',
    name: 'WorkBuddy',
    subtitle: '腾讯 · 桌面端 + 内置 CLI',
    hue: 45,
    procs,
    activity,
    lastActivity: activity.lastActivity,
    activityLabel: ago(activity.lastActivity),
    busy: activity.busy,
    headline: {
      model: readDatabase(path.join(P.wbHome,'workbuddy.db'), 'SELECT model FROM sessions WHERE deleted_at IS NULL ORDER BY updated_at DESC LIMIT 1')[0]?.model || '未确认',
      modelSource:'最近会话记录',
      version: (main && main.version) || '—',
      channel: main ? `${main.kind || 'session'} · ${main.mode || 'local'}` : '未连接',
    },
    metrics: [
      { label: '在线会话', value: String(live.length), hint: `仅表示心跳在线，非正在执行；今日 ${todaySessions} 个` },
      { label: '今日记录 token', value: usage ? fmtNum(usage.totalTokens) : '—', hint: usage ? `${usage.requests} 次记录；本地统计，不代表剩余额度` : '无记录' },
      { label: 'MCP 工具', value: String(toolCount), hint: `${servers.length} 组可用` },
    ],
    quota: usage,
    current: {
      workspace: (main && main.cwd) || cwd || '—',
      lastAction: lastMsg ? lastMsg.text : '暂无记录',
      session: main ? main.sessionId : '—',
    },
    config: {
      path: settingsPath,
      exists: exists(settingsPath),
      groups: [
        { title: '版本', items: [
          { k: '桌面端', v: launch.version || '—' },
          { k: '引擎', v: (main && main.version) || '—' },
          { k: '在线', v: uptimeMin ? `${uptimeMin} 分钟` : '—' },
        ] },
        { title: '运行时', items: [
          { k: '会话', v: live.length ? `${live.length} 活跃` : '无活跃', tone: live.length ? 'good' : 'muted' },
          { k: '端点', v: (main && main.endpoint) || '—' },
          { k: '工作区', v: (main && main.cwd) || cwd || '—' },
        ] },
        { title: '插件与桥接', items: [
          { k: '插件', v: `${plugins.length} 个` },
          { k: 'MCP 工具', v: toolCount ? `${toolCount} 个` : '未连接' },
          { k: 'wb-bridge', v: exists(P.wbBridge) ? '已部署' : '未部署', tone: exists(P.wbBridge) ? 'good' : 'muted' },
        ] },
      ],
    },
    feed: recent,
  };
}

/* ================================================================== *
 * dsh
 * ================================================================== */

function dshProfiles() {
  const base = path.join(P.dshHome, 'profiles');
  return listDir(base)
    .filter((n) => isDir(path.join(base, n)))
    .map((n) => {
      const dir = path.join(base, n);
      const pkg = safe(() => JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')), {});
      const bundles = (pkg.dsh && pkg.dsh.profile && pkg.dsh.profile.bundles) || [];
      const patch = safe(() => fs.readFileSync(path.join(dir, 'cordis.patch.yml'), 'utf8'), '');
      const provider = (patch.match(/provider:\s*([\w\-.]+)/) || [])[1] || 'deepseek-official';
      const model = (patch.match(/model:\s*([\w\-.]+)/) || [])[1] || 'deepseek-flash';
      return { name: n, dir, bundles, depCount: Object.keys(pkg.dependencies || {}).length, provider, model };
    });
}

function dshSessions(limit = 8) {
  const base = path.join(P.dshHome, 'sessions');
  const found = [];
  for (const ws of listDir(base)) {
    const wsDir = path.join(base, ws);
    if (!isDir(wsDir)) continue;
    for (const sid of listDir(wsDir)) {
      const f = path.join(wsDir, sid, 'session.v4.jsonl.zstd');
      const t = mtime(f);
      if (t) found.push({ ws, sid, file: f, mtime: t, size: fileSize(f) });
    }
  }
  return found.sort((a, b) => b.mtime - a.mtime).slice(0, limit);
}

function dshSessionHeader(file) {
  return safe(()=>JSON.parse(dshSessionLines(file,1)[0]),null);
}

/* ---------------- dsh 会话：逐帧 zstd（首帧带 magic，其后为 magicless 续帧） ---------------- */

function zstdFrames(buf, maxOut = 6 << 20) {
  const MAGIC = 0xfd2fb528;
  const MAGIC_BUF = Buffer.from([0x28, 0xb5, 0x2f, 0xfd]);
  const frames = [];
  let off = 0;
  let total = 0;

  const endOf = (start) => {
    let i = start;
    const hasMagic = i + 4 <= buf.length && buf.readUInt32LE(i) === MAGIC;
    if (hasMagic) i += 4;
    if (i >= buf.length) return -1;
    const fhd = buf[i++];
    const fcsFlag = fhd >> 6;
    const singleSeg = (fhd >> 5) & 1;
    const checksum = (fhd >> 2) & 1;
    const dictFlag = fhd & 3;
    if (!singleSeg) {
      if (i >= buf.length) return -1;
      i += 1;
    }
    i += [0, 1, 2, 4][dictFlag];
    i += [singleSeg ? 1 : 0, 2, 4, 8][fcsFlag];
    for (let guard = 0; guard < 200_000; guard++) {
      if (i + 3 > buf.length) return -1;
      const bh = buf.readUIntLE(i, 3);
      i += 3;
      const last = bh & 1;
      const type = (bh >> 1) & 3;
      const size = bh >> 3;
      if (type === 0 || type === 2) i += size;
      else if (type === 1) i += 1;
      else return -1;
      if (i > buf.length) return -1;
      if (last) break;
    }
    if (checksum) i += 4;
    return i > buf.length ? -1 : i;
  };

  while (off < buf.length - 2 && total < maxOut) {
    const end = endOf(off);
    if (end <= off) break;
    const hasMagic = off + 4 <= buf.length && buf.readUInt32LE(off) === MAGIC;
    const slice = hasMagic
      ? buf.subarray(off, end)
      : Buffer.concat([MAGIC_BUF, buf.subarray(off, end)]);
    let dec;
    try {
      dec = zlib.zstdDecompressSync(slice);
    } catch {
      break;
    }
    frames.push(dec);
    total += dec.length;
    off = end;
  }
  return frames;
}

function dshSessionLines(file, maxOut = 2 << 20) {
  return safe(() => {
    const size = fileSize(file);
    const buf = fs.readFileSync(file);
    const frames = zstdFrames(buf, maxOut);
    if (!frames.length) return [];
    return Buffer.concat(frames).toString('utf8').split(/\r?\n/).filter((l) => l.trim());
  }, []);
}

/* ---------------- 三家统一的会话索引（左侧栏数据源） ---------------- */

// Retain parsed history metadata across launches; unchanged files need no decoding.
const SESSION_CACHE_FILE = path.join(HERE,'.session-metadata-cache.json');
const SESSION_CACHE = new Map(safe(()=>JSON.parse(fs.readFileSync(SESSION_CACHE_FILE,'utf8')),[]));
let sessionCacheSaveTimer;

function cachedSession(file, mt, build) {
  const hit = SESSION_CACHE.get(file);
  if (hit && hit.mtime === mt) return hit.data;
  const data = build();
  SESSION_CACHE.set(file, { mtime: mt, data });
  if (SESSION_CACHE.size > 10000) SESSION_CACHE.delete(SESSION_CACHE.keys().next().value);
  clearTimeout(sessionCacheSaveTimer);
  sessionCacheSaveTimer=setTimeout(()=>{
    try{const temp=SESSION_CACHE_FILE+'.tmp';fs.writeFileSync(temp,JSON.stringify([...SESSION_CACHE]));fs.renameSync(temp,SESSION_CACHE_FILE);}catch{}
  },1500);
  sessionCacheSaveTimer.unref();
  return data;
}

/** WorkBuddy/Codex 会把用户提问包在 system-reminder 里，真正的问句在 <user_query> 标签内 */
function contentBlocks(content) {
  return Array.isArray(content) ? content : typeof content === 'string' ? [{ type: 'text', text: content }] : [];
}

function extractAsk(raw) {
  const t = String(raw || '');
  const m = t.match(/<user_query>([\s\S]*?)<\/user_query>/i);
  if (m && m[1].trim()) return m[1].trim();
  return t;
}

function firstAskText(text) {
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const it = codexLineToItem(line);
    if (!it || it.kind !== 'ask') continue;
    const ask = extractAsk(it.text);
    if (SYS_MSG.test(ask) || !ask.trim()) continue;
    return ask;
  }
  return '';
}

function codexSessionTitle(file) {
  const head = safe(() => readReplayHead(file, 220_000), '');
  return firstAskText(head);
}

function readReplayHead(file, max) {
  if (!file.endsWith('.zst')) return readHeadText(file, max);
  return Buffer.concat(zstdFrames(fs.readFileSync(file), max)).toString('utf8').slice(0, max);
}

function wbSessionMeta(file) {
  // 头部常常是 system-reminder，真实提问可能在几百 KB 之后
  const head = safe(() => readHeadText(file, 1_600_000), '');
  let cwd = '';
  let title = '';
  for (const line of head.split(/\r?\n/)) {
    if (!line.trim()) continue;
    let j;
    try {
      j = JSON.parse(line);
    } catch {
      continue;
    }
    if (!cwd && typeof j.cwd === 'string') cwd = j.cwd;
    if (!title && j.type === 'message' && j.role === 'user') {
      const t = contentBlocks(j.content)
        .filter((c) => c && typeof c.text === 'string')
        .map((c) => c.text)
        .join(' ')
        .trim();
      const ask = extractAsk(t);
      if (ask && !SYS_MSG.test(ask)) title = ask;
    }
    if (cwd && title) break;
  }
  return { cwd, title };
}

function dshSessionMeta(file) {
  const lines = dshSessionLines(file, Infinity);
  let header = null;
  let title = '';
  for (const line of lines) {
    let j;
    try {
      j = JSON.parse(line);
    } catch {
      continue;
    }
    if (!header && j.type === 'session') header = j;
    if (!title) {
      const inserted = j.type === 'agent/inbox/spliced' && j.data && Array.isArray(j.data.inserted) ? j.data.inserted : null;
      if (inserted) {
        for (const msg of inserted) {
          const src = msg && msg.source;
          if (src && src.kind === 'user' && Array.isArray(msg.content)) {
            const t = msg.content
              .filter((c) => c && typeof c.text === 'string')
              .map((c) => c.text)
              .join(' ')
              .trim();
            const ask = extractAsk(t);
            if (ask && !SYS_MSG.test(ask)) {
              title = ask;
              break;
            }
          }
        }
      }
    }
    if(j.type==='session/title'&&typeof j.data?.title==='string'&&j.data.title.trim())title=j.data.title.trim();
  }
  return { header, title };
}

function wbTranscriptFiles(limit = 40) {
  const base = path.join(P.wbHome, 'projects');
  const out = [];
  for (const slug of listDir(base)) {
    const dir = path.join(base, slug);
    if (!isDir(dir)) continue;
    for (const f of listDir(dir)) {
      if (!f.endsWith('.jsonl')) continue;
      const full = path.join(dir, f);
      const t = mtime(full);
      if (t) out.push({ slug, file: full, mtime: t });
    }
  }
  return out.sort((a, b) => b.mtime - a.mtime).slice(0, limit);
}

/** [{ id, agent, cwd, title, ts, file }]，按时间倒序 */
function collectSessions() {
  const out = [];
  const native = new Map(codexMetadata().map((row) => [row.id, row]));
  

  for (const r of codexRollouts()) {
    const data = cachedSession(r.file, r.mtime, () => {
      const nativeId = path.basename(r.file).replace(/\.jsonl(?:\.zst)?$/, '').match(/[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i)?.[0];
      const row = native.get(nativeId);
      const meta = row || codexSessionMeta(r.file) || {};
      return {
        id: `codex:${path.basename(r.file).replace(/\.jsonl(?:\.zst)?$/, '')}`,
        agent: 'codex',
        cwd: cleanPath(meta.cwd),
        title: row?.title || row?.first_user_message || codexSessionTitle(r.file) || '',
        nativeArchived: !!row?.archived,
        ts: r.mtime,
        file: r.file,
      };
    });
    const nativeId = data.id.match(/[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i)?.[0];
    const row = native.get(nativeId);
    out.push(row ? { ...data, cwd: cleanPath(row.cwd) || data.cwd, title: row.title || data.title, nativeArchived: !!row.archived } : data);
  }

  for (const r of wbTranscriptFiles(Infinity)) {
    const data = cachedSession(r.file, r.mtime, () => {
      const meta = wbSessionMeta(r.file);
      return {
        id: `wb:${r.slug}/${path.basename(r.file, '.jsonl')}`,
        agent: 'workbuddy',
        cwd: meta.cwd || '',
        title: meta.title || '',
        ts: r.mtime,
        file: r.file,
      };
    });
    out.push(data);
  }

  for (const s of dshSessions(Infinity)) {
    const data = cachedSession(s.file, s.mtime, () => {
      const meta = dshSessionMeta(s.file);
      const h = meta.header || {};
      return {
        id: `dsh:${h.id || s.sid}`,
        agent: 'dsh',
        cwd: h.cwd || '',
        title: meta.title || '',
        ts: s.mtime,
        createdAt: h.createdAt,
        file: s.file,
        preset: h.agentPreset || '',
      };
    });
    out.push({...data,busy:Date.now()-s.mtime<120000&&classifyActivity('dsh',dshExecutionEvents(s.file),true).busy});
  }

  return [...new Map(out.map((s) => [s.id, { ...s, cwd: s.cwd ? path.normalize(cleanPath(s.cwd)) : '' }])).values()].sort((a, b) => b.ts - a.ts);
}

/* ---------------- 归档 / 置顶（写在本目录的 .console-state.json） ---------------- */

const STATE_FILE = process.env.CONSOLE_STATE_FILE || path.join(HERE, '.console-state.json');

function readConsoleState() {
  const j = safe(() => JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')), {});
  return {
    archived: j && typeof j.archived === 'object' && j.archived ? j.archived : {},
    pinned: Array.isArray(j && j.pinned) ? j.pinned : [],
    aliases: j && typeof j.aliases === 'object' && j.aliases ? j.aliases : { sessions: {}, projects: {} },
    hiddenProjects: Array.isArray(j && j.hiddenProjects) ? j.hiddenProjects : [],
    projectAgents: j?.projectAgents&&typeof j.projectAgents==='object'?j.projectAgents:{},
    pinnedSessions: Array.isArray(j && j.pinnedSessions) ? j.pinnedSessions : [],
  };
}

function writeConsoleState(next) {
  const temp = STATE_FILE + '.tmp';
  fs.writeFileSync(temp, JSON.stringify(next, null, 2), 'utf8');
  fs.renameSync(temp, STATE_FILE);
  invalidateProjects();
  return next;
}

const dshFeedCache=new Map();
function dshFeed(session){
  const stamp=session.mtime+':'+session.size,cached=dshFeedCache.get(session.file);if(cached?.stamp===stamp)return cached.items;
  const items=[];for(const record of parseJsonLines(dshSessionLines(session.file,Infinity).join('\n'))){for(const item of dshRecordItems(record)){
    if(!item.text.trim())continue;if(item.role==='user'&&SYS_MSG.test(extractAsk(item.text)))continue;
    items.push({id:'dsh:'+session.sid+':'+(record.seq??record.time)+':'+item.id,ts:item.ts,source:'dsh',kind:({user:'ask',assistant:'done',reasoning:'info',tool:'tool',status:'done'})[item.role],text:short(item.role==='user'?extractAsk(item.text):item.text,1400),meta:item.meta?short(item.meta,2400):'',sessionId:'dsh:'+session.sid,role:item.role});
  }}
  const value=items.slice(-60);dshFeedCache.set(session.file,{stamp,items:value});if(dshFeedCache.size>12)dshFeedCache.delete(dshFeedCache.keys().next().value);return value;
}

function collectDsh() {
  const profiles = dshProfiles();
  const delegate = profiles.find((p) => p.name === 'delegate') || null;
  const desktop = profiles.find((p) => p.name === 'desktop') || null;

  const sessions = dshSessions(60);
  const todayStart = new Date().setHours(0, 0, 0, 0);
  const todayCount = sessions.filter((s) => s.mtime >= todayStart).length;
  const latest = sessions[0] || null;
  const header = latest ? dshSessionHeader(latest.file) : null;

  const procs = summarizeProcs(procsFor(/deepseek harness\.exe|^dsh(-.*)?\.exe$/i));
  const lastActivity = latest ? latest.mtime : 0;

  const credText = safe(() => fs.readFileSync(path.join(P.dshHome, '.credentials.yaml'), 'utf8'), '');
  const refs = [...credText.matchAll(/^\s{2}([A-Z0-9_]+):/gm)].map((m) => m[1]);
  const dangling = /DEEPSEEK_API_KEY/.test(credText) ? 'DEEPSEEK_API_KEY 悬空' : null;
  const usage = collectDshUsage();
  const events=[];
  for(const session of sessions.slice(0,3))events.push(...dshExecutionEvents(session.file));
  const jobs=safe(()=>JSON.parse(fs.readFileSync(path.join(workbench.dir,'store.json'),'utf8')).tasks,[]);
  const activity=classifyActivity('dsh',events,procs.running,now(),jobs);

  return {
    id: 'dsh',
    name: 'DSH',
    subtitle: 'DeepSeek Harness · 插件式内核',
    hue: 175,
    procs,
    activity,
    lastActivity: activity.lastActivity,
    activityLabel: ago(activity.lastActivity),
    busy: activity.busy,
    headline: {
      modelSource:'delegate 配置默认',
      model: delegate ? delegate.model : desktop ? desktop.model : '—',
      provider: delegate ? delegate.provider : desktop ? desktop.provider : '—',
      version: '0.2.1-rc.2',
    },
    metrics: [
      { label: '今日会话', value: String(todayCount), hint: '按工作区分目录' },
      { label: usage?.stale ? '历史 token' : '今日记录 token', value: usage ? fmtNum(usage.tokens) : '—', hint: usage ? `${usage.requests} 次请求` : '无记录' },
      { label: 'Profile', value: String(profiles.length), hint: profiles.map((p) => p.name).join(' / ') || '—' },
    ],
    quota: usage,
    current: {
      workspace: (header && header.cwd) || '—',
      lastAction: latest ? (dshFeed(latest).at(-1)?.text||'暂无可读执行事件') : '暂无记录',
      session: latest ? latest.sid : '—',
    },
    config: {
      path: path.join(P.dshHome, 'profiles'),
      exists: profiles.length > 0,
      groups: [
        { title: 'Profile', items: profiles.length
          ? profiles.map((p) => ({ k: p.name, v: `${p.bundles.length} 包 · ${p.depCount} 依赖`, tone: p.name === 'delegate' ? 'good' : 'plain' }))
          : [{ k: '—', v: '无', tone: 'muted' }] },
        { title: '模型路由', items: [
          { k: 'delegate', v: delegate ? `${delegate.provider} / ${delegate.model}` : '未创建', tone: delegate ? 'good' : 'warn' },
          { k: 'desktop', v: desktop ? `${desktop.provider} / ${desktop.model}` : '未创建' },
        ] },
        { title: '凭据与桥接', items: [
          { k: '引用', v: refs.length ? refs.slice(0, 5).join('、') + (refs.length > 5 ? '…' : '') : '无' },
          { k: 'dsh-bridge', v: exists(P.dshBridge) ? '已部署' : '未部署', tone: exists(P.dshBridge) ? 'good' : 'muted' },
          ...(dangling ? [{ k: '注意', v: dangling, tone: 'warn' }] : []),
        ] },
      ],
    },
    feed: sessions.slice(0,5).flatMap(s=>dshFeed(s)).sort((a,b)=>a.ts-b.ts).slice(-60),
  };
}

/* ================================================================== *
 * 快照
 * ================================================================== */

function collectBridges() {
  const cfg = safe(() => parseToml(fs.readFileSync(path.join(P.codexHome, 'config.toml'), 'utf8')), {});
  const mcp = cfg.mcp_servers || {};
  const rows = [];
  if (mcp.workbuddy) rows.push({ from: 'Codex', to: 'WorkBuddy', server: 'workbuddy', ok: mcp.workbuddy.enabled !== false });
  if (mcp.dsh) rows.push({ from: 'Codex', to: 'dsh', server: 'dsh', ok: mcp.dsh.enabled !== false });
  const dshPatch = safe(() => fs.readFileSync(path.join(P.dshHome, 'profiles', 'desktop', 'cordis.patch.yml'), 'utf8'), '');
  if (/mcp-workbuddy/.test(dshPatch)) rows.push({ from: 'dsh', to: 'WorkBuddy', server: 'mcp-workbuddy', ok: true });
  return rows;
}

let stateCache = { at: 0, data: null };

function buildState(force = false) {
  if (!force && stateCache.data && now() - stateCache.at < 1200) return stateCache.data;

  const results = [];
  for (const fn of [collectCodex, collectWorkBuddy, collectDsh]) {
    try {
      results.push(fn());
    } catch (e) {
      results.push({
        id: fn.name.replace('collect', '').toLowerCase(),
        name: fn.name.replace('collect', ''),
        error: String(e && e.message ? e.message : e),
        procs: { running: false, count: 0, memText: '—' },
        metrics: [],
        quota: null,
        config: { groups: [] },
        feed: [],
      });
    }
  }

  const feed = results
    .flatMap((a) => [...(a.feed || [])].sort((x,y)=>y.ts-x.ts).slice(0,60))
    .filter((f) => f.ts)
    .sort((a, b) => b.ts - a.ts)
    .slice(0, 180);

  const data = {
    ts: now(),
    host: os.hostname(),
    platform: `${os.type()} ${os.release()}`,
    clock: new Date().toLocaleTimeString('zh-CN', { hour12: false }),
    summary: {
      running: results.filter((a) => a.procs && a.procs.running).length,
      busy: results.filter((a) => a.busy).length,
      memKB: results.reduce((s, a) => s + ((a.procs && a.procs.memKB) || 0), 0),
    },
    agents: results,
    bridges: collectBridges(),
    feed,
  };
  stateCache = { at: now(), data };
  return data;
}

/* ================================================================== *
 * 增量尾部
 * ================================================================== */

const tailState = new Map();

function tailFile(key, file, lineToItem, source) {
  if (!file) return [];
  const st = safe(() => fs.statSync(file));
  if (!st) return [];

  const prev = tailState.get(key);
  let from;
  if (!prev || prev.file !== file || st.size < prev.offset) {
    from = Math.max(0, st.size - 120_000); // 建基线：不重推历史
  } else {
    if (st.size === prev.offset) return [];
    from = prev.offset;
  }

  const text = safe(() => readFrom(file, from), '');
  if (!text) return [];

  const lastNl = text.lastIndexOf('\n');
  if (lastNl < 0) {
    tailState.set(key, { file, offset: from });
    return [];
  }
  const usable = text.slice(0, lastNl);
  tailState.set(key, { file, offset: from + Buffer.byteLength(usable, 'utf8') + 1 });

  const items = [];
  for (const line of usable.split(/\r?\n/)) {
    const it = lineToItem(line);
    if (it) items.push({ ...it, id: `${source}:${hash(line)}`, source });
  }
  return items;
}

/* ================================================================== *
 * SSE
 * ================================================================== */

const clients = new Set();

function broadcast(event, data) {
  for (const res of clients) {
    try {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    } catch {
      clients.delete(res);
    }
  }
}

/* ================================================================== *
 * Codex 对话执行
 * ================================================================== */

function resolveCodex() {
  if (process.env.CODEX_BIN && exists(process.env.CODEX_BIN)) return process.env.CODEX_BIN;
  const base = path.join(HOME, 'AppData', 'Local', 'OpenAI', 'Codex', 'bin');
  for (const dir of listDir(base)) {
    const p = path.join(base, dir, 'codex.exe');
    if (exists(p)) return p;
  }
  return null;
}

let activeRun = null;

const IMG_RE = /\.(png|jpe?g|webp|gif)$/i;

/** WorkBuddy 内置 CLI 对代理变量敏感（setProxy 会崩），必须白名单式清理 */
/** 杀掉整棵进程树：Windows 上 CLI 会再派生子进程，只 kill 父进程会留下孤儿 */
function killTree(child) {
  if (!child || child.exitCode !== null) return;
  try {
    if (process.platform === 'win32' && child.pid) {
      execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true });
      return;
    }
  } catch {
    /* 退回到普通 kill */
  }
  safe(() => child.kill());
}

function wbEnv() {
  const env = {};
  const DROP = /^(CODEBUDDY_|ACC_PRODUCT_|WORKBUDDY_|HTTP_PROXY|HTTPS_PROXY|http_proxy|https_proxy|ALL_PROXY|all_proxy|NO_PROXY|no_proxy)$/i;
  for (const [k, v] of Object.entries(process.env)) {
    if (v === undefined || DROP.test(k)) continue;
    env[k] = v;
  }
  env.CODEBUDDY_CONFIG_DIR = P.wbHome;
  env.CODEBUDDY_NODE_BIN = process.execPath;
  // 本机只有 lite 产物，强制用它，避免 CLI 去找独立安装
  env.CODEBUDDY_FORCE_LITE_WB_BUNDLE = '1';
  return env;
}

function dshDelegateTarget() {
  const def = dshProfiles().find((p) => p.name === 'delegate');
  return {
    provider: (def && def.provider) || 'qoder-cn',
    model: (def && def.model) || 'DeepSeek-Flash',
  };
}

/* ================================================================== *
 * 探测
 * ================================================================== */

const probes = new Map();

function probe(id) {
  const last = probes.get(id);
  if (last && now() - last.at < 60_000) return { ...last.result, cached: true };
  let result;
  try {
    if (id === 'workbuddy') {
      const out = execFileSync(process.execPath, [path.join(P.wbBridge, 'cli.mjs'), '--version'], {
        encoding: 'utf8',
        windowsHide: true,
        timeout: 60_000,
      });
      const v = (out.match(/\d+\.\d+\.\d+/) || [])[0] || out.trim();
      result = { ok: true, detail: `内置 CLI ${v} 可执行` };
    } else if (id === 'dsh') {
      const exe = 'D:\\dsh\\DeepSeek Harness.exe';
      const cli = 'D:\\dsh\\resources\\app.asar\\dsh\\node_modules\\@deepseek-ai\\dsh-desktop-host\\lib\\cli.js';
      const out = execFileSync(exe, ['--expose-internals', cli, '-V'], {
        encoding: 'utf8',
        windowsHide: true,
        timeout: 60_000,
        env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
      });
      result = { ok: true, detail: `dsh ${out.trim().split(/\r?\n/).pop()}` };
    } else {
      const bin = resolveCodex();
      if (!bin) throw new Error('找不到 codex.exe');
      const out = execFileSync(bin, ['--version'], { encoding: 'utf8', windowsHide: true, timeout: 45_000 });
      result = { ok: true, detail: out.trim().split(/\r?\n/).pop() };
    }
  } catch (e) {
    result = { ok: false, detail: short(e.message, 200) };
  }
  probes.set(id, { at: now(), result });
  return result;
}

/* ================================================================== *
 * 项目（左侧边栏）
 * ================================================================== */

/* ================================================================== *
 * 单条会话的正文回放
 * ================================================================== */

let SESSION_INDEX = new Map();
let SESSION_INDEX_AT = 0;

function sessionIndex() {
  // 缓存 10 秒：此前只建一次，新发消息生成的 rollout 永远进不了索引，
  // 点左侧新会话就会「找不到这条会话」
  if (!SESSION_INDEX.size || Date.now() - SESSION_INDEX_AT > 10_000) {
    const next = new Map();
    for (const s of collectSessions()) next.set(s.id, s);
    SESSION_INDEX = next;
    SESSION_INDEX_AT = Date.now();
  }
  return SESSION_INDEX;
}

function parseJsonLines(text) {
  const out = [];
  for (const line of String(text).split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      out.push(JSON.parse(line));
    } catch {
      /* 半行截断，跳过 */
    }
  }
  return out;
}

async function* sessionRecords(file) {
  const source = fs.createReadStream(file);
  const input = file.endsWith('.zst') ? source.pipe(zlib.createZstdDecompress()) : source;
  if (input !== source) source.on('error', (error) => input.destroy(error));
  input.setEncoding('utf8');
  const lines = createInterface({ input, crlfDelay: Infinity });
  try {
    for await (const line of lines) {
      if (!line.trim()) continue;
      try { yield JSON.parse(line); } catch { /* 忽略正在写入的半条记录 */ }
    }
  } finally { lines.close(); input.destroy(); source.destroy(); }
}

async function codexMessages(file, limit) {

  const collect = async (records) => {
    const items = [];
    for await (const j of records) {
      const ts = Date.parse(j.timestamp) || 0;
      // token_count：回合级用量（暂存，稍后合并进前面最近的 assistant 消息）
      if (j.type === 'event_msg' && j.payload && j.payload.type === 'token_count') {
        const u = j.payload.info && (j.payload.info.total_token_usage || j.payload.info.last_token_usage);
        if (u && (u.input_tokens || u.output_tokens)) {
          items.push({ ts, role: 'usage', input: u.input_tokens || 0, output: u.output_tokens || 0, cached: u.cached_input_tokens || 0 });
        }
        continue;
      }
      const it = codexLineToItem(JSON.stringify(j), true);
      if (!it) continue;
      if (it.kind === 'ask') {
        const ask = extractAsk(it.text);
        if (!ask.trim() || SYS_MSG.test(ask)) continue;
        items.push({ role: 'user', text: ask, ts, attachments: it.atts });
      } else if (it.kind === 'done') {
        items.push({ role: 'assistant', text: it.text, ts });
      } else {
        items.push({ role: 'tool', text: it.text, meta: it.meta, files: it.files, file: it.file || filePathOf(it.metaRaw ?? it.meta), ts });
      }
    }
    // 用量行合并进前面最近的 assistant（作为消息底部小字，不独立成行 ——
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
  };

  return collect(sessionRecords(file));
}

async function wbMessages(file, limit) {

  const collect = async (records) => {
    const items = [];
    for await (const j of records) {
      const ts = typeof j.timestamp === 'number' ? j.timestamp : Date.parse(j.timestamp) || 0;
      const it = wbLineToItem(JSON.stringify(j), true);
      if (!it) continue;
      if (it.kind === 'ask') {
        const ask = extractAsk(it.text);
        if (!ask.trim() || SYS_MSG.test(ask)) continue;
        items.push({ role: 'user', text: ask, ts });
      } else if (it.kind === 'done') {
        items.push({ role: 'assistant', text: it.text, ts });
      } else {
        items.push({ role: 'tool', text: it.text, meta: it.meta, file: it.file || '', ts });
      }
    }
    const out = [];
    for (const it of items) {
      const prev = out[out.length - 1];
      if (prev && prev.role === it.role && prev.text === it.text && prev.role !== 'tool') continue;
      out.push(it);
    }
    return out;
  };

  return collect(sessionRecords(file));
}

function dshMessages(file, limit) {
  const items=[],seen=new Set();
  for(const record of parseJsonLines(dshSessionLines(file,Infinity).join('\n'))){
    for(const item of dshRecordItems(record)){
      if(item.role==='status')continue;
      if(item.role==='user'){item.text=extractAsk(item.text);if(!item.text.trim()||SYS_MSG.test(item.text))continue;}
      const key=item.id+':'+item.role;if(item.id&&seen.has(key))continue;if(item.id)seen.add(key);
      if(item.arguments)item.file=filePathOf(item.arguments);
      items.push(item);
    }
  }
  return items;
}

const DETAIL_CACHE = new Map();
async function sessionDetail(id) {
  const session = sessionIndex().get(id);
  if (!session) throw new Error('找不到这条会话，刷新列表再来');
  const stat = fs.statSync(session.file);
  const fingerprint = `${stat.mtimeMs}:${stat.size}`;
  const hit = DETAIL_CACHE.get(id);
  if (hit?.fingerprint === fingerprint) return hit.promise;
  const promise = buildSessionDetail(id);
  DETAIL_CACHE.set(id, { fingerprint, promise });
  while (DETAIL_CACHE.size > 3) DETAIL_CACHE.delete(DETAIL_CACHE.keys().next().value);
  try { return await promise; } catch (error) { if (DETAIL_CACHE.get(id)?.promise === promise) DETAIL_CACHE.delete(id); throw error; }
}

async function buildSessionDetail(id) {
  const s = sessionIndex().get(id);
  if (!s) throw new Error('找不到这条会话，可能已被清理，刷新列表再来');
  const limit = Infinity;
  const messages =
    await (s.agent === 'codex' ? codexMessages(s.file, limit) : s.agent === 'workbuddy' ? wbMessages(s.file, limit) : dshMessages(s.file, limit));
  const meta = { size: fileSize(s.file), omitted: 0 };
  // 产物文件：工具调用里出现过的绝对路径（Write/Edit 等按出现顺序聚合）
  const files = [];
  const seen = new Set();
  for (const m of messages) {
    if (m.role !== 'tool') continue;
    for (const f of [m.file, ...(m.files || [])].filter(Boolean)) {
      const full = path.resolve(s.cwd || HERE, f);
      if (seen.has(pathKey(full))) continue;
      seen.add(pathKey(full)); files.push(full);
    }
  }
  return {
    id,
    agent: s.agent,
    title: s.title || '',
    cwd: s.cwd || '',
    ts: s.ts,
    file: s.file,
    size: meta.size,
    truncated: s.agent === 'dsh' ? false : meta.omitted > 0,
    omitted: s.agent === 'dsh' ? 0 : meta.omitted,
    count: messages.length,
    messages,
    files,
  };
}

const GIT_REPO_CACHE = new Map();
const PROJECT_CACHE = { at: 0, data: null };

function isRepoCached(root) {
  const hit = GIT_REPO_CACHE.get(root);
  if (hit && now() - hit.at < 10 * 60_000) return hit.v;
  const v = safe(() => {
    let dir = path.resolve(root);
    while (true) {
      if (exists(path.join(dir, '.git'))) return true;
      const parent = path.dirname(dir);
      if (parent === dir) return false;
      dir = parent;
    }
  }, false);
  GIT_REPO_CACHE.set(root, { at: now(), v });
  return v;
}

function invalidateProjects() {
  PROJECT_CACHE.at = 0;
  PROJECT_CACHE.data = null;
  SESSION_INDEX = new Map();
}

const AGENT_META = [
  { id: 'codex', name: 'Codex', hue: 265, hint: 'rollout · session_meta' },
  { id: 'workbuddy', name: 'WorkBuddy', hue: 45, hint: 'projects/<slug>' },
  { id: 'dsh', name: 'DSH', hue: 175, hint: 'sessions/*' },
];

/** 三层结构：代理 → 该代理的项目 → 项目内的会话（同一目录在三个代理下各算一份） */
function projectsByAgent() {
  const state = readConsoleState();
  const JUNK = /(?:\\AppData\\Local\\Temp\\|__workbuddy_cli_host__|\\codex-probe$|^__)/i;

  const usable = (cwd) => {
    if (!cwd || cwd === '—') return false;
    if (JUNK.test(cwd) || JUNK.test(path.basename(cwd))) return false;
    const ownTools=pathKey(path.resolve(HERE,'../../../tools'))+path.sep;
    if(pathKey(cwd).startsWith(ownTools)&&/^\.(native-(probe|smoke|service-)|qa-workbench|workbench-tests|permission-tests)/i.test(path.relative(path.resolve(HERE,'../../../tools'),cwd)))return false;
    if (/[\\/]\.(dsh|codex|workbuddy|codebuddy)[\\/]/i.test(cwd + path.sep)) return false;
    return path.isAbsolute(cwd) && !state.hiddenProjects.some((p) => samePath(p, cwd));
  };

  const label = (dir) => {
    const lower = dir.toLowerCase();
    if (lower === HOME.toLowerCase()) return '~ 家目录';
    if (lower.startsWith(HOME.toLowerCase() + path.sep)) return '~' + dir.slice(HOME.length);
    return dir;
  };

  const buckets = new Map(AGENT_META.map((a) => [a.id, new Map()]));

  for (const s of collectSessions()) {
    if (!usable(s.cwd)) continue;
    const bucket = buckets.get(s.agent);
    if (!bucket) continue;
    const key = pathKey(s.cwd);
    const cur = bucket.get(key) || { path: s.cwd, sessions: [], mtime: 0 };
    cur.sessions.push({
      id: s.id,
      agent: s.agent,
      title: state.aliases?.sessions?.[s.id] || (s.title ? short(s.title, 46) : `会话 ${String(s.id).split(':').pop().slice(-6)}`),
      ts: s.ts,
      busy:!!s.busy,
      archived: s.id in state.archived ? !!state.archived[s.id] : !!s.nativeArchived || s.file.includes(path.sep + 'archived_sessions' + path.sep),
      pinned: state.pinnedSessions.includes(s.id),
    });
    cur.mtime = Math.max(cur.mtime, s.ts);
    bucket.set(key, cur);
  }

  for (const pinned of state.pinned) {
    if (!usable(pinned)) continue;
    const key = pathKey(pinned);
    const owners=state.projectAgents[key]||['workbuddy'];
    for(const owner of owners){const bucket=buckets.get(owner);if(bucket&&!bucket.has(key))bucket.set(key,{path:pinned,sessions:[],mtime:mtime(pinned)});}
  }

  for (const root of readDatabase(path.join(P.codexHome, 'state_5.sqlite'),
    'SELECT p.name, r.path FROM projects p JOIN project_roots r ON p.id = r.project_id')) {
    const cwd = path.normalize(cleanPath(root.path));
    if (!usable(cwd)) continue;
    const bucket = buckets.get('codex'); const key = pathKey(cwd);
    const item = bucket.get(key) || { path: cwd, sessions: [], mtime: 0 };
    item.nativeName = root.name; item.explicit = true; bucket.set(key, item);
  }

  const agents = AGENT_META.map((meta) => {
    const bucket = buckets.get(meta.id) || new Map();
    const projects = [...bucket.values()]
      .map((v) => {
        const sessions = v.sessions.sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) || b.ts - a.ts);
        const active = sessions.filter((x) => !x.archived);
        return {
          agent: meta.id,
          explicit: !!v.explicit,
          path: v.path,
          name: state.aliases?.projects?.[v.path] || v.nativeName || (samePath(v.path, HOME) ? '家目录' : path.basename(v.path)) || v.path,
          group: path.dirname(v.path),
          groupLabel: label(path.dirname(v.path)),
          sessions,
          activeCount: active.length,
          archivedCount: sessions.length - active.length,
          sessionCount: sessions.length,
          mtime: v.mtime || 0,
          isRepo: isRepoCached(v.path),
        };
      })
      .filter((p) => p.activeCount > 0 || (p.sessionCount === 0 && (p.explicit || state.pinned.some((x) => samePath(x, p.path)))))
      .sort((a, b) => b.mtime - a.mtime);

    return {
      ...meta,
      projects,
      projectCount: projects.length,
      sessionCount: projects.reduce((n, p) => n + p.activeCount, 0),
    };
  });

  // 扁平列表：给"当前项目"之类的逻辑兜底
  const flat = [];
  const seen = new Set();
  for (const a of agents) {
    for (const p of a.projects) {
      const k = `${a.id}:${p.path.toLowerCase()}`;
      if (seen.has(k)) continue;
      seen.add(k);
      flat.push(p);
    }
  }

  return { agents, projects: flat, archived: archivedSessions(), hiddenProjects: [...new Set(state.hiddenProjects.map((p) => path.normalize(p)))] };
}

function projectCandidatesCached() {
  if (PROJECT_CACHE.data && now() - PROJECT_CACHE.at < 8000) return PROJECT_CACHE.data;
  const data = projectsByAgent();
  PROJECT_CACHE.at = now();
  PROJECT_CACHE.data = data;
  return data;
}

function archivedSessions() {
  const state = readConsoleState();
  const all = new Map(collectSessions().map((s) => [s.id, s]));
  const ids = [...new Set([...Object.keys(state.archived || {}), ...[...all.values()].filter((s) => (s.nativeArchived || s.file.includes(path.sep + 'archived_sessions' + path.sep))).map((s) => s.id)])].filter((id) => state.archived[id] !== false);
  return ids
    .map((id) => {
      const s = all.get(id);
      return s
        ? { id, agent: s.agent, title: s.title ? short(s.title, 60) : '', cwd: s.cwd, ts: s.ts, archivedAt: Number(state.archived[id]) > 1 ? state.archived[id] : s.ts }
        : { id, agent: 'unknown', title: '', cwd: '', ts: state.archived[id], archivedAt: state.archived[id], missing: true };
    })
    .sort((a, b) => b.archivedAt - a.archivedAt);
}

function gitOut(args, root) {
  try { return execFileSync('git', ['-C',root,...args], {encoding:'utf8',windowsHide:true,maxBuffer:16<<20}); }
  catch(error) { if(error.code==='ENOBUFS'||error.code==='ERR_CHILD_PROCESS_STDIO_MAXBUFFER'||/maxBuffer/.test(error.message))throw new Error('Git 差异超过 16 MiB 输出限制，请缩小查看范围；没有把截断结果作为完整差异展示。');return null; }
}

/* ---------------- 从会话里抠出"谁改了什么" ---------------- */

const EDIT_TOOLS = /^(write|edit|multiedit|strreplace|str_replace|notebookedit|apply_patch|applypatch)$/i;

function parseMaybeJson(v) {
  if (typeof v !== 'string') return v;
  try {
    return JSON.parse(v);
  } catch {
    return v;
  }
}

/** 统一 diff 的小工具：把 old/new 变成 hunk 文本 */
function diffFromOldNew(oldStr, newStr, file) {
  const a = String(oldStr || '').split(/\r?\n/);
  const b = String(newStr || '').split(/\r?\n/);
  const lines = [`--- a/${file}`, `+++ b/${file}`];
  const ctx = 2;
  let i = 0;
  let j = 0;
  // 粗暴但够用的公共前缀/后缀裁剪
  let pre = 0;
  while (pre < a.length && pre < b.length && a[pre] === b[pre]) pre++;
  let suf = 0;
  while (
    suf < a.length - pre &&
    suf < b.length - pre &&
    a[a.length - 1 - suf] === b[b.length - 1 - suf]
  )
    suf++;
  const startA = Math.max(0, pre - ctx);
  const oldMid = a.slice(startA, a.length - suf);
  const newMid = b.slice(startA, b.length - suf);
  lines.push(`@@ -${startA + 1},${oldMid.length} +${startA + 1},${newMid.length} @@`);
  for (const l of a.slice(startA, pre)) lines.push(' ' + l);
  for (const l of oldMid) lines.push('-' + l);
  for (const l of newMid) lines.push('+' + l);
  const tailCtx = a.slice(a.length - suf, a.length - suf + ctx);
  for (const l of tailCtx) lines.push(' ' + l);
  return lines.join('\n');
}

function diffFromContent(content, file) {
  const body = String(content || '').split(/\r?\n/);
  const lines = [`--- /dev/null`, `+++ b/${file}`, `@@ -0,0 +1,${body.length} @@`];
  for (const l of body) lines.push('+' + l);
  return lines.join('\n');
}

/** 从 apply_patch 文本里拆出每个文件的补丁段 */
function splitApplyPatch(patchText) {
  const out = [];
  const re = /^\*\*\* (Add|Update|Delete) File: (.+)$/gm;
  const marks = [...patchText.matchAll(re)];
  for (let i = 0; i < marks.length; i++) {
    const m = marks[i];
    const from = m.index;
    const to = i + 1 < marks.length ? marks[i + 1].index : patchText.length;
    const seg = patchText.slice(from, to).trim();
    const body = seg.split(/\r?\n/).slice(1).filter((l) => !/^\*\*\* End Patch/.test(l));
    const file = m[2].trim();
    const kind = m[1];
    out.push({ file, kind, patch: [`--- a/${file}`, `+++ b/${file}`, ...body].join('\n') });
  }
  return out;
}

function countDiff(patch) {
  let added = 0;
  let removed = 0;
  for (const l of String(patch).split(/\r?\n/)) {
    if (l.startsWith('+++') || l.startsWith('---')) continue;
    if (l.startsWith('+')) added++;
    else if (l.startsWith('-')) removed++;
  }
  return { added, removed };
}

let editCache = { at: 0, items: [] };

/** 扫 WorkBuddy + Codex 最近的编辑动作 → [{agent, ts, path, rel, patch}] */
function extractEdits() {
  if (now() - editCache.at < 15_000) return editCache.items;
  const items = [];

  // WorkBuddy：transcript 里的 Write / Edit 调用
  for (const slug of listDir(path.join(P.wbHome, 'projects'))) {
    const dir = path.join(P.wbHome, 'projects', slug);
    if (!isDir(dir)) continue;
    for (const f of listDir(dir)) {
      if (!f.endsWith('.jsonl')) continue;
      const full = path.join(dir, f);
      const mt = mtime(full);
      if (now() - mt > 2 * 86400_000) continue;
      const text = safe(() => readText(full, 3_000_000), '');
      for (const line of text.split(/\r?\n/)) {
        if (!line.includes('file_path')) continue;
        let j;
        try {
          j = JSON.parse(line);
        } catch {
          continue;
        }
        if (j.type !== 'function_call') continue;
        if (!EDIT_TOOLS.test(String(j.name || ''))) continue;
        const args = parseMaybeJson(j.arguments);
        if (!args || typeof args !== 'object') continue;
        const file = args.file_path || args.path;
        if (typeof file !== 'string') continue;
        const ts = typeof j.timestamp === 'number' ? j.timestamp : Date.parse(j.timestamp) || mt;
        let patch = '';
        if (typeof args.content === 'string') patch = diffFromContent(args.content, file);
        else if (typeof args.old_string === 'string' || typeof args.new_string === 'string')
          patch = diffFromOldNew(args.old_string, args.new_string, file);
        else if (typeof args.patch === 'string') patch = args.patch;
        if (!patch) continue;
        items.push({ agent: 'workbuddy', ts, path: file, tool: j.name, patch });
      }
    }
  }

  // Codex：rollout 里的 apply_patch
  for (const r of codexRollouts().slice(0, 6)) {
    if (now() - r.mtime > 2 * 86400_000) continue;
    const text = safe(() => readText(r.file, 2_000_000), '');
    for (const line of text.split(/\r?\n/)) {
      if (!line.includes('*** Begin Patch') && !line.includes('apply_patch')) continue;
      let j;
      try {
        j = JSON.parse(line);
      } catch {
        continue;
      }
      const raw = JSON.stringify(j);
      const idx = raw.indexOf('*** Begin Patch');
      if (idx < 0) continue;
      const patchText = safe(() => JSON.parse(JSON.stringify(j))) && null;
      // 直接在原文里截取补丁正文
      const s2 = raw.slice(idx).replace(/\\n/g, '\n').replace(/\\"/g, '"');
      const cut = s2.indexOf('*** End Patch');
      const body = cut > 0 ? s2.slice(0, cut) : s2;
      const ts = Date.parse(j.timestamp) || r.mtime;
      for (const piece of splitApplyPatch(body)) {
        items.push({ agent: 'codex', ts, path: piece.file, tool: 'apply_patch', patch: piece.patch });
      }
    }
  }

  items.sort((a, b) => b.ts - a.ts);
  editCache = { at: now(), items: items.slice(0, 300) };
  return editCache.items;
}

/** 归属：把一个文件的改动归到最近动过它的代理 */
function attribute(relPath, root) {
  const norm = (x) => x.replace(/\\/g, '/').toLowerCase();
  const target = norm(relPath);
  for (const e of extractEdits()) {
    const ep = norm(e.path);
    if (ep === target || ep.endsWith('/' + target) || target.endsWith('/' + ep)) {
      return { agent: e.agent, ts: e.ts, tool: e.tool, patch: e.patch };
    }
  }
  return null;
}

function collectChanges(root) {
  if (!root || !exists(root)) throw new Error('项目路径不存在');
  const isRepo = (gitOut(['rev-parse', '--is-inside-work-tree'], root) || '').trim() === 'true';
  const branch = isRepo ? (gitOut(['rev-parse', '--abbrev-ref', 'HEAD'], root) || '').trim() : '';
  const files = [];

  if (isRepo) {
    const st = gitOut(['status', '--porcelain=v1', '-z'], root) || '';
    for (const chunk of st.split('\0')) {
      if (!chunk || chunk.length < 4) continue;
      const xy = chunk.slice(0, 2);
      const rel = chunk.slice(3).trim();
      if (!rel) continue;
      const status = xy.includes('?') ? 'added' : xy.includes('D') ? 'deleted' : xy.trim() ? 'modified' : 'clean';
      let patch = '';
      if (status === 'added') {
        const full = path.join(root, rel);
        const content = fileSize(full) <= (2 << 20) ? safe(() => fs.readFileSync(full, 'utf8'), '') : '';
        patch = content ? diffFromContent(content, rel) : '';
      } else {
        patch =
          gitOut(['diff', '--no-color', '-U3', '--', rel], root) ||
          gitOut(['diff', '--cached', '--no-color', '-U3', '--', rel], root) ||
          '';
      }
      const { added, removed } = countDiff(patch);
      const attr = attribute(rel, root);
      files.push({
        path: rel,
        status,
        added,
        removed,
        patch,
        agent: attr ? attr.agent : 'unknown',
        tool: attr ? attr.tool : '',
        ts: attr ? attr.ts : mtime(path.join(root, rel)),
      });
    }
  } else {
    // 非 git 仓库：只能靠会话里的编辑动作
    const norm = (x) => x.replace(/\\/g, '/').toLowerCase();
    const rootNorm = norm(root) + '/';
    const seen = new Map();
    for (const e of extractEdits()) {
      const ep = norm(e.path);
      if (!ep.startsWith(rootNorm)) continue;
      const rel = e.path.slice(root.length + 1);
      const cur = seen.get(rel);
      if (!cur || e.ts > cur.ts) seen.set(rel, { ...e, rel });
    }
    for (const v of seen.values()) {
      // 补丁里把绝对路径削成项目内相对路径，读起来才像 diff
      const relPatch = String(v.patch || '').split(root).join('').split(root.replace(/\\/g, '/')).join('');
      v.patch = relPatch.replace(/^b\/+/gm, 'b/');
      const { added, removed } = countDiff(v.patch);
      files.push({
        path: v.rel,
        status: 'modified',
        added,
        removed,
        patch: v.patch,
        agent: v.agent,
        tool: v.tool,
        ts: v.ts,
      });
    }
    files.sort((a, b) => b.ts - a.ts);
  }

  const byAgent = {};
  for (const f of files) {
    byAgent[f.agent] = byAgent[f.agent] || { files: 0, added: 0, removed: 0 };
    byAgent[f.agent].files++;
    byAgent[f.agent].added += f.added;
    byAgent[f.agent].removed += f.removed;
  }

  return {
    root,
    isRepo,
    branch,
    files,
    byAgent,
    summary: {
      files: files.length,
      added: files.reduce((a, f) => a + f.added, 0),
      removed: files.reduce((a, f) => a + f.removed, 0),
    },
  };
}

/* ---------------- 模型清单 ---------------- */

const WB_MODELS = [
  { id: 'deepseek-v4.1-flash', name: 'DeepSeek V4.1 Flash' },
  { id: 'deepseek-v4-pro', name: 'DeepSeek V4 Pro' },
  { id: 'glm-5.3', name: 'GLM-5.3' },
  { id: 'glm-5.3-flash', name: 'GLM-5.3 Flash' },
  { id: 'kimi-k3.1-pro', name: 'Kimi K3.1 Pro' },
  { id: 'minimax-m3', name: 'MiniMax M3' },
  { id: 'mimo-v2.6-pro', name: 'MiMo v2.6 Pro' },
];

const EFFORTS = {
  codex: [
    // minimal 已移除：现役模型 gpt-6.1-sol 不支持（400 unsupported_value），
    // 留在下拉里只会让人踩坑。localStorage 里的旧值会由前端 pick 逻辑自动落到「中」。
    { id: 'low', name: '低' },
    { id: 'medium', name: '中' },
    { id: 'high', name: '高' },
    { id: 'xhigh', name: '极高' },
  ],
  workbuddy: [
    { id: 'minimal', name: '极简' },
    { id: 'low', name: '低' },
    { id: 'medium', name: '中' },
    { id: 'high', name: '高' },
    { id: 'xhigh', name: '极高' },
    { id: 'max', name: '最高' },
  ],
  // dsh 的档位由模型能力决定，DeepSeek-Flash 实测 low/medium/high 可用
  dsh: [
    { id: 'low', name: '低' },
    { id: 'medium', name: '中' },
    { id: 'high', name: '高' },
  ],
};

function effortsFor(agent) {
  return EFFORTS[agent] || EFFORTS.codex;
}

function modelsFor(agent) {
  if (agent === 'workbuddy') return WB_MODELS;
  if (agent === 'dsh') {
    const cat = safe(
      () => JSON.parse(fs.readFileSync(path.join(P.dshHome, '.qoder-catalog.qoder-cn.json'), 'utf8')),
      null,
    );
    const list = (cat && cat.entries ? cat.entries : [])
      .filter((e) => typeof e.id === 'string' && e.id)
      .map((e) => ({ id: e.id, name: e.name || e.id }));
    const def = dshProfiles().find((x) => x.name === 'delegate');
    if (def) {
      if (!list.some((m) => m.id === def.model)) list.unshift({ id: def.model, name: def.model + '（当前）' });
    }
    return list.length ? list : [{ id: 'DeepSeek-Flash', name: 'DeepSeek-Flash' }];
  }
  const cfg = safe(() => parseToml(fs.readFileSync(path.join(P.codexHome, 'config.toml'), 'utf8')), {});
  const cache = safe(() => JSON.parse(fs.readFileSync(path.join(P.codexHome, 'models_cache.json'), 'utf8')), null);
  const out = [];
  const push = (id, name) => {
    if (id && !out.some((m) => m.id === id)) out.push({ id, name: name || id });
  };
  push(cfg.model, cfg.model ? `${cfg.model}（当前）` : null);
  const arr = Array.isArray(cache) ? cache : cache && Array.isArray(cache.models) ? cache.models : [];
  for (const m of arr) {
    const id = m.slug || m.id || m.model;
    if (id) push(id, m.display_name || m.name || id);
  }
  return out.length ? out : [{ id: 'gpt-6.1-sol', name: 'gpt-6.1-sol' }];
}

/* ================================================================== *
 * HTTP
 * ================================================================== */

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8',
};

function sendJson(res, code, obj) {
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(obj));
}

function readBody(req) {
  return new Promise((resolve) => {
    let b = '';
    req.on('data', (c) => (b += c));
    req.on('end', () => {
      try {
        resolve(JSON.parse(b || '{}'));
      } catch {
        resolve({});
      }
    });
  });
}

const server = http.createServer(async (req, res) => {
  try {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
  const allowedHosts = new Set([`127.0.0.1:${PORT}`, `localhost:${PORT}`]);
  if (!allowedHosts.has(req.headers.host)) return sendJson(res, 403, { error: '只接受本机工作台请求' });
  if (req.headers.origin && ![`http://127.0.0.1:${PORT}`, `http://localhost:${PORT}`].includes(req.headers.origin))
    return sendJson(res, 403, { error: '请求不是来自当前工作台' });

  if(url.pathname==='/api/mcp/manage'&&req.method==='POST') {
    if(![`http://127.0.0.1:${PORT}`,`http://localhost:${PORT}`].includes(req.headers.origin))return sendJson(res,403,{error:'需要从设置操作'});
    return sendJson(res,200,await manageMcp((await readBody(req)).action));
  }
  if(url.pathname==='/api/ui/poll'&&req.method==='POST') {
    if(![`http://127.0.0.1:${PORT}`,`http://localhost:${PORT}`].includes(req.headers.origin))return sendJson(res,403,{error:'界面连接需要同源请求'});
    let text='';for await(const chunk of req){text+=chunk;if(text.length>8*1024*1024)return sendJson(res,413,{error:'界面状态过大'});}
    return sendJson(res,200,{command:uiControl.poll(JSON.parse(text||'{}'))});
  }
  if(url.pathname.startsWith('/api/automation/')) {
    if(!uiControl.authorized(req))return sendJson(res,401,{error:'MCP 凭证无效'});
    if(url.pathname==='/api/automation/windows'&&req.method==='GET')return sendJson(res,200,{windows:uiControl.list()});
    if(url.pathname==='/api/automation/command'&&req.method==='POST')return sendJson(res,200,await uiControl.command(await readBody(req)));
    return sendJson(res,404,{error:'未知控制接口'});
  }

  if (url.pathname.startsWith('/api/workbench/')) {
    await workbench.proxy(req, res, url.pathname.replace('/api/workbench', '') + url.search); return;
  }

  if (url.pathname === '/api/state') return sendJson(res, 200, buildState());

  // 身份接口：桌面壳靠它判断「端口上这个服务是不是当前这份代码起的」
  if (url.pathname === '/api/identify') {
    return sendJson(res, 200, {
      pid: process.pid,
      parentPid: PARENT_PID,
      port: PORT,
      appDir: HERE,
      revision: SERVER_REVISION,
      automationVersion: 1,
      startedAt: IDENTITY_STARTED,
      bridges: { wb: P.wbBridge, dsh: P.dshBridge },
    });
  }

  if (url.pathname === '/api/stream') {
    res.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    });
    res.write('retry: 2000\n\n');
    clients.add(res);
    res.write(`event: state\ndata: ${JSON.stringify(buildState())}\n\n`);
    if (activeRun) res.write(`event: run\ndata: ${JSON.stringify({ runId: activeRun.runId, status: 'thinking', resumed: true })}\n\n`);
    req.on('close', () => clients.delete(res));
    return;
  }

  if (url.pathname === '/api/chat' && req.method === 'POST') {
    return sendJson(res, 409, { error: '工作台已升级，请刷新页面后在工作会话中发送。' });
  }
  if (url.pathname === '/api/chat/stop' && req.method === 'POST') {
    const body = await readBody(req); return sendJson(res, 200, await workbench.request('/stop', 'POST', { taskId: body.runId }));
  }

  if (url.pathname === '/api/projects') {
    if (req.method === 'POST') {
      const body = await readBody(req);
      const target = typeof body.path === 'string' ? body.path.trim() : '';
      if (!target) return sendJson(res, 400, { error: 'path 不能为空' });
      try {
        if (!exists(target)) fs.mkdirSync(target, { recursive: true });
        const state = readConsoleState();
        state.hiddenProjects = state.hiddenProjects.filter((p) => !samePath(p, target));
        if (!state.pinned.some((x) => x.toLowerCase() === target.toLowerCase())) {
          state.pinned.push(target);
          writeConsoleState(state);
          invalidateProjects();
        }
        const key=pathKey(target);const owner=['codex','workbuddy','dsh'].includes(body.agent)?body.agent:'workbuddy';state.projectAgents[key]=[...new Set([...(state.projectAgents[key]||[]),owner])];
        writeConsoleState(state);invalidateProjects();
        return sendJson(res, 200, { ok: true, path: target, created: true });
      } catch (e) {
        return sendJson(res, 500, { error: String(e.message || e) });
      }
    }
    try {
      return sendJson(res, 200, projectCandidatesCached());
    } catch (e) {
      return sendJson(res, 500, { error: String(e.message || e) });
    }
  }

  if (url.pathname === '/api/session') {
    try {
      return sendJson(res, 200, await sessionDetail(url.searchParams.get('id') || ''));
    } catch (e) {
      return sendJson(res, 404, { error: String(e.message || e) });
    }
  }

  if (url.pathname === '/api/history-search') {
    const query=(url.searchParams.get('q')||'').trim().toLowerCase();
    if(!query)return sendJson(res,400,{error:'请先输入搜索内容'});
    res.writeHead(200,{'content-type':'text/event-stream','cache-control':'no-store','connection':'keep-alive'});
    let cancelled=false;res.on('close',()=>cancelled=true);
    const sessions=collectSessions();let scanned=0,hits=0;
    const push=(event,value)=>{if(!cancelled)res.write(`event: ${event}\ndata: ${JSON.stringify(value)}\n\n`);};
    for(const session of sessions){
      if(cancelled)break;
      let snippet='';
      try {
        if(session.agent==='dsh') {
          for(const line of dshSessionLines(session.file,Infinity)){
            let j;try{j=JSON.parse(line);}catch{continue;}
            const blocks=j.type==='user/message'?j.data?.content:j.type==='assistant/message'?j.data?.message?.content:null;
            const text=contentBlocks(blocks).filter(b=>b.type!=='reasoning').map(b=>b.text||'').join('\n');
            const index=text.toLowerCase().indexOf(query);if(index>=0){snippet=text.slice(Math.max(0,index-50),index+170);break;}
          }
        } else {
          for await(const j of sessionRecords(session.file)) {
            if(cancelled)break;
            const item=session.agent==='codex'?codexLineToItem(JSON.stringify(j),true):wbLineToItem(JSON.stringify(j),true);
            if(!item||!['ask','done'].includes(item.kind))continue;
            const index=item.text.toLowerCase().indexOf(query);if(index>=0){snippet=item.text.slice(Math.max(0,index-50),index+170);break;}
          }
        }
        if(snippet){hits++;push('hit',{id:session.id,agent:session.agent,cwd:session.cwd,title:short(session.title||'历史会话',70),snippet});}
      }catch(error){push('source-error',{id:session.id,error:error.message});}
      scanned++;push('progress',{scanned,total:sessions.length,hits});
      await new Promise(resolve=>setTimeout(resolve,0));
    }
    push('done',{scanned,total:sessions.length,hits,cancelled});res.end();return;
  }

  if (url.pathname === '/api/changes') {
    try {
      return sendJson(res, 200, collectChanges(url.searchParams.get('root') || ''));
    } catch (e) {
      return sendJson(res, 400, { error: String(e.message || e) });
    }
  }

  if (url.pathname === '/api/models') {
    const agent = url.searchParams.get('agent') || 'codex';
    return sendJson(res, 200, {
      agent,
      models: safe(() => modelsFor(agent), []),
      efforts: effortsFor(agent),
      modelEfforts: agent === 'dsh' ? Object.fromEntries(safe(() => JSON.parse(fs.readFileSync(path.join(P.dshHome,'.qoder-catalog.qoder-cn.json'),'utf8')).entries, []).map(entry => [entry.id, [{id:'',name:'模型默认'},...(entry.supportsEffort ? entry.effortLevels || [] : []).map(id=>({id,name:({low:'低',medium:'中',high:'高',xhigh:'极高',max:'最高'})[id]||id}))]])) : null,
    });
  }

  if (url.pathname === '/api/rename' && req.method === 'POST') {
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

  // 归档项目：把该项目下所有会话标记归档（Agent 侧文件不动）
  if (url.pathname === '/api/archive-project' && req.method === 'POST') {
    const body = await readBody(req);
    const p = String(body.path || '');
    if (!p) return sendJson(res, 400, { error: '缺少 path' });
    const st = readConsoleState();
    if (!st.archived || typeof st.archived !== 'object') st.archived = {};
    let count = 0;
    for (const s2 of collectSessions()) {
      if (samePath(s2.cwd, p) && (!body.agent || s2.agent === body.agent)) {
        st.archived[s2.id] = now();
        count++;
      }
    }
    const owned = await workbench.request('/project', 'POST', {path:p,agent:body.agent,archived:true});
    writeConsoleState(st);
    return sendJson(res, 200, { ok: true, archived: count + owned.count });
  }

  // 删除项目：真实递归删除目录（不可恢复，前端需双重确认）。
  // 安全校验：必须是绝对路径、至少两级深度、不落在一个保留名单里。
  if (url.pathname === '/api/delete-project' && req.method === 'POST') {
    const body = await readBody(req);
    if (!body.path || !path.isAbsolute(cleanPath(body.path))) return sendJson(res, 400, { error: '必须提供项目的绝对路径' });
    const target = path.resolve(cleanPath(body.path));
    if (!/^([a-zA-Z]:[\\/])/.test(target)) return sendJson(res, 400, { error: '路径非法' });
    const segs = target.split(/[\\/]+/).filter(Boolean);
    // 只拒绝盘根（如 D://）和一级目录；两级及以上的项目目录允许删
    if (segs.length < 2) return sendJson(res, 400, { error: '拒绝删除盘根或一级目录' });
    // 受保护目录：盘根、系统目录、用户目录本身。用户主目录按当前账户解析，不写死用户名。
    const BLOCK = ['c:\\', 'c:\\users', 'c:\\windows', 'c:\\program files', 'd:\\', HOME].filter(Boolean);
    if (BLOCK.includes(target.toLowerCase()) || BLOCK.some((b) => target.toLowerCase() === path.resolve(b).toLowerCase()))
      return sendJson(res, 400, { error: '拒绝删除受保护目录' });
    const protectedPaths = [HERE, path.resolve(HERE, '../../..'), HOME, P.codexHome, P.wbHome, P.dshHome,
      process.env.SystemRoot, process.env.ProgramFiles].filter(Boolean);
    const realTarget = exists(target) ? fs.realpathSync(target) : target;
    const contains = (parent, child) => samePath(parent, child) || pathKey(child).startsWith(pathKey(parent) + path.sep);
    if (protectedPaths.some((p) => contains(realTarget, p) || contains(p, realTarget) && !samePath(p, HOME)))
      return sendJson(res, 400, { error: '拒绝删除控制台、代理数据或系统目录；请使用「从列表移除」' });
    const existed = exists(target);
    if (existed) {
      if (fs.lstatSync(target).isSymbolicLink()) return sendJson(res, 400, { error: '项目是目录链接，请使用「从列表移除」' });
      fs.rmSync(realTarget, { recursive: true, force: true });
    }
    // 同步从控制台的列表里移除
    const st = readConsoleState();
    if (Array.isArray(st.hiddenProjects)) st.hiddenProjects.push(target);
    st.pinned = (st.pinned || []).filter((x) => x.toLowerCase() !== target.toLowerCase());
    writeConsoleState(st);
    return sendJson(res, 200, { ok: true, removedDirectory: existed });
  }

  if (url.pathname === '/api/sessions/pin' && req.method === 'POST') {
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

  if (url.pathname === '/api/hide-project' && req.method === 'POST') {
    const body = await readBody(req);
    const p = String(body.path || '');
    if (!p) return sendJson(res, 400, { error: '缺少 path' });
    const st = readConsoleState();
    if (!Array.isArray(st.hiddenProjects)) st.hiddenProjects = [];
    st.hiddenProjects = st.hiddenProjects.filter((x) => !samePath(x, p));
    if (body.hidden !== false) st.hiddenProjects.push(path.normalize(p));
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
      const base = path.basename(file).replace(/\.jsonl(?:\.zst)?$/, '');
      for (const f of safe(() => fs.readdirSync(dir), [])) {
        if (f.startsWith(base)) {
          fs.rmSync(path.join(dir, f), { force: true });
          removed++;
        }
      }
    } else {
      fs.rmSync(file, { force: true });
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

  if (url.pathname === '/api/sessions/archive' && req.method === 'POST') {
    const body = await readBody(req);
    const id = typeof body.id === 'string' ? body.id.trim() : '';
    if (!id) return sendJson(res, 400, { error: 'id 不能为空' });
    const state = readConsoleState();
    if (body.archived === false) {
      state.archived[id] = false;
      const session = sessionIndex().get(id);
      if (session) state.hiddenProjects = state.hiddenProjects.filter((p) => !samePath(p, session.cwd));
    }
    else state.archived[id] = now();
    writeConsoleState(state);
    invalidateProjects();
    return sendJson(res, 200, { ok: true, id, archived: body.archived !== false, archivedCount: Object.keys(state.archived).length });
  }

  // 回放图片：/uploads/<文件名> → .uploads 目录（仅允许纯文件名，防目录穿越）
  if (url.pathname.startsWith('/uploads/')) {
    const name = path.basename(decodeURIComponent(url.pathname.slice('/uploads/'.length)));
    const file = path.join(HERE, '.uploads', name);
    if (!fs.existsSync(file) || !path.dirname(file).endsWith('.uploads')) {
      res.writeHead(404).end('not found');
      return;
    }
    const MIME2 = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp' };
    res.writeHead(200, { 'content-type': MIME2[path.extname(file).toLowerCase()] || 'application/octet-stream', 'cache-control': 'no-store' });
    res.end(fs.readFileSync(file));
    return;
  }

  if (url.pathname === '/api/upload' && req.method === 'POST') {
    const body = await readBody(req);
    const raw = typeof body.dataUrl === 'string' ? body.dataUrl : '';
    const m = /^data:([^;]+);base64,([\s\S]+)$/.exec(raw);
    if (!m) return sendJson(res, 400, { error: '需要 dataUrl（base64）' });
    const buf = Buffer.from(m[2], 'base64');
    if (buf.length > 40 * 1024 * 1024) return sendJson(res, 413, { error: '文件超过 40MB' });
    const dir = path.join(HERE, '.uploads');
    fs.mkdirSync(dir, { recursive: true });
    const ext = path.extname(String(body.name || '')).slice(0, 12) || '.bin';
    const base = path.basename(String(body.name || 'file'), ext).replace(/[^\w.\-\u4e00-\u9fa5]+/g, '_').slice(0, 60) || 'file';
    const file = path.join(dir, `${Date.now().toString(36)}-${base}${ext}`);
    fs.writeFileSync(file, buf);
    return sendJson(res, 200, {
      ok: true,
      path: file,
      name: String(body.name || path.basename(file)),
      size: buf.length,
      mime: m[1],
      isImage: /^image\//.test(m[1]),
    });
  }

  if (url.pathname === '/api/probe' && req.method === 'POST') {
    const body = await readBody(req);
    if (!['codex', 'workbuddy', 'dsh'].includes(body.id)) return sendJson(res, 400, { error: 'unknown id' });
    return sendJson(res, 200, { id: body.id, ...probe(body.id) });
  }

  if (url.pathname === '/api/raw') {
    const map = {
      codex: path.join(P.codexHome, 'config.toml'),
      workbuddy: path.join(P.wbHome, 'settings.json'),
      dsh: path.join(P.dshHome, 'profiles', 'delegate', 'cordis.patch.yml'),
    };
    const p = map[url.searchParams.get('src')];
    if (!p) return sendJson(res, 400, { error: 'unknown src' });
    return sendJson(res, 200, { path: p, text: safe(() => readText(p, 40_000), '（无法读取）') });
  }

  let rel = url.pathname === '/' ? 'index.html' : url.pathname.replace(/^\/+/, '');
  if (rel.endsWith('/')) rel += 'index.html';
  const file = path.join(PUBLIC_DIR, path.normalize(rel).replace(/^(\.\.[/\\])+/, ''));
  if (!file.startsWith(PUBLIC_DIR)) {
    res.writeHead(403).end('forbidden');
    return;
  }
  fs.readFile(file, (err, buf) => {
    if (err) {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('not found');
      return;
    }
    res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' });
    res.end(buf);
  });
  } catch (error) {
    if (!res.headersSent) sendJson(res, 500, { error: error.message || String(error) });
    else res.end();
  }
});

setInterval(() => {
  if (!clients.size) return;
  try {
    broadcast('state', buildState());
  } catch {
    /* ignore */
  }
}, 2000);

setInterval(() => {
  if (!clients.size) return;
  const items = [];
  try {
    items.push(...tailFile('codex', codexRollouts()[0]?.file, codexLineToItem, 'codex'));
    items.push(...tailFile('wb', wbTranscriptPath(), wbLineToItem, 'workbuddy'));
  } catch {
    /* ignore */
  }
  if (items.length) broadcast('feed', { items });
}, 1200);

server.listen(PORT, '127.0.0.1', () => {
  console.log(`三体控制台 v2 → http://127.0.0.1:${PORT}`);
});

/* ================================================================== *
 * 身份标识 + 父进程守护
 *
 * 问题：桌面壳被 taskkill /F 强杀时，Electron 的 will-quit 不会执行，
 * 这个服务进程就变成孤儿，继续占着 7788。下次启动时壳又会误以为
 * 「端口上已经有服务了」，于是连到跑着旧代码的僵尸服务上。
 *
 * 对策：
 *   1. 写一份身份文件（pid / 父进程 pid / 端口 / 应用目录），壳能据此
 *      判断端口上的是不是「当前这份代码」；
 *   2. 每秒盯一次父进程，父进程没了就自己退出，把端口还回去。
 * ================================================================== */

const IDENTITY_FILE = process.env.CONSOLE_IDENTITY_FILE || path.join(HERE, '.console-server.json');
const PARENT_PID = Number(process.env.CONSOLE_PARENT_PID || process.ppid);
const IDENTITY_STARTED = Date.now();

function writeIdentity() {
  try {
    fs.writeFileSync(
      IDENTITY_FILE,
      JSON.stringify(
        {
          pid: process.pid,
          parentPid: PARENT_PID,
          port: PORT,
          appDir: HERE,
          startedAt: Date.now(),
        },
        null,
        2,
      ),
    );
  } catch {
    /* 写不了就算了，不影响服务 */
  }
}

function clearIdentity() {
  try {
    const cur = JSON.parse(fs.readFileSync(IDENTITY_FILE, 'utf8'));
    if (cur.pid === process.pid) fs.unlinkSync(IDENTITY_FILE);
  } catch {
    /* 已经没了 */
  }
}

function pidAlive(pid) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    // Windows 上 EPERM 说明进程存在但权限不够
    return e.code === 'EPERM';
  }
}

writeIdentity();

// 父进程没了 → 主动退出，别留孤儿占端口
const guardian = setInterval(() => {
  if (!pidAlive(PARENT_PID)) {
    clearInterval(guardian);
    clearIdentity();
    console.log('[console] 桌面壳已退出，服务自行结束。');
    process.exit(0);
  }
}, 1000);
guardian.unref?.();

function shutdown() {
  clearIdentity();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
process.on('exit', clearIdentity);
