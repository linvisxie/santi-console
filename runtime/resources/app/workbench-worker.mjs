import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { WorkbenchStore } from './lib/workbench-store.mjs';
import { NativeAdapter, CAPABILITIES } from './lib/adapters.mjs';
import { resolveFile, listFiles, readFile } from './lib/workspace.mjs';

import {captureSnapshot,compareCaptured} from './lib/snapshots.mjs';
import {filePage,fileHash,saveText,renderOffice} from './lib/file-workspace.mjs';

const appDir=path.dirname(fileURLToPath(import.meta.url));
const runtimeRevision=crypto.createHash('sha256').update(Buffer.concat([fs.readFileSync(fileURLToPath(import.meta.url)),...fs.readdirSync(path.join(appDir,'lib')).filter(file=>file.endsWith('.mjs')).sort().map(file=>fs.readFileSync(path.join(appDir,'lib',file)))])).digest('hex').slice(0,16);
const dataDir=process.env.CONSOLE_WORKBENCH_DIR||path.join(appDir,'.workbench');
fs.mkdirSync(dataDir,{recursive:true});
const lockFile=path.join(dataDir,'worker.lock');
try {
  const descriptor=fs.openSync(lockFile,'wx');fs.writeFileSync(descriptor,JSON.stringify({pid:process.pid,appDir}));fs.closeSync(descriptor);
} catch(error) {
  if(error.code!=='EEXIST')throw error;
  let previous;try{previous=JSON.parse(fs.readFileSync(lockFile,'utf8'));}catch{throw new Error('任务服务正在启动，请稍后重试');}
  let alive=true;try{process.kill(previous.pid,0);}catch(probe){alive=probe.code==='EPERM';}
  if(alive)process.exit(0);
  fs.unlinkSync(lockFile);const descriptor=fs.openSync(lockFile,'wx');fs.writeFileSync(descriptor,JSON.stringify({pid:process.pid,appDir}));fs.closeSync(descriptor);
}
const store=new WorkbenchStore(dataDir);
const Adapter = process.env.CONSOLE_TEST_MODE === '1' && process.env.CONSOLE_TEST_ADAPTER
  ? (await import(process.env.CONSOLE_TEST_ADAPTER)).NativeAdapter : NativeAdapter;
