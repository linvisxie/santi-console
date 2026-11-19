import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';

export function automationToken(appDir) {
  const file=process.env.SANTI_TOKEN_FILE||path.join(appDir,'.mcp','token');
  fs.mkdirSync(path.dirname(file),{recursive:true});
  try {
    fs.writeFileSync(file,crypto.randomBytes(32).toString('hex'),{flag:'wx',mode:0o600});
  }catch(e){if(e.code!=='EEXIST')throw e;}
    if(process.platform==='win32'){
      const identity=execFileSync('whoami',['/user','/fo','csv','/nh'],{encoding:'utf8',windowsHide:true});const sid=identity.match(/S-1-\d+(?:-\d+)+/i)?.[0];
      if(!sid)throw Error('无法识别当前 Windows 用户，未启用 MCP');
      execFileSync('icacls',[file,'/inheritance:r','/grant:r',`*${sid}:F`,'*S-1-5-18:F'],{windowsHide:true,stdio:'ignore'});
    }
  const token=fs.readFileSync(file,'utf8').trim();if(token.length<32)throw Error('MCP 连接凭证过短');return token;
}
export class UiControl {
  constructor(token){this.token=token;this.windows=new Map();this.pending=new Map();}
  authorized(req){const expected=Buffer.from('Bearer '+this.token),actual=Buffer.from(req.headers.authorization||'');return expected.length===actual.length&&crypto.timingSafeEqual(expected,actual);}
  list(){return [...this.windows.values()].filter(w=>Date.now()-w.at<10000).map(({id,at,state})=>({windowId:id,observedAt:at,state}));}
  poll({windowId,state,result}){
    if(typeof windowId!=='string'||windowId.length>100)throw Error('窗口 ID 无效');
    for(const [id,w]of this.windows)if(Date.now()-w.at>60000)this.windows.delete(id);
    if(!this.windows.has(windowId)&&this.windows.size>=16)throw Error('界面连接数量已达上限');
    this.windows.set(windowId,{id:windowId,at:Date.now(),state});
    if(result){const pending=this.pending.get(result.id);if(pending&&pending.windowId===windowId){clearTimeout(pending.timer);this.pending.delete(result.id);pending.resolve(result);}}
    const command=[...this.pending.values()].find(p=>p.windowId===windowId&&!p.delivered);
    if(command){command.delivered=true;return {id:command.id,action:command.action,args:command.args,expiresAt:command.expiresAt};}return null;
  }
  command(input){
    const windows=this.list();const id=input.windowId||(windows.length===1?windows[0].windowId:null);
    if(!id)throw Error(windows.length?'有多个窗口，请传 windowId':'没有在线界面，请打开三体并加载新版页面');
    if(!windows.some(w=>w.windowId===id))throw Error('指定窗口已离线');
    if([...this.pending.values()].some(p=>p.windowId===id))throw Error('该窗口有操作尚未返回，请先读取状态');
    return new Promise(resolve=>{const command={id:crypto.randomUUID(),windowId:id,action:input.action,args:input.args||{},expiresAt:Date.now()+20000,resolve};
      command.timer=setTimeout(()=>{this.pending.delete(command.id);resolve({id:command.id,ok:false,error:'界面操作未在 20 秒内返回；结果未知，请读取状态后决定是否重试',outcome:'unknown'});},20000);
      this.pending.set(command.id,command);
    });
  }
}
