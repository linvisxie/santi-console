import fs from 'node:fs';import path from 'node:path';import {spawn} from 'node:child_process';
const root=fs.mkdtempSync(path.resolve('tools/.native-service-'));const project=path.join(root,'project');fs.mkdirSync(project);const workerDir=path.join(root,'worker');
const env={...process.env,CONSOLE_PORT:'7804',CONSOLE_DATA_HOME:root,CONSOLE_WORKBENCH_DIR:workerDir,CONSOLE_STATE_FILE:path.join(root,'state.json'),CONSOLE_IDENTITY_FILE:path.join(root,'identity.json')};delete env.CONSOLE_TEST_MODE;delete env.CONSOLE_TEST_ADAPTER;
const server=spawn(process.execPath,['runtime/resources/app/server.mjs'],{env,windowsHide:true,stdio:['ignore','ignore','pipe']});let workerPid;let stderr='';server.stderr.on('data',b=>stderr+=b);
const url='http://127.0.0.1:7804/api/workbench';const results=[];const agents=process.argv.slice(2);const output=agents.length?'tools/native-service-'+agents.join('-')+'-results.json':'tools/native-service-results.json';
async function api(route,method='GET',data){const response=await fetch(url+route,{method,headers:{'content-type':'application/json'},body:data===undefined?undefined:JSON.stringify(data)});const value=await response.json();if(!response.ok)throw Error(value.error);return value;}
async function waitReady(){for(let n=0;n<100;n++){try{return await api('/state');}catch{await new Promise(r=>setTimeout(r,100));}}throw Error(stderr||'server startup timed out');}
async function execute(conversation,prompt,mode,expectedFile){const submitted=await api('/tasks','POST',{conversationId:conversation.id,prompt,mode,model:conversation.agent==='dsh'?'DeepSeek-Flash':conversation.agent==='workbuddy'?'auto':'',effort:'low'});const approvals=[];let task;
 for(let n=0;n<360;n++){const s=await api('/state');task=s.tasks.find(t=>t.id===submitted.taskId);if(task.pending){const text=JSON.stringify(task.pending.detail);const allowed=!!expectedFile&&text.includes(expectedFile);approvals.push({method:task.pending.method,allowed,details:text.slice(0,2000)});await api('/answer','POST',{taskId:task.id,requestId:task.pending.id,answer:allowed});}
  if(['finished','failed','stopped','interrupted'].includes(task.state))break;await new Promise(r=>setTimeout(r,250));
 }
 if(['starting','running','waiting','stopping'].includes(task.state)){await api('/stop','POST',{taskId:task.id});await new Promise(r=>setTimeout(r,6000));task=(await api('/state')).tasks.find(t=>t.id===task.id);task.error='测试等待超时；'+(task.error||'未取得结束证据');}
 const events=(await api('/task-events?id='+task.id)).events;
 const result={agent:conversation.agent,mode,state:task.state,nativeId:task.nativeId,error:task.error,approvals,changes:task.evidence?.changes.map(f=>({path:f.path,status:f.status,hasPatch:!!f.patch})),tools:events.filter(e=>e.kind==='tool_result').map(e=>({title:e.title,state:e.state,exitCode:e.exitCode})),reply:(events.some(e=>e.kind==='message')?events.filter(e=>e.kind==='message'):events.filter(e=>e.kind==='delta')).map(e=>e.text).join(''),elapsedMs:task.endedAt-task.startedAt};results.push(result);console.log(JSON.stringify(result));fs.writeFileSync(output,JSON.stringify({root,results},null,2));return result;
}
try{
 await waitReady();workerPid=JSON.parse(fs.readFileSync(path.join(workerDir,'worker.json'))).pid;
 for(const agent of ['codex','dsh'].filter(agent=>!agents.length||agents.includes(agent))){
  const c=await api('/conversations','POST',{agent,cwd:project,title:'原生文件与权限验收 '+agent});const file=agent+'-proof.txt';
  const write=await execute(c,`这是隔离验收目录。请只使用文件工具创建当前目录的 ${file}，内容严格为 santi-approved。不要执行终端命令，不要更改其他文件，完成后回复已写入。`,'edit',file);
  write.actualFileCorrect=fs.existsSync(path.join(project,file))&&fs.readFileSync(path.join(project,file),'utf8').trim()==='santi-approved';
  const forbidden=agent+'-readonly-forbidden.txt';const read=await execute(c,`现在是只读验收。尝试创建当前目录的 ${forbidden}，内容为 forbidden；如果权限不允许，请明确拒绝。不要执行其他任务。`,'read');read.readOnlyHeld=!fs.existsSync(path.join(project,forbidden));read.sameNativeId=write.nativeId===read.nativeId;
 }
 if(!agents.length||agents.includes('workbuddy')){const wb=await api('/conversations','POST',{agent:'workbuddy',cwd:project,title:'原生认证状态验收'});await execute(wb,'只回复在线，不调用工具。','read');}
 fs.writeFileSync(output,JSON.stringify({root,results},null,2));
}finally{server.kill();if(workerPid)try{process.kill(workerPid);}catch{}}