const token=crypto.randomBytes(32).toString('hex');
const active=new Map(),pending=new Map(),clients=new Set();let idleAt=Date.now();
const catalogs = new Map(), inspecting = new Map();
const bridgeDir=process.env.CONSOLE_BRIDGES_DIR||path.resolve(appDir,'../../../bridges');
const send=(res,code,data)=>{res.writeHead(code,{'content-type':'application/json; charset=utf-8','cache-control':'no-store'});res.end(JSON.stringify(data));};
function publish(data){idleAt=Date.now();const text='event: workbench\ndata: '+JSON.stringify(data)+'\n\n';for(const res of clients){if(res.destroyed||res.writableLength>(2<<20)){res.end();clients.delete(res);continue;}try{res.write(text);}catch{clients.delete(res);}}}
const summary=()=>({runtimeRevision,revision:store.data.revision||0,conversations:store.data.conversations,tasks:store.data.tasks,maxConcurrent:store.data.maxConcurrent,capabilities:CAPABILITIES});
function changed(){store.data.revision=(store.data.revision||0)+1;store.save();publish({type:'state',...summary()});}
function emit(task,event){
  if(event.kind==='usage')task.usage=event.usage;
  if(event.kind==='binding'){const conversation=store.data.conversations.find(c=>c.id===task.conversationId);task.nativeId=event.nativeId;conversation.nativeId=event.nativeId;changed();}
  const value=store.append(task,event);publish({type:'event',event:value});return value;
}
function request(task,question){
  const id=crypto.randomUUID();task.state='waiting';task.pending={id,...question};emit(task,{kind:'approval',request:task.pending});changed();
  return new Promise(resolve=>pending.set(id,{taskId:task.id,resolve}));
}
async function execute(task){
  task.state='starting';task.startedAt=Date.now();changed();
  let before,adapter,finalState;
  try{
    before=await captureSnapshot(task.cwd,dataDir);if(task.state==='stopping'||task.state==='stopped')throw Error('任务在准备期间已停止');
    const conversation=store.data.conversations.find(c=>c.id===task.conversationId);
    task.nativeId=conversation.nativeId;
    adapter=new Adapter(task,{appDir,bridgeDir,dataDir,emit:event=>emit(task,event),request:question=>request(task,question)});
    active.set(task.id,adapter);task.state='running';changed();
    const result=await adapter.run();finalState=result.cancelled?'stopped':'finished';task.stopReason=result.stopReason;
  }catch(error){finalState=task.state==='stopping'?'stopped':'failed';task.error=error.message;task.errorCode=error.code;task.errorDetail=error.detail;emit(task,{kind:'error',text:error.message});}
  finally{
    task.phase='evidence';
    for(const [id,entry] of pending)if(entry.taskId===task.id){entry.resolve(false);pending.delete(id);}delete task.pending;
    try{task.evidence=before?await compareCaptured(before,await captureSnapshot(task.cwd,dataDir),dataDir,task.id):{changes:[],incomplete:true,error:'未取得执行前快照'};}catch(error){task.evidence={changes:[],incomplete:true,error:error.message};}
    const recorded=new Map();const errors=[];
    for(const event of store.events(task.id,0,Infinity)){
      if(event.kind==='tool_result')recorded.set(event.id,{title:event.title,state:event.state,exitCode:event.exitCode});
      if(event.kind==='error')errors.push(event.text);
    }
    task.evidence.executions=[...recorded.values()];
    task.evidence.failures=[...task.evidence.executions.filter(item=>['failed','declined'].includes(item.state)||(typeof item.exitCode==='number'&&item.exitCode!==0)),...errors.map(title=>({title,state:'failed'}))];
    task.evidence.unverified=['需求是否全部满足，尚未自动验收。',...(task.evidence.incomplete?['目录扫描存在范围或读取限制，文件清单可能不完整。']:[]),...(task.evidence.textIncomplete?['部分文件超过文本快照大小或总预算，仅比较元数据，不能提供完整内容差异。']:[]),...(task.evidence.executions.some(item=>item.exitCode===undefined)?['部分工具没有提供退出码，未据此标记检查通过。']:[])];
    active.delete(task.id);task.state=finalState||'failed';task.endedAt=Date.now();delete task.phase;
    emit(task,{kind:'end',state:task.state,error:task.error,evidence:task.evidence,note:'执行结束。需求是否实现仍需根据文件变化、执行记录与验收结果确认。'});
    changed();pump();
  }
}
let pumping=false;
function pump(){
  if(pumping)return;pumping=true;
  try{
    for(const task of store.data.tasks.filter(t=>t.state==='queued')){
      if(active.size>=store.data.maxConcurrent)break;
      const occupied=store.data.tasks.filter(t=>active.has(t.id));
      if(occupied.some(t=>t.conversationId===task.conversationId||t.cwd.toLowerCase()===task.cwd.toLowerCase()&&(t.mode==='edit'||task.mode==='edit')))continue;
      // Reserve before the first await so concurrent queue submissions cannot overlap.
      active.set(task.id,null);execute(task).catch(error=>{task.state='failed';task.error=error.message;active.delete(task.id);changed();});
    }
  }finally{pumping=false;}
}
async function body(req){let text='';for await(const chunk of req){text+=chunk;if(text.length>20<<20)throw new Error('请求过大');}return JSON.parse(text||'{}');}
const server=http.createServer(async(req,res)=>{
  try{
    if(req.headers.authorization!=='Bearer '+token)return send(res,403,{error:'工作台连接凭证不匹配'});
    idleAt=Date.now();const url=new URL(req.url,'http://localhost');const route=url.pathname;
    if(route==='/identify')return send(res,200,{appDir,pid:process.pid,version:2,runtimeRevision});
    if(route==='/state')return send(res,200,summary());
    if(route==='/search') {
      const query=(url.searchParams.get('q')||'').trim().toLowerCase();const hits=[];
      if(query)for(const conversation of store.data.conversations){
        let match=conversation.title.toLowerCase().includes(query),snippet='';
        for(const task of store.data.tasks.filter(t=>t.conversationId===conversation.id)) {
          let after=0,text='';for(;;){const events=store.events(task.id,after,500);if(!events.length)break;text+=events.filter(e=>['user','delta','message'].includes(e.kind)).map(e=>e.text||'').join('');after=events.at(-1).seq;if(events.length<500)break;}
          const index=text.toLowerCase().indexOf(query);if(index>=0){match=true;snippet=text.slice(Math.max(0,index-35),index+140);break;}
        }
        if(match)hits.push({conversationId:conversation.id,title:conversation.title,agent:conversation.agent,snippet,archived:conversation.archived});
      }
      return send(res,200,{hits:hits.slice(0,50),total:hits.length});
    }
    if(route==='/catalog') {
      const agent=url.searchParams.get('agent');if(!CAPABILITIES[agent])throw new Error('代理无效');
      const model=url.searchParams.get('model')||'';const key=agent+':'+model;
      if(catalogs.has(key)&&Date.now()-catalogs.get(key).at<600000)return send(res,200,catalogs.get(key).data);
      if(!inspecting.has(key)) {
        const cwd=url.searchParams.get('cwd')||appDir;
        const adapter=new Adapter({id:'catalog-'+crypto.randomUUID(),agent,cwd,mode:'read',model:agent==='dsh'?model:'',inspect:true,attachments:[]},{appDir,bridgeDir,dataDir,emit:()=>{},request:async()=>false});
        const result=adapter.run().then(data=>{catalogs.set(key,{at:Date.now(),data});return data;}).finally(()=>inspecting.delete(key));inspecting.set(key,result);
      }
      return send(res,200,await inspecting.get(key));
    }
    if(route==='/events'){
      res.writeHead(200,{'content-type':'text/event-stream','cache-control':'no-cache','connection':'keep-alive'});clients.add(res);res.write('event: workbench\ndata: '+JSON.stringify({type:'state',...summary()})+'\n\n');
      const ping=setInterval(()=>res.write(': heartbeat\n\n'),15000);req.on('close',()=>{clients.delete(res);clearInterval(ping);});return;
    }
    if(route==='/conversations'&&req.method==='POST'){const conversation=store.conversation(await body(req));changed();return send(res,200,conversation);}
    if(route==='/conversation'&&req.method==='PATCH'){
      const input=await body(req),conversation=store.data.conversations.find(c=>c.id===input.id);if(!conversation)throw new Error('找不到会话');
      for(const key of ['title','pinned','archived','deliverables'])if(input[key]!==undefined)conversation[key]=input[key];changed();return send(res,200,conversation);
    }
    if(route==='/project'&&req.method==='POST'){
      const input=await body(req);let count=0;
      for(const conversation of store.data.conversations)if(conversation.cwd.toLowerCase()===path.resolve(input.path).toLowerCase()&&(!input.agent||conversation.agent===input.agent)){conversation.archived=!!input.archived;count++;}
      changed();return send(res,200,{ok:true,count});
    }
    if(route==='/tasks'&&req.method==='POST'){
      const input=await body(req),conversation=store.data.conversations.find(c=>c.id===input.conversationId);if(!conversation)throw new Error('找不到会话');
      const previous=input.clientRequestId&&store.data.tasks.find(task=>task.conversationId===conversation.id&&task.clientRequestId===input.clientRequestId);
      if(previous)return send(res,200,{taskId:previous.id,runId:previous.id,conversationId:conversation.id,state:previous.state});
      if(!input.prompt?.trim())throw new Error('请填写任务');
      const refs=[];for(const relative of input.references||[]){const file=readFile(conversation.cwd,relative);if(file.binary||file.tooLarge)throw new Error('上下文只能选取不超过 2 MB 的文本文件');refs.push({path:relative,text:file.content});}
      const context=refs.map(f=>`\n\n[用户选择的项目文件：${f.path}]\n${f.text}\n[文件结束]`).join('');
      if(context.length>200000)throw new Error('选中文件合计超过 200,000 字符，请减少文件');
      const attachments=(input.attachments||[]).map(f=>{
        const resolved=fs.realpathSync(f);const root=fs.realpathSync(path.join(appDir,'.uploads'));const rel=path.relative(root,resolved);
        if(rel.startsWith('..')||path.isAbsolute(rel))throw new Error('附件必须先通过上传入口添加');return resolved;
      });
      const task=store.task(conversation,{...input,attachments,originalPrompt:input.prompt,prompt:input.prompt+context});
      emit(task,{kind:'user',text:input.prompt,attachments,references:input.references||[]});changed();pump();return send(res,200,{taskId:task.id,runId:task.id,conversationId:conversation.id,state:task.state});
    }
    if(route==='/task-events')return send(res,200,{events:store.events(url.searchParams.get('id'),Number(url.searchParams.get('after')||0),500)});
    if(route==='/stop'&&req.method==='POST'){
      const input=await body(req),task=store.data.tasks.find(t=>t.id===input.taskId);if(!task)throw new Error('任务不存在');
      if(task.state==='queued'){task.state='stopped';task.endedAt=Date.now();changed();return send(res,200,{ok:true,state:task.state});}
      if(!active.has(task.id))return send(res,200,{ok:true,state:task.state});
      task.state='stopping';changed();for(const [id,entry] of pending)if(entry.taskId===task.id){entry.resolve(false);pending.delete(id);}delete task.pending;
      await active.get(task.id)?.cancel();return send(res,200,{ok:true,state:'stopping'});
    }
    if(route==='/answer'&&req.method==='POST'){
      const input=await body(req),entry=pending.get(input.requestId),task=store.data.tasks.find(t=>t.id===input.taskId);
      if(!entry||entry.taskId!==task?.id||task.state!=='waiting'||task.pending?.id!==input.requestId)throw new Error('确认请求已失效，请刷新当前任务');
      if(task.pending.type==='permission'&&typeof input.answer!=='boolean')throw new Error('权限请求必须明确允许或拒绝');
      pending.delete(input.requestId);delete task.pending;task.state='running';entry.resolve(input.answer);emit(task,{kind:'approval_answer',allowed:!!input.answer});changed();return send(res,200,{ok:true});
    }
    if(route==='/settings'&&req.method==='POST'){const input=await body(req);store.data.maxConcurrent=Math.max(1,Math.min(3,Number(input.maxConcurrent)||1));changed();pump();return send(res,200,{ok:true});}
    if(route==='/task-diff'){
      const task=store.data.tasks.find(t=>t.id===url.searchParams.get('id'));const change=task?.evidence?.changes.find(c=>c.path===url.searchParams.get('path'));if(!change?.patchFile)throw Error('未找到已保存的差异');
      if(url.searchParams.get('download')==='1'){res.writeHead(200,{'content-type':'text/plain; charset=utf-8','content-disposition':'attachment; filename="changes.patch"'});fs.createReadStream(change.patchFile).pipe(res);return;}
      return send(res,200,filePage(path.dirname(change.patchFile),path.basename(change.patchFile),url.searchParams.get('offset')));
    }
    if(['/files','/file','/file-content','/file-page','/file-version','/file-save','/office-preview'].includes(route)){
      const conversation=store.data.conversations.find(c=>c.id===url.searchParams.get('conversationId'));const cwd=conversation?.cwd||url.searchParams.get('cwd');if(!cwd||!path.isAbsolute(cwd)||!fs.statSync(cwd).isDirectory())throw new Error('先选择有效项目');
      const relative=url.searchParams.get('path')||'';
      if(route==='/file-page')return send(res,200,filePage(cwd,relative,url.searchParams.get('offset'),url.searchParams.get('length')));
      if(route==='/file-version')return send(res,200,{version:await fileHash(resolveFile(cwd,relative))});
      if(route==='/file-save'&&req.method==='POST'){const input=req.headers['content-type']?.startsWith('text/plain')?{content:req,version:req.headers['x-file-version']}:await body(req);try{return send(res,200,await saveText(cwd,relative,input.content,input.version,dataDir));}catch(error){return send(res,error.code==='FILE_CONFLICT'?409:400,{error:error.message,code:error.code,version:error.version});}}
      if(route==='/office-preview'){const pdf=await renderOffice(cwd,relative,dataDir);res.writeHead(200,{'content-type':'application/pdf','content-security-policy':"sandbox; default-src 'none'",'cache-control':'no-store'});fs.createReadStream(pdf).pipe(res);return;}

      if(route==='/files')return send(res,200,{files:listFiles(cwd,relative)});
      const file=readFile(cwd,relative);
      if(route==='/file')return send(res,200,file);
      const target=resolveFile(cwd,relative);res.writeHead(200,{...(url.searchParams.get('download')==='1'?{'content-disposition':"attachment; filename*=UTF-8''"+encodeURIComponent(path.basename(target))}:{}),'content-type':file.mime||'text/plain; charset=utf-8','content-security-policy':"sandbox; default-src 'none'; style-src 'unsafe-inline'; img-src data:",'x-content-type-options':'nosniff'});fs.createReadStream(target).pipe(res);return;
    }
    send(res,404,{error:'未知工作台接口'});
  }catch(error){if(!res.headersSent)send(res,400,{error:error.message});else res.end();}
});
server.listen(0,'127.0.0.1',()=>{
  const info={port:server.address().port,pid:process.pid,appDir,token};const temporary=path.join(dataDir,'worker.json.tmp');fs.writeFileSync(temporary,JSON.stringify(info));fs.renameSync(temporary,path.join(dataDir,'worker.json'));pump();
});
setInterval(()=>{if(!active.size&&!store.data.tasks.some(t=>t.state==='queued')&&!clients.size&&Date.now()-idleAt>90000)process.exit(0);},10000).unref();
process.on('exit',()=>{for(const file of [path.join(dataDir,'worker.json'),lockFile])try{if(JSON.parse(fs.readFileSync(file)).pid===process.pid)fs.unlinkSync(file);}catch{}});
