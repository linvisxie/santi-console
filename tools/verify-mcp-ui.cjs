const {app,BrowserWindow,ipcMain}=require('electron');const fs=require('node:fs'),path=require('node:path'),{pathToFileURL}=require('node:url'),{spawn}=require('node:child_process');
const root=path.resolve(__dirname,'..'),dir=fs.mkdtempSync(path.join(__dirname,'.qa-mcp-')),node=process.env.CONSOLE_NODE_BIN||'node';
app.setPath('userData',path.join(dir,'electron'));app.commandLine.appendSwitch('no-sandbox');app.commandLine.appendSwitch('disable-gpu-sandbox');
const env={...process.env,CONSOLE_PORT:'7827',CONSOLE_DATA_HOME:dir,CONSOLE_WORKBENCH_DIR:path.join(dir,'worker'),CONSOLE_STATE_FILE:path.join(dir,'state.json'),CONSOLE_IDENTITY_FILE:path.join(dir,'identity.json'),CONSOLE_TEST_MODE:'1',CONSOLE_TEST_ADAPTER:pathToFileURL(path.join(__dirname,'workbench-fake-adapter.mjs')).href,SANTI_TOKEN_FILE:path.join(dir,'mcp-token'),SANTI_URL:'http://127.0.0.1:7827',SANTI_MCP_PORT:'7797'};
const delay=ms=>new Promise(r=>setTimeout(r,ms));let service,http,win;
app.whenReady().then(async()=>{let code=1;try{
 service=spawn(node,[path.join(root,'runtime/resources/app/server.mjs')],{env,windowsHide:true,stdio:'ignore'});
 for(let i=0;i<100;i++){try{if((await fetch('http://127.0.0.1:7827/api/identify')).ok)break;}catch{}await delay(200);}
 http=spawn(node,[path.join(root,'bridges/santi-mcp/server.mjs'),'--http'],{env,windowsHide:true,stdio:'ignore'});
 win=new BrowserWindow({width:1280,height:800,show:false,webPreferences:{sandbox:false,offscreen:true,backgroundThrottling:false,preload:path.join(root,'runtime/resources/app/preload.js')}});
 ipcMain.handle('console:capture-view',async event=>{if(event.sender!==win.webContents)throw Error('wrong sender');return (await win.webContents.capturePage()).toPNG().toString('base64');});
 ipcMain.handle('console:window-state',()=>({maximized:win.isMaximized()}));
 ipcMain.handle('console:window-command',(_event,action)=>{if(action==='minimize')win.minimize();else if(action==='maximize'){win.isMaximized()?win.unmaximize():win.maximize();}return {maximized:win.isMaximized()};});
 await win.loadURL('http://127.0.0.1:7827');await delay(2000);
 const test=spawn(node,[path.join(root,'bridges/santi-mcp/test.mjs')],{env,windowsHide:true,stdio:['ignore','pipe','pipe']});let log='';test.stdout.on('data',d=>log+=d);test.stderr.on('data',d=>log+=d);code=await new Promise(r=>test.on('exit',r));fs.writeFileSync(path.join(__dirname,'mcp-test.log'),log);
 // Real paint and frame measurements with the moving sheen, without model activity.
 await win.webContents.executeJavaScript("applyTheme('dark');applyPerf('full');document.getElementById('wb-task-drawer').hidden=true;showMonitor(false)");
 const before=await win.webContents.capturePage();await delay(2200);const after=await win.webContents.capturePage();
 fs.writeFileSync(path.join(__dirname,'glass-flow-a.png'),before.toPNG());fs.writeFileSync(path.join(__dirname,'glass-flow-b.png'),after.toPNG());
 const frames=await win.webContents.executeJavaScript(`new Promise(resolve=>{const deltas=[];let last=performance.now(),end=last+4000;function step(now){deltas.push(now-last);last=now;if(now<end)requestAnimationFrame(step);else resolve({frames:deltas.length,meanMs:deltas.reduce((a,b)=>a+b,0)/deltas.length,maxMs:Math.max(...deltas),animation:getComputedStyle(document.querySelector('.composer'),'::after').animationName});}requestAnimationFrame(step);})`);
 fs.writeFileSync(path.join(__dirname,'glass-flow-results.json'),JSON.stringify({...frames,differentPaint:!before.toPNG().equals(after.toPNG()),scope:'4 second isolated offscreen Electron sample; not long-run native window FPS'},null,2));
 const caption=await win.webContents.executeJavaScript(`(()=>{const bar=document.querySelector('.window-controls');return {transparent:getComputedStyle(bar).backgroundColor==='rgba(0, 0, 0, 0)',buttons:[...bar.querySelectorAll('button')].map(e=>({id:e.id,label:e.getAttribute('aria-label'),background:getComputedStyle(e).backgroundColor,hit:e.contains(document.elementFromPoint(e.getBoundingClientRect().x+23,17))}))};})()`);
 fs.writeFileSync(path.join(__dirname,'window-controls-results.json'),JSON.stringify(caption,null,2));
}catch(e){fs.writeFileSync(path.join(__dirname,'mcp-test-harness-error.txt'),e.stack);}finally{win?.destroy();service?.kill();http?.kill();try{const w=JSON.parse(fs.readFileSync(path.join(dir,'worker/worker.json')));process.kill(w.pid);}catch{}app.exit(code||0);}});
