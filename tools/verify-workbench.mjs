import zlib from 'node:zlib';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {spawn} from 'node:child_process';import {pathToFileURL} from 'node:url';
import {classifyActivity} from '../runtime/resources/app/lib/activity.mjs';
const root=path.resolve('tools/.workbench-tests');fs.mkdirSync(root,{recursive:true});
const project=fs.mkdtempSync(path.join(root,'project-'));const data=fs.mkdtempSync(path.join(root,'state-'));
const historyDir=path.join(root,'.codex/sessions/2026/10/26');fs.mkdirSync(historyDir,{recursive:true});const nativeRows=[{type:'session_meta',payload:{cwd:project}},{type:'response_item',payload:{type:'message',role:'user',content:[{type:'input_text',text:'普通标题'}]}},{type:'response_item',payload:{type:'message',role:'assistant',content:[{type:'output_text',text:'historical-body-needle 独立历史正文'}]}}];const nativeText=nativeRows.map(row=>JSON.stringify(row)).join('\n')+'\n';fs.writeFileSync(path.join(historyDir,'fixture-search.jsonl'),nativeText);fs.mkdirSync(path.join(root,'.codex/archived_sessions'),{recursive:true});fs.writeFileSync(path.join(root,'.codex/archived_sessions/fixture-compressed.jsonl.zst'),zlib.zstdCompressSync(Buffer.from(nativeText)));
let server,workerPid;const env={...process.env,CONSOLE_PORT:'7802',CONSOLE_DATA_HOME:root,CONSOLE_WORKBENCH_DIR:data,CONSOLE_STATE_FILE:path.join(root,'console-state.json'),CONSOLE_IDENTITY_FILE:path.join(root,'identity.json'),CONSOLE_TEST_MODE:'1',CONSOLE_TEST_ADAPTER:pathToFileURL(path.resolve('tools/workbench-fake-adapter.mjs')).href};
const start=()=>server=spawn(process.execPath,['runtime/resources/app/server.mjs'],{env,windowsHide:true,stdio:['ignore','ignore','pipe']});
const url='http://127.0.0.1:7802/api/workbench';let checks=0;
function check(name,value){assert.ok(value,name);console.log('PASS',name);checks++;}
async function api(route,method='GET',body){const r=await fetch(url+route,{method,headers:{'content-type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});const j=await r.json();if(!r.ok)throw new Error(j.error);return j;}
async function wait(fn){for(let n=0;n<150;n++){try{const v=await fn();if(v)return v;}catch{}await new Promise(r=>setTimeout(r,100));}throw new Error('wait timed out');}
const task=async(conversationId,prompt,extra={})=>api('/tasks','POST',{conversationId,prompt,mode:'read',...extra});
const state=()=>api('/state');const getTask=async id=>(await state()).tasks.find(t=>t.id===id);
const final=async id=>wait(async()=>{const t=await getTask(id);return ['finished','failed','stopped','interrupted'].includes(t.state)&&t;});
try{
 start();await wait(()=>api('/state'));workerPid=JSON.parse(fs.readFileSync(path.join(data,'worker.json'))).pid;
 const c=await api('/conversations','POST',{agent:'codex',cwd:project,title:'fixture conversation'});
 const first=await task(c.id,'hello');await final(first.taskId);const second=await task(c.id,'continue');await final(second.taskId);
 const s=await state();check('native session binding reused',s.tasks[0].nativeId===s.tasks[1].nativeId&&s.tasks[0].nativeId!==null);
 check('events durable',((await api('/task-events?id='+first.taskId)).events).some(e=>e.kind==='delta'));
 const approval=await task(c.id,'approve write',{mode:'edit'});const waiting=await wait(async()=>{const t=await getTask(approval.taskId);return t.state==='waiting'&&t;});
 check('permission has exact persisted request identity',!!waiting.pending.id);
 await api('/answer','POST',{taskId:waiting.id,requestId:waiting.pending.id,answer:true});await final(waiting.id);
 check('approved write recorded in actual evidence',(await getTask(waiting.id)).evidence.changes.some(f=>f.path==='fixture.txt'));
 let stale=false;try{await api('/answer','POST',{taskId:waiting.id,requestId:waiting.pending.id,answer:true});}catch{stale=true;}check('stale approvals rejected',stale);
 const slow=await task(c.id,'slow read');await wait(async()=>['running','starting'].includes((await getTask(slow.taskId)).state));
 const queued=await task(c.id,'later');check('same conversation serialized',(await getTask(queued.taskId)).state==='queued');
 await api('/stop','POST',{taskId:queued.taskId});check('queued task can be stopped',(await getTask(queued.taskId)).state==='stopped');
 server.kill();await new Promise(r=>server.once('exit',r));start();await wait(()=>api('/state'));
 check('UI server restart preserves worker',JSON.parse(fs.readFileSync(path.join(data,'worker.json'))).pid===workerPid);
 check('running task remains owned after restart',['running','finished'].includes((await getTask(slow.taskId)).state));
 await api('/stop','POST',{taskId:slow.taskId});await final(slow.taskId);check('stop confirmed after completion',(await getTask(slow.taskId)).state==='stopped');
 fs.writeFileSync(path.join(project,'reference.md'),'fixture context');
 const reference=await task(c.id,'reference',{references:['reference.md']});await final(reference.taskId);check('context file explicitly included',(await getTask(reference.taskId)).prompt.includes('fixture context'));
 let escaped=false;try{await api('/file?conversationId='+c.id+'&path='+encodeURIComponent('../console-state.json'));}catch{escaped=true;}check('file traversal rejected',escaped);
 await api('/conversation','PATCH',{id:c.id,title:'renamed',pinned:true,deliverables:['fixture.txt']});check('task name pin and delivery persisted',(await state()).conversations[0].pinned&&(await state()).conversations[0].deliverables.includes('fixture.txt'));
 await api('/settings','POST',{maxConcurrent:3});check('bounded concurrency configurable',(await state()).maxConcurrent===3);
 const dying=await task(c.id,'slow');await wait(async()=>['starting','running'].includes((await getTask(dying.taskId)).state));
 process.kill(workerPid);await new Promise(r=>setTimeout(r,300));await wait(()=>api('/state'));workerPid=JSON.parse(fs.readFileSync(path.join(data,'worker.json'))).pid;
 check('worker crash marked interrupted without replay',(await getTask(dying.taskId)).state==='interrupted');
 const repeated=await task(c.id,'idempotent',{clientRequestId:'same-request'});await final(repeated.taskId);const repeatedAgain=await task(c.id,'idempotent',{clientRequestId:'same-request'});check('accepted submission cannot be duplicated by retry',repeatedAgain.taskId===repeated.taskId);
 const other=await api('/conversations','POST',{agent:'dsh',cwd:project,title:'other agent'});await api('/project','POST',{path:project,agent:'codex',archived:true});const archived=await state();check('project archive includes owned work conversations',archived.conversations.find(x=>x.id===c.id).archived);check('project archive does not affect another agent',!archived.conversations.find(x=>x.id===other.id).archived);
 const search=await fetch('http://127.0.0.1:7802/api/history-search?q=historical-body-needle');const searchText=await search.text();check('native full-text finds uncompressed history',searchText.includes('codex:fixture-search'));check('native full-text finds compressed history',searchText.includes('codex:fixture-compressed'));
 const untrusted=await fetch('http://127.0.0.1:7802/api/workbench/state',{headers:{Origin:'https://untrusted.example'}});check('external browser origin rejected',untrusted.status===403);
 const now=Date.now();check('heartbeat alone cannot mark busy',!classifyActivity('workbuddy',[],true,now).busy);
 check('frozen mtime does not override event time',classifyActivity('codex',[{ts:now-1000,phase:'work'}],true,now).busy);
 check('native completion clears busy',!classifyActivity('codex',[{ts:now-2000,phase:'start'},{ts:now-1000,phase:'end'}],true,now).busy);
 check('owned pending approval is active',classifyActivity('dsh',[],false,now,[{agent:'dsh',state:'waiting',startedAt:now}]).phase==='waiting');
 fs.writeFileSync('tools/workbench-test-results.json',JSON.stringify({checks,passed:true,type:'isolated fake native adapter plus actual worker/filesystem/http',date:new Date().toISOString()},null,2));console.log('CHECKS',checks);
}finally{server?.kill();if(workerPid)try{process.kill(workerPid);}catch{}}
