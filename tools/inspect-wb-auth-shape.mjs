import os from 'node:os';const HOME=os.homedir().split(String.fromCharCode(92)).join('/');
import fs from 'node:fs';import path from 'node:path';import {resolveCli} from '../bridges/wb-bridge/paths.mjs';
const files=[HOME+'/.workbuddy/settings.json',HOME+'/AppData/Local/CodeBuddyExtension/Data/Public/auth/workbuddy-desktop.info'];for(const f of files){try{const j=JSON.parse(fs.readFileSync(f,'utf8'));const shape=o=>o&&typeof o==='object'?Object.fromEntries(Object.entries(o).map(([k,v])=>[k,v&&typeof v==='object'?Object.keys(v):typeof v])):typeof o;console.log(JSON.stringify({file:f,shape:shape(j),mtime:fs.statSync(f).mtime}));}catch(e){console.log(JSON.stringify({file:f,error:e.code||e.name}));}}
const root=path.resolve(path.dirname(resolveCli()),'../dist');console.log(JSON.stringify({dist:fs.readdirSync(root).filter(f=>/lite|acp|auth/.test(f)).slice(0,12)}));

