import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export class WorkbenchStore {
  constructor(dir) {
    this.dir=dir;fs.mkdirSync(path.join(dir,'events'),{recursive:true});
    this.file=path.join(dir,'store.json');
    try{this.data=JSON.parse(fs.readFileSync(this.file,'utf8'));}catch(error){if(error.code!=='ENOENT')throw new Error('任务数据库损坏，已保留原文件，请从备份恢复');this.data={version:1,conversations:[],tasks:[],maxConcurrent:1};}
    for(const task of this.data.tasks)if(['starting','running','waiting','stopping'].includes(task.state)){task.state='interrupted';task.error='任务服务上次意外退出；原生会话保留，可继续或重试。';task.endedAt=Date.now();delete task.pending;}
    this.save();
  }
  save(){const tmp=this.file+'.tmp';fs.writeFileSync(tmp,JSON.stringify(this.data,null,2));fs.renameSync(tmp,this.file);}
  conversation({agent,cwd,nativeId,title,sourceId,historyCount}) {
    if(!['codex','workbuddy','dsh'].includes(agent))throw new Error('代理无效');
    if(!cwd||!path.isAbsolute(cwd)||!fs.existsSync(cwd)||!fs.statSync(cwd).isDirectory())throw new Error('项目目录不存在或不可访问');
    const existing=nativeId&&this.data.conversations.find(c=>c.agent===agent&&c.nativeId===nativeId);
    if(existing){if(path.resolve(existing.cwd).toLowerCase()!==path.resolve(cwd).toLowerCase())throw new Error('会话与项目目录不匹配');return existing;}
    const value={id:crypto.randomUUID(),agent,cwd:path.resolve(cwd),nativeId:nativeId||null,sourceId:sourceId||null,historyCount:Number(historyCount)||0,title:title||'新会话',createdAt:Date.now(),updatedAt:Date.now(),deliverables:[],pinned:false,archived:false};
    this.data.conversations.push(value);this.save();return value;
  }
  events(id,after=0,limit=500){let text;try{text=fs.readFileSync(path.join(this.dir,'events',id+'.jsonl'),'utf8');}catch{return [];}
    const result=[];for(const line of text.split('\n')){try{const event=JSON.parse(line);if(event.seq>after)result.push(event);}catch{}}
    return result.slice(0,limit);
  }
  append(task,event){const value={...event,taskId:task.id,conversationId:task.conversationId,seq:++task.seq,ts:Date.now()};fs.appendFileSync(path.join(this.dir,'events',task.id+'.jsonl'),JSON.stringify(value)+'\n');return value;}
  task(conversation,input){const value={id:crypto.randomUUID(),clientRequestId:input.clientRequestId||null,conversationId:conversation.id,agent:conversation.agent,cwd:conversation.cwd,nativeId:conversation.nativeId,prompt:input.prompt,originalPrompt:input.originalPrompt||input.prompt,attachments:input.attachments||[],references:input.references||[],model:input.model||'',effort:input.effort||'',mode:input.mode==='edit'?'edit':'read',state:'queued',createdAt:Date.now(),seq:0,title:(input.originalPrompt||input.prompt).slice(0,60)};
    this.data.tasks.push(value);conversation.updatedAt=Date.now();if(conversation.title==='新会话')conversation.title=input.originalPrompt?.slice(0,50)||input.prompt.slice(0,50);this.save();return value;
  }
}
