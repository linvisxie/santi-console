const {app,BrowserWindow}=require('electron'),fs=require('node:fs'),path=require('node:path');
const dir=fs.mkdtempSync(path.join(__dirname,'.qa-caption-')),root=path.resolve(__dirname,'..'),results={checks:[],scope:'Actual main.js and preload IPC in isolated hidden Electron window; no native mouse input.'};
Object.assign(process.env,{CONSOLE_QA:'1',CONSOLE_PORT:'7828',CONSOLE_INSTANCE_DIR:path.join(dir,'electron'),CONSOLE_DATA_HOME:dir,CONSOLE_WORKBENCH_DIR:path.join(dir,'worker'),CONSOLE_STATE_FILE:path.join(dir,'state.json'),CONSOLE_IDENTITY_FILE:path.join(dir,'identity.json'),SANTI_TOKEN_FILE:path.join(dir,'token')});
const report=()=>fs.writeFileSync(path.join(__dirname,'caption-native-results.json'),JSON.stringify(results,null,2));
const delay=ms=>new Promise(r=>setTimeout(r,ms)),check=(name,v)=>{if(!v)throw Error(name);results.checks.push(name);};
app.on('browser-window-created',(_e,win)=>win.webContents.once('did-finish-load',async()=>{
 try{
  await delay(1800);const ev=s=>win.webContents.executeJavaScript(s);
  check('actual preload exposes window controls',await ev('!!consoleNative.windowCommand'));
  check('caption bar transparent',await ev("getComputedStyle(document.querySelector('.window-controls')).backgroundColor==='rgba(0, 0, 0, 0)'"));
  const before=win.isMaximized();await ev("consoleNative.windowCommand('maximize')");await delay(150);check('maximize or restore toggles native window',win.isMaximized()!==before);
  await ev("consoleNative.windowCommand('maximize')");await delay(150);check('toggle restores original native state',win.isMaximized()===before);
  await ev("consoleNative.windowCommand('minimize')");await delay(150);check('minimize acts on native window',win.isMinimized());win.restore();
  check('native screenshot IPC returns PNG',(await ev('consoleNative.captureView()')).startsWith('iVBOR'));
  win.once('closed',()=>{results.checks.push('close destroys only test window');results.passed=true;report();});
  await ev("consoleNative.windowCommand('close')").catch(()=>{});
 }catch(error){results.passed=false;results.error=error.stack;report();app.quit();}
}));
app.on('will-quit',()=>{try{const info=JSON.parse(fs.readFileSync(path.join(dir,'worker/worker.json')));process.kill(info.pid);}catch{}});
setTimeout(()=>{if(!results.passed&&!results.error){results.passed=false;results.error='Native window test timed out';report();app.quit();}},30000).unref();
require(path.join(root,'runtime/resources/app/main.js'));
