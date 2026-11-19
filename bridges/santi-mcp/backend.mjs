import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {automationToken} from '../../runtime/resources/app/lib/ui-control.mjs';
export const appDir=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../runtime/resources/app');
export const token=automationToken(appDir);
export const base=process.env.SANTI_URL||'http://127.0.0.1:7788';
const u=new URL(base);if(u.protocol!=='http:'||!['127.0.0.1','localhost','[::1]'].includes(u.hostname)||u.pathname!=='/')throw Error('SANTI_URL 必须为本机三体 HTTP 地址');
export const query=(route,params={})=>route+'?'+new URLSearchParams(Object.entries(params).filter(([,v])=>v!==undefined).map(([k,v])=>[k,String(v)]));
export async function api(route,method='GET',body,timeout=30000){
  let response;try{response=await fetch(base+route,{method,headers:{'content-type':'application/json',authorization:'Bearer '+token},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(timeout)});}catch(e){throw Error(`三体服务不可达或操作超时；请打开新版三体。写操作超时后先查状态再重试。${e.name}`);}
  const type=response.headers.get('content-type')||'';const value=type.includes('json')?await response.json():await response.text();
  if(!response.ok)throw Error(typeof value==='object'?value.error||`HTTP ${response.status}`:`HTTP ${response.status}`);return value;
}
export async function identify(){const id=await api('/api/identify');if(path.resolve(id.appDir).toLowerCase()!==appDir.toLowerCase())throw Error('目标端口不是这份三体工作台');if(id.automationVersion!==1)throw Error('三体仍在运行旧版服务，请关闭并重新打开三体，加载 MCP 接口');return id;}
