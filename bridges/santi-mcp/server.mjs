import http from 'node:http';
import https from 'node:https';
import fs from 'node:fs';
import crypto from 'node:crypto';
import {StdioServerTransport} from '@modelcontextprotocol/sdk/server/stdio.js';
import {StreamableHTTPServerTransport} from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import {createServer} from './tools.mjs';
import {token} from './backend.mjs';

if(!process.argv.includes('--http')){
 const server=createServer();await server.connect(new StdioServerTransport());
}else{
 const host=process.env.SANTI_MCP_HOST||'127.0.0.1',port=Number(process.env.SANTI_MCP_PORT||7790);
 const tls=process.env.SANTI_TLS_CERT&&process.env.SANTI_TLS_KEY;
 if(!['127.0.0.1','::1','localhost'].includes(host)&&!tls)throw Error('非回环监听必须设置 SANTI_TLS_CERT / SANTI_TLS_KEY；也可使用回环端口 + HTTPS 反向代理或 SSH 隧道');
 const origin=process.env.SANTI_PUBLIC_URL?new URL(process.env.SANTI_PUBLIC_URL).origin:null;
 if(origin&&!origin.startsWith('https://'))throw Error('SANTI_PUBLIC_URL 必须为 HTTPS');
 const hosts=new Set([`127.0.0.1:${port}`,`localhost:${port}`,`[::1]:${port}`,...(origin?[new URL(origin).host]:[])]);
 async function handle(req,res){
  try{
   if(req.url!=='/mcp'){res.writeHead(404).end();return;}
   if(!hosts.has(req.headers.host)||req.headers.origin&&req.headers.origin!==origin){res.writeHead(403).end();return;}
   const actual=Buffer.from(req.headers.authorization||''),expected=Buffer.from('Bearer '+token);
   if(actual.length!==expected.length||!crypto.timingSafeEqual(actual,expected)){res.writeHead(401,{'WWW-Authenticate':'Bearer realm="santi-console"'}).end();return;}
   if(req.method!=='POST'){res.writeHead(405,{Allow:'POST'}).end();return;}
   let raw='';for await(const chunk of req){raw+=chunk;if(raw.length>10*1024*1024){res.writeHead(413).end();return;}}
   let message;try{message=JSON.parse(raw);}catch{res.writeHead(400,{'content-type':'application/json'}).end(JSON.stringify({jsonrpc:'2.0',id:null,error:{code:-32700,message:'Parse error'}}));return;}
   const server=createServer(),transport=new StreamableHTTPServerTransport({sessionIdGenerator:undefined,enableJsonResponse:true});
   res.on('close',()=>{transport.close();server.close();});await server.connect(transport);await transport.handleRequest(req,res,message);
  }catch(e){if(!res.headersSent)res.writeHead(500,{'content-type':'application/json'}).end(JSON.stringify({error:'MCP request failed'}));else res.end();console.error(e.message);}
 }
 const service=tls?https.createServer({cert:fs.readFileSync(process.env.SANTI_TLS_CERT),key:fs.readFileSync(process.env.SANTI_TLS_KEY)},handle):http.createServer(handle);
 service.listen(port,host,()=>console.error(`Santi MCP ${tls?'HTTPS':'HTTP'} listening on ${host}:${port}/mcp; bearer required`));
}
