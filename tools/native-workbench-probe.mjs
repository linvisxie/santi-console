import fs from 'node:fs';import path from 'node:path';
import {NativeAdapter} from '../runtime/resources/app/lib/adapters.mjs';
import {RpcProcess} from '../runtime/resources/app/lib/rpc.mjs';
const dir=path.resolve('tools/.native-probe');fs.mkdirSync(dir,{recursive:true});
const original=RpcProcess.prototype.call;
RpcProcess.prototype.call=function(method,params,timeout){if(method==='session/prompt')return Promise.resolve({stopReason:'end_turn'});if(method==='turn/start'){setTimeout(()=>owners.get(this)?.resolve({}),0);return Promise.resolve({turn:{id:'probe-no-model'}});}return original.call(this,method,params,timeout)};
const owners=new Map();const originalWrite=RpcProcess.prototype.write;RpcProcess.prototype.write=function(message){if(message.method)console.log('RPC',message.method);return originalWrite.call(this,message)};
for(const agent of ['codex','workbuddy','dsh']){
 let adapter;const task={id:'probe-'+agent,agent,cwd:dir,mode:'read',prompt:'probe intercepted',attachments:[],model:'',effort:'medium'};
 adapter=new NativeAdapter(task,{appDir:path.resolve('runtime/resources/app'),bridgeDir:path.resolve('bridges'),dataDir:dir,emit:e=>{if(e.kind==='binding'){owners.set(adapter.rpc,adapter);console.log(agent,'SESSION',e.nativeId);}else if(e.kind==='controls')console.log(agent,JSON.stringify(e));else if(e.kind==='capabilities')console.log(agent,JSON.stringify(e));},request:async()=>false});
 try{await adapter.run();console.log(agent,'HANDSHAKE OK (prompt intercepted)')}catch(error){console.log(agent,'FAILED',error.message);adapter.rpc?.kill();}
}
