import fs from 'node:fs';import {syncBuiltinESMExports} from 'node:module';
const interesting=p=>typeof p==='string'&&(/[/\\]auth[/\\].*\.info/.test(p)||/product\.json$/.test(p));
for(const name of ['readFileSync','existsSync']){const original=fs[name];fs[name]=function(p,...args){if(interesting(p))fs.appendFileSync('D:/santi-console/tools/.qa-completion-20261101/auth-paths.jsonl',JSON.stringify({op:name,path:p})+'\n');return original.call(this,p,...args)}}
const read=fs.promises.readFile.bind(fs.promises);fs.promises.readFile=async function(p,...args){if(interesting(p))fs.appendFileSync('D:/santi-console/tools/.qa-completion-20261101/auth-paths.jsonl',JSON.stringify({op:'readFile',path:p})+'\n');return read(p,...args)};syncBuiltinESMExports();
