import fs from 'node:fs';import path from 'node:path';import {spawn} from 'node:child_process';
const root=path.resolve(import.meta.dirname,'../..'),source=path.join(root,'runtime'),target=path.join(root,'tools/.qa-mcp-runtime');
fs.mkdirSync(path.join(target,'resources/app'),{recursive:true});
for(const f of fs.readdirSync(source,{withFileTypes:true}).filter(f=>f.isFile()&&!f.name.includes('icon-stage'))){const dest=path.join(target,f.name);if(!fs.existsSync(dest))fs.linkSync(path.join(source,f.name),dest);}
if(!fs.existsSync(path.join(target,'locales')))fs.symlinkSync(path.join(source,'locales'),path.join(target,'locales'),'junction');
fs.writeFileSync(path.join(target,'resources/app/package.json'),JSON.stringify({name:'santi-mcp-test',main:'../../../verify-mcp-ui.cjs'}));
const started=Date.now();
const child=spawn(path.join(target,'三体控制台.exe'),[],{windowsHide:true,stdio:'ignore'});
const code=await new Promise((resolve,reject)=>{child.on('error',reject);child.on('exit',resolve);});
const resultFile=path.join(root,'tools/mcp-test-results.json');if(fs.statSync(resultFile).mtimeMs<started)throw Error('验证进程未生成本次结果');
const result=JSON.parse(fs.readFileSync(resultFile,'utf8'));console.log(JSON.stringify({passed:result.passed,checks:result.checks.length,error:result.error}));process.exitCode=code||(!result.passed?1:0);
