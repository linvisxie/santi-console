/* Explicit, observed UI commands. No arbitrary JS evaluation or selector execution. */
(() => {
  const windowId=crypto.randomUUID();let result=null,stopped=false;let controls=new Map();
  const visible=e=>{if(!e||!e.getClientRects().length||e.closest('[hidden]')||!e.checkVisibility({checkOpacity:true,checkVisibilityCSS:true}))return false;const r=e.getBoundingClientRect(),w=e.ownerDocument.defaultView;return r.width>0&&r.height>0&&r.bottom>0&&r.right>0&&r.top<w.innerHeight&&r.left<w.innerWidth;};
  function snapshot(){
    const monitor=document.body.dataset.view==='monitor';const frame=document.getElementById('monitor-frame');
    let doc=document;if(monitor)try{doc=frame.contentDocument||document;}catch{}
    controls=new Map();let n=0;
    const items=[...doc.querySelectorAll('button,input,textarea,select,summary,[role="button"],a[href]')].filter(visible).slice(0,240).map(e=>{
      const id=e.id||'control-'+(++n);controls.set(id,e);
      return {id,tag:e.tagName.toLowerCase(),label:(e.getAttribute('aria-label')||e.textContent||e.title||e.placeholder||'').trim().slice(0,120),disabled:!!e.disabled,value:['INPUT','TEXTAREA','SELECT'].includes(e.tagName)&&e.type!=='password'?e.value:undefined};
    });
    return {windowId,view:monitor?'monitor':'workbench',theme:document.documentElement.dataset.theme,performance:document.documentElement.dataset.perf,
      project:S.project?{path:S.project.path,name:S.project.name,agent:S.project.agent}:null,conversationId:workbench.selected?.id||null,nativeSessionId:workbench.historicalId||null,
      composer:{agent:S.agent,model:S.model,effort:S.effort,mode:S.mode,text:document.getElementById('prompt').value,attachments:S.atts,references:workbench.references},
      panels:{inspector:document.getElementById('shell').dataset.inspector,tab:S.tab,tasks:!document.getElementById('wb-task-drawer').hidden,settings:!document.getElementById('sheet').hidden,files:!document.getElementById('wb-workspace').hidden},
      visibleText:(monitor?[...doc.querySelectorAll('.topbar,.stage,.panel')]:[...document.getElementById('messages').children]).filter(visible).map(e=>e.innerText.slice(0,10000)).join('\n').slice(0,20000),controls:items};
  }
  async function act(action,a){
    if(action==='snapshot')return snapshot();
    if(action==='screenshot'){if(!window.consoleNative?.captureView)throw Error('当前界面不支持截图，请重开正式桌面程序');return {image:await window.consoleNative.captureView()};}
    if(action==='view'){if(!['monitor','workbench'].includes(a.view))throw Error('view 无效');showMonitor(a.view==='monitor');}
    else if(action==='theme'){if(!['dark','light'].includes(a.theme))throw Error('theme 无效');applyTheme(a.theme);}
    else if(action==='performance'){if(!['full','lite'].includes(a.mode))throw Error('mode 无效');applyPerf(a.mode);}
    else if(action==='project'){await loadProjects({silent:true});const p=S.projects.find(p=>p.path.toLowerCase()===String(a.path).toLowerCase()&&(!a.agent||a.agent===p.agent));if(!p)throw Error('项目不存在，请先使用 project_manage 添加');showMonitor(false);selectProject(p);}
    else if(action==='conversation'){showMonitor(false);await workbench.sync();if(!workbench.state.conversations.some(c=>c.id===a.id))throw Error('工作会话不存在');await workbench.open(a.id);if(workbench.selected?.id!==a.id)throw Error('未能打开会话');}
    else if(action==='native_session'){await loadProjects({silent:true});const p=S.projects.find(p=>p.sessions?.some(s=>s.id===a.id));if(!p)throw Error('原生会话不存在');showMonitor(false);await openThread(a.id,p);}
    else if(action==='new_conversation'){if(!S.project)throw Error('请先选择项目');showMonitor(false);await workbench.newConversation(S.project);}
    else if(action==='panel'){
      if(typeof a.open!=='boolean')throw Error('open 必须为布尔值');
      if(a.panel==='inspector')setInspector(a.open);
      else if(a.panel==='tasks'){document.getElementById('wb-task-drawer').hidden=!a.open;workbench.drawTasks();}
      else if(a.panel==='settings')openSheet(a.open);
      else if(a.panel==='files'){if(a.open)await workbench.showFiles();else document.getElementById('wb-file-close').click();}
      else throw Error('panel 无效');
    }
    else if(action==='draft'){const e=document.getElementById('prompt');e.value=String(a.text||'');e.dispatchEvent(new Event('input',{bubbles:true}));}
    else if(action==='scroll'){const e=document.getElementById(a.region==='projects'?'projects':'messages');e.scrollTop=a.position==='bottom'?e.scrollHeight:a.position==='top'?0:Number(a.offset)||0;}
    else if(action==='file'){if(!S.project)throw Error('未选择项目');workbench.openFilePanel();await workbench.viewFile(a.path,a.line);}
    else if(action==='refresh'){await loadProjects({silent:true});await workbench.sync();}
    else if(action==='activate'||action==='fill'){
      const e=controls.get(a.controlId);if(!visible(e)||e.disabled)throw Error('控件已失效，请重新获取界面状态');
      const label=(e.getAttribute('aria-label')||e.textContent||e.title||e.placeholder||'').trim().slice(0,120);
      if(a.expectedLabel!==label)throw Error('控件文本已变化，请重新获取界面状态');
      if(action==='activate')e.click();else{if(!['INPUT','TEXTAREA','SELECT'].includes(e.tagName)||e.type==='file'||e.type==='password')throw Error('该控件不支持文本填写');e.value=String(a.value||'');e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));}
    } else throw Error('不支持的界面操作');
    await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));return snapshot();
  }
  async function loop(){
    if(stopped)return;
    try{const response=await fetch('/api/ui/poll',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({windowId,state:snapshot(),result})});if(!response.ok)throw Error('UI channel unavailable');result=null;
      const {command}=await response.json();if(command){try{if(Date.now()>command.expiresAt)throw Error('操作已过期，未执行');const data=await act(command.action,command.args);result={id:command.id,ok:true,data};}catch(e){result={id:command.id,ok:false,error:e.message};}}
    }catch{}finally{if(!stopped)setTimeout(loop,result?30:1500);}
  }
  window.addEventListener('pagehide',()=>{stopped=true;});loop();
})();
