import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import http from 'node:http';
export class WorkbenchClient {
  constructor(appDir){this.appDir=appDir;this.dir=process.env.CONSOLE_WORKBENCH_DIR||path.join(process.env.CONSOLE_DATA_HOME||appDir,'.workbench');this.info=null;this.starting=null;}
  async ensure(){
    if(this.starting)return this.starting;
    if(this.info) {
      try { const response=await fetch(`http://127.0.0.1:${this.info.port}/identify`,{headers:{authorization:'Bearer '+this.info.token},signal:AbortSignal.timeout(1000)});if(response.ok)return this.info; }catch{}
      this.info=null;
    }
    this.starting=this.connect();try{return this.info=await this.starting;}finally{this.starting=null;}
  }
  async connect(){
    const inspect=async()=>{try{const info=JSON.parse(fs.readFileSync(path.join(this.dir,'worker.json'),'utf8'));const r=await fetch(`http://127.0.0.1:${info.port}/identify`,{headers:{authorization:'Bearer '+info.token},signal:AbortSignal.timeout(1000)});const result=await r.json();if(result.appDir===this.appDir&&result.pid===info.pid)return info;}catch{}return null;};
    const current=await inspect();if(current)return current;
    fs.mkdirSync(this.dir,{recursive:true});
    const log=fs.openSync(path.join(this.dir,'worker.log'),'a');
    const child=spawn(process.execPath,[path.join(this.appDir,'workbench-worker.mjs')],{cwd:this.appDir,detached:true,windowsHide:true,env:{...process.env,CONSOLE_WORKBENCH_DIR:this.dir},stdio:['ignore',log,log]});child.unref();fs.closeSync(log);
    for(let n=0;n<100;n++){await new Promise(r=>setTimeout(r,100));const info=await inspect();if(info)return info;}
    throw new Error('任务服务启动失败，请查看工作台 worker.log');
  }
  async request(route,method='GET',data){const info=await this.ensure();try{const response=await fetch(`http://127.0.0.1:${info.port}${route}`,{method,headers:{authorization:'Bearer '+info.token,'content-type':'application/json'},body:data===undefined?undefined:JSON.stringify(data)});const value=await response.json();if(!response.ok)throw new Error(value.error||'任务服务失败');return value;}catch(error){if(error.cause)this.info=null;throw error;}}
  async proxy(req,res,route){
    const info=await this.ensure();
    const upstream=http.request({hostname:'127.0.0.1',port:info.port,path:route,method:req.method,headers:{authorization:'Bearer '+info.token,'content-type':req.headers['content-type']||'application/json',...(req.headers['x-file-version']?{'x-file-version':req.headers['x-file-version']}:{})}},response=>{res.writeHead(response.statusCode,response.headers);response.pipe(res);});
    upstream.on('error',error=>{this.info=null;if(!res.headersSent){res.writeHead(503,{'content-type':'application/json'});res.end(JSON.stringify({error:error.message}));}else res.end();});
    req.on('aborted',()=>upstream.destroy());res.on('close',()=>upstream.destroy());req.pipe(upstream);
  }
}
