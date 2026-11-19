import fs from 'node:fs';import fsp from 'node:fs/promises';import path from 'node:path';import crypto from 'node:crypto';import {Transform} from 'node:stream';import {pipeline} from 'node:stream/promises';import {spawn} from 'node:child_process';
export const snapshotExclusions=['.git','node_modules','.venv','venv','.workbench','_archive','.uploads','__pycache__'];
async function captureFile(file,dir,signal){
 const temporary=path.join(dir,'.capture-'+crypto.randomUUID());const hash=crypto.createHash('sha256');let binary=false,bytes=0;const filter=new Transform({transform(chunk,_encoding,callback){hash.update(chunk);binary||=chunk.includes(0);bytes+=chunk.length;callback(null,chunk)}});
 try{const before=await fsp.stat(file);await pipeline(fs.createReadStream(file),filter,fs.createWriteStream(temporary,{flags:'wx'}),{signal});const after=await fsp.stat(file);if(before.size!==after.size||before.mtimeMs!==after.mtimeMs)throw Error('文件在快照期间变化');const id=hash.digest('hex'),destination=path.join(dir,id);if(fs.existsSync(destination))await fsp.unlink(temporary);else await fsp.rename(temporary,destination);return {hash:id,size:bytes,binary,mtime:after.mtimeMs};}
 catch(error){await fsp.unlink(temporary).catch(()=>{});throw error;}
}
export async function captureSnapshot(root,dataDir){
 const blobs=path.join(dataDir,'snapshots','blobs');await fsp.mkdir(blobs,{recursive:true});const files={},errors=[],excluded=[]; const signal=AbortSignal.timeout(8000);let bytes=0;
 async function walk(dir){let entries;try{entries=await fsp.readdir(dir,{withFileTypes:true});}catch(error){errors.push({path:path.relative(root,dir),error:error.message});return;}
 for(const entry of entries){if(signal.aborted){errors.push({path:path.relative(root,dir),error:"快照达到 8 秒限制，范围不完整"});return;}const absolute=path.join(dir,entry.name),relative=path.relative(root,absolute);if(snapshotExclusions.includes(entry.name)||entry.isSymbolicLink()){excluded.push(relative);continue;}if(entry.name.includes('.santi-')&&entry.name.endsWith('.tmp'))continue;
 if(entry.isDirectory())await walk(absolute);else if(entry.isFile()){try{const stat=await fsp.stat(absolute);if(stat.size>8*1024*1024||bytes+stat.size>64*1024*1024||Object.keys(files).length>=3000){errors.push({path:relative,error:"超出快照文件大小或总范围限制"});continue;}bytes+=stat.size;files[relative]=await captureFile(absolute,blobs,signal);}catch(error){errors.push({path:relative,error:error.message});}}
 }}await walk(root);return {files,excluded,errors,incomplete:errors.length>0,blobs,at:Date.now()};
}
async function createPatch(left,right,output){
 await new Promise((resolve,reject)=>{const out=fs.createWriteStream(output),child=spawn('git',['diff','--no-index','--no-ext-diff','--binary','--no-color','--',left,right],{cwd:path.dirname(output),windowsHide:true,stdio:['ignore','pipe','pipe']});let error='';child.stdout.pipe(out);child.stderr.on('data',b=>error+=b.toString().slice(0,2000));child.on('error',reject);child.on('close',code=>out.end(()=>code===0||code===1?resolve():reject(Error(error||'Git 无法生成差异'))));out.on('error',reject);});
}
export async function compareCaptured(before,after,dataDir,taskId){
 const dir=path.join(dataDir,'snapshots','diffs',taskId);await fsp.mkdir(dir,{recursive:true});const empty=path.join(after.blobs,crypto.createHash('sha256').update('').digest('hex'));if(!fs.existsSync(empty))await fsp.writeFile(empty,'');const changes=[];
 for(const relative of new Set([...Object.keys(before.files),...Object.keys(after.files)])){
  const a=before.files[relative],b=after.files[relative];if(a&&b&&a.hash===b.hash)continue;const patchFile=path.join(dir,crypto.createHash('sha256').update(relative).digest('hex')+'.patch');const record={path:relative,status:!a?'added':!b?'deleted':'modified',binary:!!(a?.binary||b?.binary),beforeHash:a?.hash,afterHash:b?.hash,beforeSize:a?.size||0,afterSize:b?.size||0,patchFile};
  try{await createPatch(a?path.join(before.blobs,a.hash):empty,b?path.join(after.blobs,b.hash):empty,patchFile);record.patchBytes=(await fsp.stat(patchFile)).size;if(record.patchBytes<=65536)record.patch=await fsp.readFile(patchFile,'utf8');else record.patchPreview='差异已完整保存，点击分段查看或下载。';}catch(error){record.patchError=error.message;}
  changes.push(record);
 }
 return {changes,incomplete:before.incomplete||after.incomplete,textIncomplete:false,coverage:{filesBefore:Object.keys(before.files).length,filesAfter:Object.keys(after.files).length,excluded:[...new Set([...before.excluded,...after.excluded])],errors:[...before.errors,...after.errors],contentHashed:true,fullContentStored:true}};
}
