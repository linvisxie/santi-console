const {app,BrowserWindow}=require('electron');
const fs=require('node:fs'),path=require('node:path'),{spawn}=require('node:child_process');
const root=path.resolve(__dirname,'..'),dir=path.join(__dirname,'.qa-visual-refinement');
fs.mkdirSync(dir,{recursive:true});app.setPath('userData',path.join(dir,'electron'));
app.commandLine.appendSwitch('no-sandbox');app.commandLine.appendSwitch('disable-gpu-sandbox');
let server,win;const results={checks:[],errors:[],screenshots:[],scope:'Isolated Electron renderer + isolated data/worker. UI fixtures only; no model executions or production data writes.'};
const delay=ms=>new Promise(r=>setTimeout(r,ms));
function check(name,ok){results.checks.push({name,ok});if(!ok)throw Error(name);}
app.whenReady().then(async()=>{
 try {
 server=spawn('C:/Users/<user>/AppData/Local/Programs/nodejs/node.exe',[path.join(root,'runtime/resources/app/server.mjs')],{windowsHide:true,env:{...process.env,CONSOLE_PORT:'7826',CONSOLE_DATA_HOME:dir,CONSOLE_WORKBENCH_DIR:path.join(dir,'worker'),CONSOLE_STATE_FILE:path.join(dir,'state.json'),CONSOLE_IDENTITY_FILE:path.join(dir,'server.json')},stdio:'ignore'});
 for(let i=0;i<80;i++){try{if((await fetch('http://127.0.0.1:7826/')).ok)break;}catch{}await delay(250);}
 win=new BrowserWindow({width:1440,height:900,show:false,webPreferences:{sandbox:false,offscreen:true,backgroundThrottling:false}});
 const web=win.webContents,ev=s=>web.executeJavaScript(s);web.on('console-message',(_e,level,msg)=>{if(level===3)results.errors.push(msg);});
 await web.session.clearCache();await win.loadURL('http://127.0.0.1:7826');
 for(let i=0;i<60;i++){if(await ev('!!window.workbench?.ready'))break;await delay(250);}
 check('workbench initialized',await ev('!!workbench.ready'));
 await ev(`document.querySelector('#proj-name').textContent='三体控制台';document.querySelector('#proj-path').textContent='D:\\santi-console';`);
 const shot=async name=>{await delay(250);const f=path.join(__dirname,'visual-'+name+'.png');fs.writeFileSync(f,(await web.capturePage()).toPNG());results.screenshots.push(f);};
 for(const theme of ['dark','light']){
  await ev(`applyTheme('${theme}')`);await shot(theme+'-empty');
  check(theme+' palette loaded',await ev(`getComputedStyle(document.documentElement).getPropertyValue('--reading-width').trim()==='880px'`));
  await ev(`document.getElementById('wb-tasks').click()`);
  check(theme+' empty task guidance',await ev(`!!document.querySelector('#wb-task-list .wb-empty-state')`));
  check(theme+' drawer close hit region',await ev(`(()=>{let e=document.getElementById('wb-drawer-close'),r=e.getBoundingClientRect();return [0.2,0.5,0.8].every(p=>e.contains(document.elementFromPoint(r.left+r.width/2,r.top+r.height*p)))})()`));
  await shot(theme+'-drawer');await ev(`document.getElementById('wb-drawer-close').click()`);
  check(theme+' closes',await ev(`document.getElementById('wb-task-drawer').hidden`));
  await ev(`document.getElementById('wb-more').click()`);await delay(250);
  check(theme+' menu bounds',await ev(`(()=>{let r=document.getElementById('wb-more-menu').getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&r.bottom<=innerHeight})()`));
  await shot(theme+'-menu');await ev(`document.getElementById('wb-more-menu').hidePopover()`);
 }
 await ev(String.raw`applyTheme('dark');document.querySelector('#messages').innerHTML='<article class="msg user"><div class="msg-head">你 · 10:42</div><div class="msg-body">让工作台更美观、更成熟。保留液态玻璃的通透感，也让长时间阅读更舒服。</div></article><article class="msg assistant codex"><div class="msg-head">Codex · 10:43</div><div class="msg-body"><p>这次从材质、布局和阅读体验三个方面打磨工作台。</p><h3 class="md-h">清晰的层次，恰到好处的透光</h3><p>导航与输入区保留轻盈的玻璃感；内容区减少装饰，给文字留出空间。浮动面板使用更厚的磨砂底色，让操作更清晰。</p><ul><li>统一冰蓝、青色与香槟色的品牌色调</li><li>项目、会话与任务形成有序的信息层级</li><li>保留完整内容、输入文案和既有操作习惯</li></ul><pre class="cb"><code>const workspace = {\n  theme: "liquid-glass",\n  focus: "your work"\n};</code></pre><p>明暗主题、键盘焦点与减少动效模式同步适配。</p></div></article>'`);
 await shot('dark-reading');await ev(`applyTheme('light')`);await shot('light-reading');
 for(const width of [1440,1280,1024,800]){
  win.setContentSize(width,800);await delay(200);
  check('no horizontal overflow '+width,await ev('document.documentElement.scrollWidth<=innerWidth'));
  check('send visible '+width,await ev(`(()=>{let r=document.getElementById('btn-send').getBoundingClientRect();return r.right<=innerWidth&&r.bottom<=innerHeight&&r.width>0})()`));
  check('toolbar row '+width,await ev(`(()=>{const a=[...document.querySelectorAll('.wb-actions>button')].map(e=>e.getBoundingClientRect());return a.every(r=>Math.abs(r.top-a[0].top)<1)&&a.at(-1).right<innerWidth})()`));
 }
 await shot('800-reading');win.setContentSize(1440,900);
 check('composer text preserved',await ev(`document.getElementById('prompt').placeholder==='让 Codex 做什么？Enter 发送，Shift+Enter 换行'`));
 await ev(`document.documentElement.dataset.perf='lite'`);check('lite blur off',await ev(`getComputedStyle(document.querySelector('.composer')).backdropFilter==='none'`));
 await ev(`document.documentElement.dataset.perf='full'`);
 web.debugger.attach('1.3');await web.debugger.sendCommand('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-transparency',value:'reduce'},{name:'prefers-reduced-motion',value:'reduce'}]});
 check('reduced transparency',await ev(`getComputedStyle(document.querySelector('.composer')).backdropFilter==='none'`));
 await ev(`document.getElementById('wb-tasks').click()`);
 check('reduced motion',await ev(`getComputedStyle(document.getElementById('wb-task-drawer')).animationName==='none'`));
 await ev(`document.getElementById('btn-view-monitor').click()`);
 check('drawer not carried to monitor',await ev(`document.getElementById('wb-task-drawer').hidden`));
 await web.debugger.sendCommand('Emulation.setEmulatedMedia',{features:[]});web.debugger.detach();
 await win.loadURL('http://127.0.0.1:7826/monitor/');await delay(1500);
 for(const theme of ['dark','light']){await ev(`document.documentElement.dataset.theme='${theme}'`);await shot(theme+'-monitor');check(theme+' monitor no horizontal overflow',await ev('document.documentElement.scrollWidth<=innerWidth'));}
 for(const width of [1280,1024,800]){win.setContentSize(width,800);await delay(200);check('monitor overflow '+width,await ev('document.documentElement.scrollWidth<=innerWidth'));}
 check('no renderer errors',results.errors.length===0);results.passed=true;
 }catch(e){results.passed=false;results.failure=e.stack;}
 finally{fs.writeFileSync(path.join(__dirname,'visual-refinement-results.json'),JSON.stringify(results,null,2));win?.destroy();server?.kill();app.exit(results.passed?0:1);}
});
