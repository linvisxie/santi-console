import fs from 'node:fs';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const run=promisify(execFile);
export function mcpManagement(appDir){
  const root=path.resolve(appDir,'../../..','bridges/santi-mcp');
  let busy=false;
  return async(action='status')=>{
    if(!['status','start','stop','restart','config','logs'].includes(action))throw Error('未知 MCP 操作');
    if(['start','stop','restart'].includes(action)){
      if(busy)throw Error('MCP 服务正在切换，请稍后刷新');
      busy=true;
      try{for(const name of action==='restart'?['stop','start']:[action])await run('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',path.join(root,name+'-http.ps1')],{windowsHide:true,timeout:20000});}finally{busy=false;}
    }
    if(action==='config')return {config:JSON.parse(fs.readFileSync(path.join(root,'grokbot-local.json'),'utf8'))};
    if(action==='logs')return {logs:fs.existsSync(path.join(root,'logs/http.stderr.log'))?fs.readFileSync(path.join(root,'logs/http.stderr.log'),'utf8').slice(-16000):'暂无日志'};
    let online=false;try{const r=await fetch('http://127.0.0.1:7790/mcp',{method:'POST',signal:AbortSignal.timeout(1500)});online=r.status===401;}catch{}
    return {online,busy,url:'http://127.0.0.1:7790/mcp',transport:'stdio 随客户端启动；HTTP 可独立启停',remote:'尚未配置远程连接'};
  };
}
