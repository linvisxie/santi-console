import fs from 'node:fs';import path from 'node:path';
export class NativeAdapter {
 constructor(task,options){Object.assign(this,{task,...options});}
 async run(){
  if(this.task.inspect)return {models:{availableModels:[{modelId:'fixture',name:'Fixture'}]},configOptions:[{id:'thought_level',category:'thought_level',currentValue:'low',options:[{value:'low',name:'低'}]}]};
  const nativeId=this.task.nativeId||'native-'+this.task.conversationId;this.emit({kind:'binding',nativeId});
  if(this.task.prompt.includes('approve')){const allowed=await this.request({type:'permission',method:'fixture/approval',detail:{command:'write fixture.txt'}});this.emit({kind:'diagnostic',text:allowed?'allowed':'denied'});if(!allowed)return {cancelled:true};}
  this.emit({kind:'delta',itemId:'answer',text:'reply:'+this.task.originalPrompt});
  if(this.task.prompt.includes('longhistory'))for(let n=0;n<100;n++)this.emit({kind:'message',itemId:'long-'+n,text:'消息 '+n+'：'+ '用于验证长会话与阅读锚点。'.repeat(25)});
  if(this.task.prompt.includes('slow'))for(let n=0;n<100&&!this.cancelled;n++)await new Promise(r=>setTimeout(r,50));
  if(this.task.prompt.includes('write')&&!this.cancelled){fs.writeFileSync(path.join(this.task.cwd,'fixture.txt'),'changed');this.emit({kind:'tool_result',id:'test',title:'fixture check',exitCode:0,output:'fixture checked'});}
  return {cancelled:!!this.cancelled};
 }
 async cancel(){this.cancelled=true;}
}
