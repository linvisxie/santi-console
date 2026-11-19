import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';
import {NativeAdapter} from '../runtime/resources/app/lib/adapters.mjs';
const root=path.resolve('tools/.native-smoke');fs.mkdirSync(root,{recursive:true});
const records=[];
for(const agent of ['codex','workbuddy','dsh']){
 const marker='santi-'+crypto.randomBytes(4).toString('hex');let nativeId;const steps=[];
 for(let step=0;step<2;step++){
  const events=[];const task={id:`smoke-${agent}-${step}-${Date.now()}`,agent,cwd:root,mode:'read',nativeId,prompt:step?'上一条的暗号是什么？只回复暗号，不调用工具。':`请记住暗号 ${marker}，只回复“已记住”，不调用任何工具。`,model:agent==='workbuddy'?'auto':agent==='dsh'?'DeepSeek-Flash':'',effort:'low',attachments:[]};
  const adapter=new NativeAdapter(task,{appDir:path.resolve('runtime/resources/app'),bridgeDir:path.resolve('bridges'),dataDir:root,emit:e=>{events.push(e);if(e.kind==='binding')nativeId=e.nativeId;},request:async()=>false});
  const timeout=setTimeout(()=>adapter.rpc?.kill(),90000);const began=Date.now();
  try{const result=await adapter.run();const final=events.filter(e=>e.kind==='message').map(e=>e.text).join('\n')||events.filter(e=>e.kind==='delta').map(e=>e.text).join('');steps.push({step,ok:!result.cancelled,reply:final,ms:Date.now()-began,nativeId,tools:events.filter(e=>e.kind==='tool').length});console.log(agent,step,JSON.stringify(steps.at(-1)));}
  catch(error){steps.push({step,ok:false,error:error.message,ms:Date.now()-began});console.log(agent,step,'FAILED',error.message);break;}
  finally{clearTimeout(timeout);if(adapter.rpc&&!adapter.rpc.closed)await Promise.race([new Promise(r=>adapter.rpc.child.once('close',r)),new Promise(r=>setTimeout(()=>{adapter.rpc.kill();r();},4500))]);}
 }
 const result={agent,marker,steps,resumeVerified:steps.length===2&&steps[1].ok&&steps[1].reply.includes(marker)};records.push(result);fs.writeFileSync('tools/native-workbench-smoke-results.json',JSON.stringify(records,null,2));
}
console.log('RESUME',records.map(r=>({agent:r.agent,resumeVerified:r.resumeVerified})));
