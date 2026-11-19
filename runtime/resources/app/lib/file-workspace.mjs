import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {pipeline} from 'node:stream/promises';
import {spawn} from 'node:child_process';
import {resolveFile} from './workspace.mjs';
const digest=buffer=>crypto.createHash('sha256').update(buffer).digest('hex');
export async function fileHash(file){const hash=crypto.createHash('sha256');for await(const chunk of fs.createReadStream(file))hash.update(chunk);return hash.digest('hex');}
export function filePage(root,relative,offset=0,length=65536){
 const file=resolveFile(root,relative),stat=fs.statSync(file);if(!stat.isFile())throw Error('请选择文件');
 const start=Math.max(0,Math.min(stat.size,Number(offset)||0)),count=Math.max(1,Math.min(262144,Number(length)||65536));const fd=fs.openSync(file,'r');let bytes;
 try{bytes=Buffer.alloc(Math.min(count,stat.size-start));fs.readSync(fd,bytes,0,bytes.length,start);}finally{fs.closeSync(fd);}
 const binary=bytes.includes(0);let consumed=bytes.length;
 if(!binary&&start+consumed<stat.size){while(consumed&&((bytes[consumed-1]&0xc0)===0x80))consumed--;if(consumed<bytes.length||bytes.length&&bytes[bytes.length-1]>=0xc0)consumed=Math.max(0,consumed-1);if(!consumed)consumed=bytes.length;}
 const visible=bytes.subarray(0,consumed);
 return {relative,path:file,size:stat.size,offset:start,nextOffset:start+consumed,eof:start+consumed>=stat.size,binary,content:binary?undefined:visible.toString('utf8'),hex:binary?[...visible].map((b,i)=>(i%16===0?(start+i).toString(16).padStart(8,'0')+'  ':'')+b.toString(16).padStart(2,'0')+(i%16===15?'\n':' ')).join(''):undefined};
}
const editors=new Map();
export async function saveText(root,relative,content,version,dataDir){
 const file=resolveFile(root,relative),key=file.toLowerCase();if(editors.has(key))throw Error('此文件正在保存，请稍后重试');editors.set(key,true);
 try{
  const current=await fileHash(file);if(current!==version){const error=Error('文件在其他地方更新了，请合并最新内容后保存');error.code='FILE_CONFLICT';error.version=current;throw error;}
  const bytes=typeof content==='string'?Buffer.from(content,'utf8'):null;const backupDir=path.join(dataDir,'file-versions',digest(Buffer.from(file)));await fsp.mkdir(backupDir,{recursive:true});const backup=path.join(backupDir,current);if(!fs.existsSync(backup))await fsp.copyFile(file,backup);
  const temporary=file+'.santi-'+crypto.randomUUID()+'.tmp';if(bytes)await fsp.writeFile(temporary,bytes);else await pipeline(content,fs.createWriteStream(temporary,{flags:'wx'}));const nextVersion=await fileHash(temporary),size=(await fsp.stat(temporary)).size;try{if(await fileHash(file)!==current){const error=Error('保存前文件再次变化，请重新合并');error.code='FILE_CONFLICT';throw error;}await fsp.rename(temporary,file);}finally{await fsp.unlink(temporary).catch(()=>{});}
  return {ok:true,version:nextVersion,backupVersion:current,size};
 }finally{editors.delete(key);}
}
let officeQueue=Promise.resolve();
export function renderOffice(root,relative,dataDir){
 const job=officeQueue.catch(()=>{}).then(async()=>{
  const file=resolveFile(root,relative);if(!/\.(docx|xlsx|pptx)$/i.test(file))throw Error('此预览支持 DOCX、XLSX、PPTX');
  const stamp=await fileHash(file),dir=path.join(dataDir,'office-preview');await fsp.mkdir(dir,{recursive:true});const output=path.join(dir,stamp+'.pdf');if(fs.existsSync(output))return output;
  const script=path.join(path.dirname(new URL(import.meta.url).pathname.replace(/^\/(\w:)/,'$1')),'office-preview.ps1');
  await new Promise((resolve,reject)=>{const child=spawn('powershell.exe',['-NoProfile','-NonInteractive','-File',decodeURIComponent(script),'-InputPath',file,'-OutputPath',output],{windowsHide:true,stdio:['ignore','pipe','pipe']});let error='';child.stderr.on('data',b=>error+=b.toString().slice(0,2000));const timer=setTimeout(()=>{child.kill();reject(Error('本机 Office 转换超时，请在原生 Office 中检查文档；不执行宏'));},120000);child.on('error',e=>{clearTimeout(timer);reject(e)});child.on('exit',code=>{clearTimeout(timer);if(code===0&&fs.existsSync(output))resolve();else reject(Error('本机 Office 预览转换失败：'+error.slice(-400)))});});
  return output;
 });officeQueue=job;return job;
}
