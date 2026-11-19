/* 日常工作台：持久会话、任务事件、输入上下文、文件与验收。 */
(() => {
  const API='/api/workbench';
  const el=id=>document.getElementById(id);
  const labels={queued:'排队中',starting:'启动中',running:'执行中',waiting:'等待你确认',stopping:'正在停止',stopped:'已停止',finished:'本轮执行结束',failed:'执行失败',interrupted:'执行中断'};
  const activeStates=new Set(['queued','starting','running','waiting','stopping']);
  const wb={selected:null,historicalId:null,state:{tasks:[],conversations:[],capabilities:{}},events:new Map(),nodes:new Map(),references:[],generation:0,readerVersion:0,catalogs:new Map(),base:[],switching:false};
  window.workbench=wb;
  const call=async(route,method='GET',body)=>{const response=await fetch(API+route,{method,headers:{'content-type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});const value=await response.json();if(!response.ok)throw new Error(value.error||`服务返回 ${response.status}`);return value;};
  const safe=fn=>(...args)=>Promise.resolve().then(()=>fn(...args)).catch(error=>notify(error.message,true));
  const icon=paths=>`<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.45" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
  const icons={new:icon('<path d="M10 4v12M4 10h12"/>'),files:icon('<path d="M3 6V4.5A1.5 1.5 0 0 1 4.5 3h4l2 2h5A1.5 1.5 0 0 1 17 6.5V15a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6Z"/>'),tasks:icon('<rect x="4" y="3" width="12" height="14" rx="2"/><path d="m7 8 1 1 2-2m-3 6 1 1 2-2m2-4h1m-1 5h1"/>'),more:icon('<circle cx="4" cy="10" r=".8"/><circle cx="10" cy="10" r=".8"/><circle cx="16" cy="10" r=".8"/>')};
  el('thread-bar').insertAdjacentHTML('afterend','<div class="wb-bar" id="wb-bar"><span id="wb-context">新会话</span></div>');
  document.querySelector('.head-right').insertAdjacentHTML('afterbegin',`<nav class="wb-actions" aria-label="会话操作"><button id="wb-new" class="wb-action wb-primary" title="新建会话 · Ctrl+N">${icons.new}<span>新会话</span></button><button id="wb-files" class="wb-action" title="浏览项目文件">${icons.files}<span>文件</span></button><button id="wb-tasks" class="wb-action" title="查看任务和审批">${icons.tasks}<span>任务</span><b id="wb-count" hidden>0</b></button><button id="wb-more" class="wb-action wb-more" popovertarget="wb-more-menu" aria-haspopup="menu" aria-expanded="false" aria-label="更多会话操作" title="更多操作">${icons.more}</button></nav><span class="wb-head-divider" aria-hidden="true"></span>`);
  el('wb-bar').append(el('run-state'));
  document.body.insertAdjacentHTML('beforeend',`<div id="wb-more-menu" class="wb-more-menu" popover="auto" role="menu" aria-label="更多会话操作"><div class="wb-menu-label">会话</div><button id="wb-rename" role="menuitem"><span>重命名会话</span></button><button id="wb-export" role="menuitem"><span>导出 Markdown</span><small>.md</small></button><div class="wb-menu-separator" role="separator"></div><button id="wb-process" role="menuitemcheckbox" aria-checked="false"><span>显示执行过程</span><span class="wb-menu-check" aria-hidden="true">✓</span></button></div>`);
  const more=el('wb-more'),moreMenu=el('wb-more-menu');
  function positionMenu(){const rect=more.getBoundingClientRect();moreMenu.style.left=Math.max(8,Math.min(rect.right-216,innerWidth-224))+'px';moreMenu.style.top=Math.min(rect.bottom+8,innerHeight-moreMenu.offsetHeight-8)+'px';}
  moreMenu.addEventListener('toggle',event=>{const open=event.newState==='open';more.setAttribute('aria-expanded',String(open));if(open)positionMenu();});
  moreMenu.addEventListener('click',event=>{if(event.target.closest('button')){moreMenu.hidePopover();if(!document.querySelector('dialog[open]'))more.focus();}});
  moreMenu.addEventListener('keydown',event=>{const items=[...moreMenu.querySelectorAll('button:not(:disabled)')];let index=items.indexOf(document.activeElement);if(['ArrowDown','ArrowUp','Home','End'].includes(event.key)){event.preventDefault();index=event.key==='Home'?0:event.key==='End'?items.length-1:(index+(event.key==='ArrowDown'?1:-1)+items.length)%items.length;items[index]?.focus();}});
  more.addEventListener('keydown',event=>{if(['ArrowDown','ArrowUp'].includes(event.key)){event.preventDefault();moreMenu.showPopover();positionMenu();const items=moreMenu.querySelectorAll('button:not(:disabled)');items[event.key==='ArrowDown'?0:items.length-1]?.focus();}});
  window.addEventListener('resize',()=>{if(moreMenu.matches(':popover-open'))positionMenu();});

  el('prompt').insertAdjacentHTML('beforebegin','<div id="wb-input-context" class="wb-input-context" hidden></div>');
  el('messages').insertAdjacentHTML('afterend','<button id="wb-new-output" class="wb-new-output" hidden>有新消息 ↓</button>');
  document.body.insertAdjacentHTML('beforeend',`<dialog id="wb-switch-dialog" class="wb-dialog wb-switch"><input id="wb-switch-query" placeholder="搜索项目或会话…" autocomplete="off"><div id="wb-switch-list"></div></dialog><section id="wb-task-drawer" class="wb-drawer glass" hidden aria-label="任务与会话"><header><b>任务与会话</b><button id="wb-drawer-close">关闭</button></header><label class="wb-concurrency">同时执行 <select id="wb-concurrency"><option value="1">1 个任务</option><option value="2">2 个任务</option><option value="3">3 个任务</option></select><small>同一会话、同目录写入自动串行</small></label><div id="wb-task-list"></div><details><summary>工作会话 · 最近访问优先 · 包含归档</summary><div id="wb-conversation-list"></div></details></section><dialog id="wb-name-dialog" class="wb-dialog"><form method="dialog"><label>会话名称<input id="wb-name-input" maxlength="120" required></label><footer><button value="cancel">取消</button><button id="wb-name-save" value="save">保存</button></footer></form></dialog>`);
  const pane=document.createElement('div');pane.id='wb-workspace';pane.className='wb-workspace';pane.hidden=true;
  pane.innerHTML='<div class="wb-file-toolbar"><button id="wb-file-up">上一级</button><span id="wb-file-location">项目文件</span><button id="wb-file-close">关闭</button></div><div id="wb-file-list" class="wb-file-list"></div><div class="wb-file-toolbar"><span id="wb-file-name">选择文件查看</span><button id="wb-file-context">加入上下文</button><button id="wb-file-deliverable">标为交付</button><button id="wb-file-reveal">定位文件</button></div><div id="wb-file-preview" class="wb-file-preview"></div>';
  el('inspector').append(pane);
  let fileDirectory='',viewedFile=null;
  const storageKey=()=>wb.selected?'wb-draft:'+wb.selected.id:wb.historicalId?'wb-draft:native:'+wb.historicalId:S.project?'wb-draft:new:'+S.project.agent+'|'+S.project.path:'wb-draft:none';
  function saveDraft(){if(wb.switching)return;STORE.set(storageKey(),{text:el('prompt').value,atts:S.atts,references:wb.references,scroll:el('messages').scrollTop,preview:el('preview-url').value,tab:S.tab,model:S.model,effort:S.effort,mode:S.mode,submission:wb.submission,openFiles:[...S.open],previewSrc:el('preview-frame').getAttribute('src'),inspectorOpen:el('shell').dataset.inspector!=='off',workspaceVisible:!pane.hidden,viewedFile:viewedFile?.relative,directory:fileDirectory,at:Date.now()});}
  function restoreDraft(){const draft=STORE.get(storageKey(),{});el('prompt').value=draft.text||'';S.atts=draft.atts||[];wb.references=draft.references||[];S.mode=draft.mode==='edit'?'edit':'read';el('btn-mode').dataset.mode=S.mode;el('btn-mode').textContent=S.mode==='edit'?'可写':'只读';if(draft.model){S.model=draft.model;S.effort=draft.effort||'';loadModels(S.agent,{model:draft.model,effort:draft.effort});}renderAtts();if(draft.preview)el('preview-url').value=draft.preview;wb.draftScroll=draft.scroll;wb.submission=draft.submission||null;if(wb.submission&&wb.state.tasks.some(task=>task.clientRequestId===wb.submission.id))wb.submission=null;S.open=new Set(draft.openFiles||[]);if(draft.tab){S.tab=draft.tab;el('pane-changes').hidden=S.tab!=='changes';el('pane-preview').hidden=S.tab!=='preview';el('insp-tabs').querySelectorAll('button').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.tab===S.tab)));}if(draft.previewSrc&&/^https?:\/\//i.test(draft.previewSrc))el('preview-frame').src=draft.previewSrc;setInspector(false,false);pane.hidden=true;wb.renderContext();}
  let saveTimer;el('prompt').addEventListener('input',()=>{clearTimeout(saveTimer);saveTimer=setTimeout(saveDraft,150);});
  el('messages').addEventListener('scroll',()=>{clearTimeout(wb.scrollTimer);wb.scrollTimer=setTimeout(saveDraft,200);},{passive:true});
  for(const type of ['wheel','touchstart','pointerdown'])el('messages').addEventListener(type,()=>wb.readerVersion++,{passive:true});
  window.addEventListener('beforeunload',saveDraft);
  wb.beforeProject=p=>{if(!wb.switching&&S.project&&(p.path!==S.project.path||p.agent!==S.project.agent)){saveDraft();wb.selected=null;wb.historicalId=null;wb.base=[];wb.nodes.clear();wb.generation++;}};
  wb.projectSelected=()=>{if(!wb.switching){restoreDraft();wb.bar();}};
  wb.historical=(id,project)=>{saveDraft();wb.selected=null;wb.base=[];wb.historicalId=id;wb.nodes.clear();wb.generation++;restoreDraft();wb.bar();};
  wb.integrateProjects=()=>{
    for(const conversation of wb.state.conversations.filter(c=>(c.nativeId||c.sourceId||c.title!=='新会话'||wb.state.tasks.some(t=>t.conversationId===c.id))&&!c.archived&&!(S.hiddenProjects||[]).some(p=>p.replaceAll('\\','/').toLowerCase()===c.cwd.replaceAll('\\','/').toLowerCase()))){
      const agent=S.agents.find(a=>a.id===conversation.agent);if(!agent)continue;
      let project=agent.projects.find(p=>p.path.toLowerCase()===conversation.cwd.toLowerCase());
      if(!project){project={agent:agent.id,path:conversation.cwd,name:conversation.cwd.split(/[\\/]/).pop(),sessions:[],activeCount:0,sessionCount:0};agent.projects.unshift(project);S.projects.push(project);}
      if(!project.sessions.some(s=>s.id==='workbench:'+conversation.id))project.sessions.unshift({id:'workbench:'+conversation.id,agent:conversation.agent,title:conversation.title,ts:conversation.updatedAt,archived:false,pinned:conversation.pinned});
      project.sessions.sort((a,b)=>Number(b.pinned)-Number(a.pinned)||b.ts-a.ts);project.activeCount=project.sessions.filter(s=>!s.archived).length;project.sessionCount=project.sessions.length;
      agent.projectCount=agent.projects.length;
    }
    for(const agent of S.agents)agent.sessionCount=agent.projects.reduce((sum,p)=>sum+(p.activeCount||0),0);
  };
  wb.archive=safe(async(id,archived)=>{await call('/conversation','PATCH',{id,archived});await wb.sync();await loadProjects({silent:true});notify(archived?'工作会话已归档':'工作会话已恢复');});
  function conversationProject(c){return S.projects.find(p=>p.agent===c.agent&&p.path.toLowerCase()===c.cwd.toLowerCase())||{agent:c.agent,path:c.cwd,name:c.cwd.split(/[\\/]/).pop()};}
  wb.newConversation=safe(async project=>{
    project=project||S.project;if(!project)throw new Error('先选择项目');
    if(!wb.selected&&!wb.historicalId&&S.project?.path===project.path&&S.project?.agent===project.agent){el('prompt').focus();return;}
    saveDraft();wb.switching=true;wb.selected=null;wb.historicalId=null;wb.base=[];wb.baseFiles=[];wb.nodes.clear();wb.generation++;
    if(S.replayTimer){clearInterval(S.replayTimer);S.replayTimer=null;}replayGeneration++;S.replaying=false;S.thread=null;el('thread-bar').hidden=true;
    selectProject(project,{keepFold:true,keepThread:true});S.agent=project.agent;ddAgent?.set(AGENTS,S.agent);loadModels(S.agent);wb.switching=false;
    el('messages').innerHTML='<div class="empty"><h2>开始一段新的对话</h2><p>写下第一条消息后创建会话。</p></div>';
    STORE.set('wb-last-conversation',null);restoreDraft();wb.bar();el('prompt').focus();
  });
  wb.open=safe(async id=>{
    saveDraft();const conversation=wb.state.conversations.find(c=>c.id===id);if(!conversation)throw new Error('工作会话不存在');
    wb.switching=true;wb.selected=conversation;wb.historicalId=null;wb.generation++;wb.nodes.clear();wb.base=[];wb.baseFiles=[];wb.filesExpanded=false;
    if(S.replayTimer){clearInterval(S.replayTimer);S.replayTimer=null;}replayGeneration++;S.replaying=false;S.thread=null;el('thread-bar').hidden=true;
    selectProject(conversationProject(conversation),{keepFold:true,keepThread:true});S.agent=conversation.agent;ddAgent?.set(AGENTS,S.agent);loadModels(S.agent);
    wb.switching=false;el('messages').replaceChildren();restoreDraft();STORE.set('wb-last-conversation',id);
    const generation=wb.generation;
    if(conversation.sourceId&&conversation.historyCount){
      try{const response=await fetch('/api/session?id='+encodeURIComponent(conversation.sourceId));if(!response.ok)throw new Error('原生历史不可读取');const data=await response.json();if(generation!==wb.generation)return;wb.base=(data.messages||[]).slice(0,conversation.historyCount);wb.baseFiles=data.files||[];}catch(error){notify(error.message,true);}
    }
    await wb.hydrate(id);if(generation!==wb.generation||wb.selected?.id!==id)return;await wb.render();if(generation!==wb.generation||wb.selected?.id!==id)return;if(wb.draftScroll!==undefined)el('messages').scrollTop=wb.draftScroll;else el('messages').scrollTop=el('messages').scrollHeight;wb.bar();STORE.set('wb-recent',[id,...STORE.get('wb-recent',[]).filter(value=>value!==id)].slice(0,30));wb.drawTasks();
  });
  wb.ensureConversation=async()=>{
    if(wb.selected)return wb.selected;
    if(!S.project)throw new Error('先选一个项目');
    let nativeId;
    if(wb.historicalId){
      if(S.agent!==S.project.agent)throw new Error('继续原生历史时请保持同一个代理；换代理请新建会话');
      nativeId=wb.historicalId.startsWith('codex:')?wb.historicalId.match(/[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i)?.[0]:wb.historicalId.startsWith('wb:')?wb.historicalId.split('/').pop():wb.historicalId.slice(4);
      if(!nativeId)throw new Error('无法识别原生会话 ID，请新建会话');
    }
    const expectedGeneration=wb.generation;
    const conversation=await call('/conversations','POST',{agent:S.agent,cwd:S.project.path,nativeId,sourceId:wb.historicalId,title:wb.historicalId?threadData?.title:undefined,historyCount:wb.historicalId?threadData?.count:0});
    if(expectedGeneration!==wb.generation)throw new Error('已切换会话，原请求未发送');
    wb.selected=conversation;STORE.set('wb-last-conversation',conversation.id);wb.state.conversations.push(conversation);wb.base=wb.historicalId?(threadData?.messages||[]):[];wb.baseFiles=wb.historicalId?(threadData?.files||[]):[];wb.historicalId=null;wb.nodes.clear();wb.generation++;
    let oldIndex=0;
    for(let index=0;index<wb.base.length;index++){const message=wb.base[index];if(threadCompact&&['tool','reasoning'].includes(message.role))continue;const node=S.replayNodes?.[oldIndex++];if(node?.isConnected){node.signature=JSON.stringify([message.text,null,null,null,null,null]);wb.nodes.set('native:'+index,node);}}

    if(S.replayTimer){clearInterval(S.replayTimer);S.replayTimer=null;}replayGeneration++;S.replaying=false;S.thread=null;el('thread-bar').hidden=true;if(!wb.nodes.size)el('messages').replaceChildren();else el('messages').querySelector('.files-card')?.remove();return conversation;
  };
  wb.send=safe(async()=>{
    if(wb.submitting)return;
    wb.submitting=true;
    try {
    const prompt=el('prompt').value.trim();if(!prompt)return;
    const conversation=await wb.ensureConversation();
    if(S.agent!==conversation.agent)throw new Error('当前会话属于 '+NAME[conversation.agent]+'，切换代理后请新建会话');
    const payload={conversationId:conversation.id,prompt,attachments:S.atts.map(a=>a.path),references:wb.references,model:S.model,effort:S.effort,mode:S.mode};
    // Clear input only after the worker has durably accepted the task.
    const fingerprint=JSON.stringify(payload);if(!wb.submission||wb.submission.fingerprint!==fingerprint)wb.submission={id:crypto.randomUUID(),fingerprint};payload.clientRequestId=wb.submission.id;saveDraft();
    const result=await call('/tasks','POST',payload);wb.submission=null;if(wb.selected?.id===conversation.id&&el('prompt').value.trim()===prompt){el('prompt').value='';S.atts=[];wb.references=[];renderAtts();saveDraft();S.run=result.taskId;}
    await wb.sync();await wb.hydrate(conversation.id);await wb.render();wb.bar();renderProjects();
    } finally {wb.submitting=false;}
  });
  wb.sync=async()=>{const state=await call('/state');if((state.revision||0)<(wb.state.revision||0))return;wb.state=state;if(wb.selected)wb.selected=state.conversations.find(c=>c.id===wb.selected.id)||wb.selected;wb.drawTasks();wb.bar();};
  wb.hydrate=async id=>{
    for(const task of wb.state.tasks.filter(t=>t.conversationId===id)){
      let events=wb.events.get(task.id)||[];
      for(;;){const page=await call('/task-events?id='+encodeURIComponent(task.id)+'&after='+(events.at(-1)?.seq||0));if(!page.events.length)break;
        const map=new Map(events.map(e=>[e.seq,e]));for(const event of page.events)map.set(event.seq,event);events=[...map.values()].sort((a,b)=>a.seq-b.seq);wb.events.set(task.id,events);if(page.events.length<500)break;}
    }
  };
  function records(){
    const result=wb.base.map((m,index)=>({key:'native:'+index,role:m.role,text:m.text,attachments:m.attachments}));
    for(const task of wb.state.tasks.filter(t=>t.conversationId===wb.selected?.id).sort((a,b)=>a.createdAt-b.createdAt)){
      let assistant=null,groups=0;const byId=new Map();
      for(const event of wb.events.get(task.id)||[]){
        if(event.kind==='user')result.push({key:task.id+':user',role:'user',text:event.text,attachments:event.attachments,references:event.references,task});
        else if(event.kind==='delta'||event.kind==='message'){
          let item=event.itemId?byId.get(event.itemId):assistant;
          if(!item){item={key:task.id+':message:'+(event.itemId||++groups),role:'assistant',text:'',task};result.push(item);if(event.itemId)byId.set(event.itemId,item);assistant=item;}
          item.text=event.kind==='message'?event.text:item.text+event.text;
        }else if(event.kind==='tool'||event.kind==='tool_result'){
          assistant=null;const key=task.id+':tool:'+event.id;let item=result.find(r=>r.key===key);if(!item){item={key,role:'tool',text:'',task};result.push(item);}Object.assign(item,{text:event.title||'工具',output:event.output||item.output,state:event.state,exitCode:event.exitCode,locations:event.locations});
        }else if(event.kind==='error'||event.kind==='diagnostic')result.push({key:task.id+':event:'+event.seq,role:'notice',text:event.text,task});
        else if(event.kind==='usage'){let item=result.find(r=>r.key===task.id+':usage');if(!item){item={key:task.id+':usage',role:'usage',text:'',task};result.push(item);}const usage=event.usage.last||event.usage.total||event.usage;if(usage.inputTokens!==undefined)item.text=`原生用量：输入 ${usage.inputTokens} · 输出 ${usage.outputTokens||0}`;else if(usage.used!==undefined)item.text=`上下文占用 ${usage.used}${usage.size?' / '+usage.size:''} token（非计费用量）`;else item.text='已记录原生用量事件';}
        else if(event.kind==='end')result.push({key:task.id+':end',role:'evidence',text:task.stopReason==='forwarded_to_native_queue'?'已转交桌面会话，等待原生回复':labels[event.state],task});
        else if(event.kind==='reasoning'){
          let item=result.at(-1);if(item?.role!=='reasoning'){item={key:task.id+':reasoning:'+event.seq,role:'reasoning',text:'',task};result.push(item);}item.text+=event.text;
        }
      }
    }
    for(const task of wb.state.tasks.filter(t=>t.conversationId===wb.selected?.id&&!activeStates.has(t.state))){if(!(wb.events.get(task.id)||[]).some(event=>event.kind==='end'))result.push({key:task.id+':end',role:'evidence',text:(task.stopReason==='forwarded_to_native_queue'?'已转交桌面会话':labels[task.state]),task});}
    const files=new Map();
    for(const file of wb.baseFiles||[])files.set(file,{path:file,kind:'涉及文件'});
    for(const task of wb.state.tasks.filter(t=>t.conversationId===wb.selected?.id))for(const file of task.evidence?.changes||[])files.set(file.path,{path:file.path,kind:'已修改'});
    for(const file of wb.selected?.deliverables||[])files.set(file,{path:file,kind:'标记交付'});
    if(files.size)result.push({key:wb.selected.id+':files',role:'files',files:[...files.values()],text:JSON.stringify([...files.values()])});
    return result;
  }
  wb.renderOnce=async()=>{
    if(!wb.selected)return;const generation=wb.generation,host=el('messages');
    const stick=host.scrollHeight-host.scrollTop-host.clientHeight<80;
    const hostTop=host.getBoundingClientRect().top;let anchor;
    for(const node of wb.nodes.values()){const top=node.getBoundingClientRect().top;if(node.getBoundingClientRect().bottom>hostTop){anchor={node,offset:top-hostTop};break;}}
    const reader=wb.readerVersion;const data=records();let n=0,previousNode=null;
    for(const item of data){
      if(generation!==wb.generation)return;
      if(threadCompact&&(item.role==='tool'||item.role==='reasoning')){wb.nodes.get(item.key)?.remove();wb.nodes.delete(item.key);continue;}
      let node=wb.nodes.get(item.key);
      if(!node){node=document.createElement('article');node.className='wb-message msg '+(item.role==='user'?'user':item.role==='assistant'?'assistant '+wb.selected.agent:'wb-detail');node.dataset.key=item.key;wb.nodes.set(item.key,node);host.append(node);}
      if(previousNode){if(previousNode.nextElementSibling!==node)host.insertBefore(node,previousNode.nextSibling);}else if(host.firstElementChild!==node)host.prepend(node);previousNode=node;
      const signature=JSON.stringify([item.text,item.output,item.state,item.exitCode,item.task?.state,item.task?.evidence]);
      if(node.signature===signature)continue;node.signature=signature;
      if(item.role==='user'||item.role==='assistant'){
        node.innerHTML='<div class="msg-head"><span class="badge">'+(item.role==='user'?'YOU':TAG[wb.selected.agent])+'</span><span>'+(item.role==='user'?'你':NAME[wb.selected.agent])+'</span></div><div class="msg-body"></div>';
        const body=node.querySelector('.msg-body');if(item.role==='assistant')body.innerHTML=mdToHtml(item.text);else body.textContent=item.text;
        if(item.attachments?.length){const box=document.createElement('div');box.className='msg-attach';for(const attachment of item.attachments){const file=typeof attachment==='string'?attachment:attachment.path;if(file&&/\.(png|jpe?g|gif|webp)$/i.test(file)){const image=document.createElement('img');image.src='/uploads/'+encodeURIComponent(file.split(/[\\/]/).pop());image.alt=file.split(/[\\/]/).pop();box.append(image);}else if(attachment.dataUrl){const image=document.createElement('img');image.src=attachment.dataUrl;box.append(image);}}node.append(box);}
        const action=document.createElement('button');action.className='wb-message-action';action.textContent=item.role==='user'?'编辑并再次发送':'引用';
        action.onclick=()=>{el('prompt').value=item.role==='user'?item.text:el('prompt').value+'\n\n> '+item.text.replaceAll('\n','\n> ')+'\n';el('prompt').focus();saveDraft();};node.append(action);
      }else if(item.role==='tool'||item.role==='reasoning'){
        const open=node.querySelector('details')?.open;node.innerHTML='<details><summary></summary><pre></pre></details>';node.querySelector('summary').textContent=(item.role==='reasoning'?'思考过程':item.text)+' '+(item.exitCode!==undefined?'· 退出码 '+item.exitCode:item.state||'');node.querySelector('pre').textContent=item.role==='reasoning'?item.text:item.output||'等待工具结果';node.querySelector('details').open=!!open;
      }else if(item.role==='files'){
        node.className='files-card';node.replaceChildren();const head=document.createElement('div');head.className='files-head';head.textContent='修改 / 涉及文件 / 标记交付 · '+item.files.length;node.append(head);
        const body=document.createElement('div');body.className='files-body';node.append(body);
        const draw=()=>{body.replaceChildren();for(const file of wb.filesExpanded?item.files:item.files.slice(0,2)){const button=document.createElement('button');button.className='file-row';button.textContent=file.kind+' · '+file.path.split(/[\\/]/).pop();button.title=file.path;button.onclick=safe(async()=>{await wb.showFiles();let relative=file.path.replaceAll('\\','/'),root=wb.selected.cwd.replaceAll('\\','/');if(relative.toLowerCase().startsWith(root.toLowerCase()+'/'))relative=relative.slice(root.length+1);await viewFile(relative);});body.append(button);}if(item.files.length>2){const toggle=document.createElement('button');toggle.className='files-more';toggle.textContent=wb.filesExpanded?'收起':'展开其余 '+(item.files.length-2)+' 个文件';toggle.onclick=()=>{wb.filesExpanded=!wb.filesExpanded;draw();};body.append(toggle);}};draw();
      }else if(item.role==='evidence'){
        node.innerHTML='<b>'+esc(item.text)+'</b><p>执行结束不等于需求验收通过。以下是实际记录。</p>';
        const changes=item.task.evidence?.changes||[];const list=document.createElement('div');
        for(const change of changes){const detail=document.createElement('details');detail.innerHTML='<summary></summary><pre></pre>';detail.querySelector('summary').textContent=change.status+' · '+change.path;detail.querySelector('pre').textContent=change.patch||change.patchPreview||change.patchError||'差异不可用';if(change.patchFile){const view=document.createElement('button');view.textContent='查看 / 下载完整差异';view.onclick=()=>window.showTaskDiff(item.task.id,change.path);detail.append(view);}list.append(detail);}
        node.append(list);if(item.task.evidence?.incomplete){const note=document.createElement('p');note.textContent='目录扫描有范围或读取限制，改动清单可能不完整。';node.append(note);}
        const report=document.createElement('details');report.className='wb-evidence-report';const reportTitle=document.createElement('summary');reportTitle.textContent='执行记录 / 失败项 / 未验证项';report.append(reportTitle);
        const execution=document.createElement('div');execution.textContent='执行记录：';report.append(execution);
        for(const record of item.task.evidence?.executions||[]){const row=document.createElement('p');row.textContent=record.title+' · '+(typeof record.exitCode==='number'?'退出码 '+record.exitCode:record.state||'状态未确认');report.append(row);}
        const failure=document.createElement('div');failure.textContent='失败或拒绝：'+((item.task.evidence?.failures||[]).map(record=>record.title).join('；')||'原生事件中未记录到失败项');report.append(failure);
        for(const unverified of item.task.evidence?.unverified||['需求是否全部满足，尚未自动验收。']){const row=document.createElement('p');row.textContent='未验证：'+unverified;report.append(row);}node.append(report);
        const retry=document.createElement('button');retry.textContent='重试 / 修改后再执行';retry.onclick=()=>{el('prompt').value=item.task.originalPrompt;S.atts=(item.task.attachments||[]).map(path=>({path,name:path.split(/[\\/]/).pop(),isImage:/\.(png|jpe?g|webp|gif)$/i.test(path)}));wb.references=item.task.references||[];renderAtts();wb.renderContext();el('prompt').focus();};node.append(retry);
      }else node.textContent=item.text;
      if(++n%40===0)await new Promise(resolve=>setTimeout(resolve,0));
    }
    if(generation!==wb.generation)return;
    if(reader===wb.readerVersion){if(stick)host.scrollTop=host.scrollHeight;else if(anchor?.node.isConnected)host.scrollTop+=anchor.node.getBoundingClientRect().top-host.getBoundingClientRect().top-anchor.offset;}
    el('wb-new-output').hidden=stick;wb.bar();
  };
  wb.render=()=>{wb.renderPromise=(wb.renderPromise||Promise.resolve()).catch(()=>{}).then(()=>wb.renderOnce());return wb.renderPromise;};
  wb.showChanges=()=>{
    if(!wb.selected)return false;
    const task=wb.state.tasks.filter(t=>t.conversationId===wb.selected.id&&t.evidence).at(-1);if(!task)return false;
    const files=task.evidence.changes.map(file=>{const lines=(file.patch||'').split('\n');return {...file,added:lines.filter(l=>l.startsWith('+')&&!l.startsWith('+++')).length,removed:lines.filter(l=>l.startsWith('-')&&!l.startsWith('---')).length,agent:task.agent,patchNotice:file.patch?'':file.patchPreview||file.patchError||'通过任务证据查看完整差异'};});
    S.changes={files,isRepo:false,sourceLabel:'最近一轮任务期间的目录变化'+(task.evidence.incomplete?' · 扫描范围不完整':''),summary:{files:files.length,added:files.reduce((n,f)=>n+f.added,0),removed:files.reduce((n,f)=>n+f.removed,0)},byAgent:{}};renderChanges();return true;
  };
  wb.renderContext=()=>{const count=S.atts.length+wb.references.length;const target=el('wb-input-context');target.hidden=!count;target.replaceChildren();for(const relative of wb.references){const chip=document.createElement('button');chip.textContent=relative+' ×';chip.onclick=()=>{wb.references=wb.references.filter(p=>p!==relative);saveDraft();wb.renderContext();};target.append(chip);}if(S.atts.length)target.append(document.createTextNode(`附件 ${S.atts.length} 个`));};
  wb.bar=()=>{
    const conversation=wb.selected,task=wb.state.tasks.filter(t=>t.conversationId===conversation?.id).at(-1);
    el('wb-context').textContent=conversation?`${conversation.title} · ${conversation.nativeId?'继续原生会话':'新会话'}${task?' · '+(task.stopReason==='forwarded_to_native_queue'?'已转交桌面会话':labels[task.state]):''}`:wb.historicalId?'原生历史 · 发送后继续此会话':'新会话 · '+(NAME[S.agent]||'');
    el('wb-context').title=conversation?.nativeId||'';el('wb-process').setAttribute('aria-checked',String(!threadCompact));
    const busy=task&&activeStates.has(task.state);S.busy=false;el('btn-send').disabled=false;el('btn-send').textContent=busy?'排队发送':'发送';el('btn-stop').hidden=!busy;
    el('run-state').textContent=busy?(task.stopReason==='forwarded_to_native_queue'?'已转交桌面会话':labels[task.state]):'待命';el('run-state').dataset.busy=String(!!busy);
    const waiting=wb.state.tasks.filter(t=>t.state==='waiting').length;const count=wb.state.tasks.filter(t=>activeStates.has(t.state)).length;el('wb-count').textContent=count;el('wb-count').hidden=!count;el('wb-tasks').dataset.waiting=String(!!waiting);el('wb-tasks').title=waiting?`${count} 个活动任务 · ${waiting} 个等待确认`:'查看任务和审批';el('wb-rename').disabled=!conversation;el('wb-export').disabled=!conversation&&!wb.historicalId;wb.renderContext();
    if(conversation)S.run=task?.id||null;
  };
  wb.drawTasks=()=>{
    el('wb-concurrency').value=String(wb.state.maxConcurrent||1);const host=el('wb-task-list');host.replaceChildren();
    if(!wb.state.tasks.length){const empty=document.createElement('div');empty.className='wb-empty-state';empty.innerHTML='<b>还没有执行任务</b><p>在会话里发送第一条消息后，执行进度、确认请求和结果会显示在这里。</p>';host.append(empty);}
    for(const task of [...wb.state.tasks].reverse()){
      const row=document.createElement('div');row.className='wb-task-row';row.dataset.state=task.state;const title=document.createElement('button');title.textContent=`${NAME[task.agent]} · ${(task.stopReason==='forwarded_to_native_queue'?'已转交桌面会话':labels[task.state])} · ${task.title}`;title.onclick=()=>wb.open(task.conversationId);row.append(title);
      const info=document.createElement('small');info.textContent=`${task.model||'原生默认模型'} · ${task.mode==='read'?'只读':'可写'} · ${task.cwd}${task.error?' · '+task.error:''}`;row.append(info);
      if(activeStates.has(task.state)){const stop=document.createElement('button');stop.textContent='停止';stop.onclick=safe(()=>call('/stop','POST',{taskId:task.id}));row.append(stop);}
      if(task.pending){const request=task.pending;const detail=document.createElement('details');detail.open=true;const summary=document.createElement('summary');summary.textContent=request.type==='permission'?'操作需要确认':'代理需要你的回答';detail.append(summary);const pre=document.createElement('pre');pre.textContent=JSON.stringify(request.detail,null,2);detail.append(pre);
        if(request.type==='questions'){
          const answers={};for(const question of request.detail.questions||[]){const label=document.createElement('label');label.textContent=question.question;const input=document.createElement('input');if(question.isSecret)input.type='password';if(question.options?.length){const list=document.createElement('datalist');list.id='wb-question-'+task.id+'-'+question.id;for(const option of question.options){const item=document.createElement('option');item.value=option.label;item.label=option.description||option.label;list.append(item);}input.setAttribute('list',list.id);detail.append(list);}label.append(input);detail.append(label);answers[question.id]=input;}
          const submit=document.createElement('button');submit.textContent='提交回答';submit.onclick=safe(()=>call('/answer','POST',{taskId:task.id,requestId:request.id,answer:Object.fromEntries(Object.entries(answers).map(([id,input])=>[id,{answers:[input.value]}]))}));detail.append(submit);
        }else if(request.type==='elicitation'&&request.detail.mode!=='url'){
          const fields={};const schema=request.detail.requestedSchema||{};
          for(const [key,property] of Object.entries(schema.properties||{})){const label=document.createElement('label');label.textContent=property.title||key;let input;if(property.enum){input=document.createElement('select');for(const value of property.enum){const option=document.createElement('option');option.value=value;option.textContent=value;input.append(option);}}else{input=document.createElement('input');input.type=property.type==='boolean'?'checkbox':property.type==='number'||property.type==='integer'?'number':'text';}fields[key]={input,type:property.type};label.append(input);detail.append(label);}
          const submit=document.createElement('button');submit.textContent='提交表单';submit.onclick=safe(()=>{const answer=Object.fromEntries(Object.entries(fields).map(([key,{input,type}])=>[key,type==='boolean'?input.checked:type==='number'||type==='integer'?Number(input.value):input.value]));for(const key of schema.required||[])if(answer[key]===undefined||answer[key]==='')throw new Error('请填写 '+key);return call('/answer','POST',{taskId:task.id,requestId:request.id,answer});});detail.append(submit);
          const decline=document.createElement('button');decline.textContent='拒绝';decline.onclick=safe(()=>call('/answer','POST',{taskId:task.id,requestId:request.id,answer:false}));detail.append(decline);
        }else{
          if(request.type==='elicitation'&&request.detail.mode==='url'){const open=document.createElement('button');open.textContent='打开原生授权页面';open.onclick=()=>{const url=request.detail.url;if(/^https?:\/\//i.test(url))window.consoleNative?.openExternal(url);};detail.append(open);}
          for(const [text,answer] of [['允许本次',true],['拒绝',false]]){const button=document.createElement('button');button.textContent=text;button.onclick=safe(()=>call('/answer','POST',{taskId:task.id,requestId:request.id,answer}));detail.append(button);}
        }row.append(detail);
      }
      if(task.agent==='workbuddy'&&(task.errorCode==='AUTH_REQUIRED'||/Authentication required|登录/i.test(task.error||''))){const login=document.createElement('button');login.textContent='打开 WorkBuddy 原生登录终端';login.onclick=()=>{if(window.consoleNative?.loginWorkBuddy)window.consoleNative.loginWorkBuddy();else navigator.clipboard.writeText('node D:\\santi-console\\bridges\\wb-bridge\\cli.mjs /login').then(()=>notify('登录命令已复制，请在本机终端执行'));};row.append(login);}
      host.append(row);
    }
    const conversations=el('wb-conversation-list');conversations.replaceChildren();const recent=STORE.get('wb-recent',[]);const recentRank=id=>recent.includes(id)?recent.indexOf(id):9999;
    for(const c of wb.state.conversations.filter(c=>c.nativeId||c.sourceId||c.title!=='新会话'||wb.state.tasks.some(t=>t.conversationId===c.id)).sort((a,b)=>Number(b.pinned)-Number(a.pinned)||recentRank(a.id)-recentRank(b.id)||b.updatedAt-a.updatedAt)){
      const row=document.createElement('div');row.className='wb-task-row';const open=document.createElement('button');open.textContent=(c.pinned?'📌 ':'')+c.title+' · '+NAME[c.agent]+(c.archived?' · 已归档':'');open.onclick=()=>wb.open(c.id);row.append(open);
      for(const [text,update] of [[c.pinned?'取消置顶':'置顶',{pinned:!c.pinned}],[c.archived?'恢复':'归档',{archived:!c.archived}]]){const b=document.createElement('button');b.textContent=text;b.onclick=safe(async()=>{await call('/conversation','PATCH',{id:c.id,...update});await wb.sync();await loadProjects({silent:true});});row.append(b);}conversations.append(row);
    }
  };
  wb.refreshCatalog=safe(async()=>{
    const agent=S.agent,model=S.model;const result=await call('/catalog?agent='+agent+'&model='+encodeURIComponent(model)+'&cwd='+encodeURIComponent(S.project?.path||''));
    wb.catalogs.set(agent+':'+model,result);if(S.agent!==agent)return;
    const flatten=options=>(options||[]).flatMap(o=>o.options?flatten(o.options):o);
    let models;if(agent==='codex')models=(result.models||[]).map(m=>({id:m.id||m.model,name:m.displayName||m.model||m.id}));
    else if(agent==='workbuddy')models=(result.models?.availableModels||[]).map(m=>({id:m.modelId,name:m.name}));
    else models=flatten(result.configOptions?.find(o=>o.id==='model')?.options).filter(o=>{try{return JSON.parse(o.value)[0]==='qoder-cn';}catch{return false;}}).map(o=>({id:JSON.parse(o.value)[1],name:o.name}));
    if(models?.length){ddModel.set(models,models.some(m=>m.id===model)?model:models[0].id);S.model=ddModel.get();}
    const effort=result.configOptions?.find(o=>o.category==='thought_level');
    if(effort){const choices=flatten(effort.options).map(o=>({id:o.value,name:({off:'关闭',disabled:'关闭',low:'低',medium:'中',high:'高',max:'最高',xhigh:'极高'})[o.value]||o.name}));ddEffort.set(choices,choices.some(o=>o.id===S.effort)?S.effort:effort.currentValue);S.effort=ddEffort.get();}
    remember();notify('已读取原生模型与能力');
  });
  wb.modelChanged=()=>{saveDraft();if(S.agent==='dsh')loadModels(S.agent,{model:S.model,effort:S.effort});};
  wb.pickerChanged=saveDraft;el('btn-mode').addEventListener('click',saveDraft);
  const catalogButton=document.createElement('button');catalogButton.id='wb-refresh-catalog';catalogButton.setAttribute('role','menuitem');catalogButton.textContent='刷新模型与能力';catalogButton.title='从原生接口读取当前可用模型和档位，不发送任务';catalogButton.onclick=()=>wb.refreshCatalog();el('wb-more-menu').insertAdjacentHTML('beforeend','<div class="wb-menu-separator" role="separator"></div>');el('wb-more-menu').append(catalogButton);
  wb.showFiles=safe(async()=>{if(!S.project&&!wb.selected)throw new Error('先选择项目');setInspector(true);el('pane-changes').hidden=true;el('pane-preview').hidden=true;pane.hidden=false;await browse('');});
  const fileQuery=()=>wb.selected?'conversationId='+encodeURIComponent(wb.selected.id):'cwd='+encodeURIComponent(S.project.path);
  async function browse(dir){const query=fileQuery(),generation=wb.generation;const result=await call('/files?'+query+'&path='+encodeURIComponent(dir));if(generation!==wb.generation||query!==fileQuery())return;fileDirectory=dir;el('wb-file-location').textContent=dir||'项目文件';const host=el('wb-file-list');host.replaceChildren();
    for(const file of result.files){const button=document.createElement('button');button.className='wb-file-entry';button.textContent=(file.directory?'▸ ':'· ')+file.name+(wb.selected?.deliverables?.includes(file.path)?' ★':'');button.title=file.path;button.onclick=safe(()=>file.directory?browse(file.path):viewFile(file.path));host.append(button);}}
  async function viewFile(relative,lineNumber){const generation=wb.generation;const query=fileQuery();const file=await call('/file?'+query+'&path='+encodeURIComponent(relative));if(generation!==wb.generation)return;viewedFile=file;el('wb-file-name').textContent=relative;const host=el('wb-file-preview');host.replaceChildren();
    if(window.fileWorkspace&&await window.fileWorkspace.open(file,query,lineNumber))return;
    const url=API+'/file-content?'+query+'&path='+encodeURIComponent(relative);
    if(file.mime?.startsWith('image/')){const image=document.createElement('img');image.src=url;image.alt=relative;host.append(image);}
    else if(file.mime==='application/pdf'){const frame=document.createElement('iframe');frame.src=url;frame.title=relative;host.append(frame);}
    else if(!file.binary&&!file.tooLarge){if(/\.md$/i.test(relative)&&!lineNumber){const rendered=document.createElement('div');rendered.className='msg-body';rendered.innerHTML=mdToHtml(file.content);host.append(rendered);}else{const pre=document.createElement('pre');if(lineNumber){pre.innerHTML=file.content.split('\n').map((text,index)=>'<span class="wb-code-line" data-line="'+(index+1)+'">'+escHtml(text||' ')+'</span>').join('');}else pre.textContent=file.content;host.append(pre);if(lineNumber){const target=pre.querySelector('[data-line="'+Number(lineNumber)+'"]');if(target){target.classList.add('wb-code-selected');host.scrollTop=target.getBoundingClientRect().top-host.getBoundingClientRect().top+host.scrollTop-host.clientHeight/2;}}}}
    else host.textContent='此格式或大小暂不支持内嵌预览，可定位到原文件打开。';
  }
  wb.openFilePanel=()=>{setInspector(true);el('pane-changes').hidden=true;el('pane-preview').hidden=true;pane.hidden=false;};
  wb.viewFile=viewFile;
  el('wb-process').onclick=()=>{threadCompact=!threadCompact;el('wb-process').setAttribute('aria-pressed',String(!threadCompact));el('wb-process').setAttribute('aria-checked',String(!threadCompact));wb.render();};
  el('wb-export').onclick=()=>{if(!wb.selected){if(wb.historicalId)el('btn-tb-export').click();return;}const text=['# '+wb.selected.title,'',...records().map(item=>'## '+(item.role==='user'?'你':item.role==='assistant'?NAME[wb.selected.agent]:item.role)+'\n\n'+item.text+(item.output?'\n\n'+item.output:'')+'\n')].join('\n');const url=URL.createObjectURL(new Blob([text],{type:'text/markdown;charset=utf-8'}));const link=document.createElement('a');link.href=url;link.download=wb.selected.title.replace(/[\\/:*?"<>|]/g,'_')+'.md';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
  wb.dismissOverlays=()=>{el('wb-task-drawer').hidden=true;moreMenu.hidePopover();for(const id of ['wb-name-dialog','wb-switch-dialog'])if(el(id).open)el(id).close();};
  el('wb-new').onclick=()=>wb.newConversation(S.project);el('wb-files').onclick=()=>wb.showFiles();el('wb-tasks').onclick=()=>{el('wb-task-drawer').hidden=!el('wb-task-drawer').hidden;wb.drawTasks();};el('wb-drawer-close').onclick=()=>el('wb-task-drawer').hidden=true;
  el('wb-concurrency').onchange=safe(()=>call('/settings','POST',{maxConcurrent:Number(el('wb-concurrency').value)}));
  el('wb-file-close').onclick=()=>{pane.hidden=true;el('pane-changes').hidden=S.tab!=='changes';el('pane-preview').hidden=S.tab!=='preview';};
  el('insp-tabs').addEventListener('click',()=>pane.hidden=true);
  el('wb-file-up').onclick=safe(()=>browse(fileDirectory.split(/[\\/]/).slice(0,-1).join('/')));
  el('wb-file-context').onclick=()=>{if(!viewedFile)return;if(viewedFile.binary||viewedFile.tooLarge)return notify('此文件不支持作为文本上下文',true);if(!wb.references.includes(viewedFile.relative))wb.references.push(viewedFile.relative);saveDraft();wb.renderContext();};
  el('wb-file-deliverable').onclick=safe(async()=>{if(!viewedFile||!wb.selected)return;const files=wb.selected.deliverables||[];const next=files.includes(viewedFile.relative)?files.filter(p=>p!==viewedFile.relative):[...files,viewedFile.relative];await call('/conversation','PATCH',{id:wb.selected.id,deliverables:next});await wb.sync();await browse(fileDirectory);notify('交付物标记已保存');});
  el('wb-file-reveal').onclick=()=>viewedFile&&window.consoleNative?.revealFile(viewedFile.path);
  el('wb-new-output').onclick=()=>{el('messages').scrollTop=el('messages').scrollHeight;el('wb-new-output').hidden=true;};
  el('btn-stop').addEventListener('click',event=>{event.stopImmediatePropagation();safe(async()=>{const task=wb.state.tasks.filter(t=>t.conversationId===wb.selected?.id&&activeStates.has(t.state)).at(-1);if(task)await call('/stop','POST',{taskId:task.id});})();},true);
  el('wb-rename').onclick=()=>{if(!wb.selected)return notify('先打开工作会话');el('wb-name-input').value=wb.selected.title;el('wb-name-dialog').showModal();};
  el('wb-name-dialog').querySelector('form').addEventListener('submit',event=>{if(event.submitter?.value==='cancel')return;event.preventDefault();safe(async()=>{if(!wb.selected)return;await call('/conversation','PATCH',{id:wb.selected.id,title:el('wb-name-input').value.trim()||'新会话'});await wb.sync();renderProjects();el('wb-name-dialog').close('save');})();});
  el('prompt').addEventListener('dragover',e=>{e.preventDefault();});el('prompt').addEventListener('drop',safe(async e=>{e.preventDefault();await addAttFiles([...e.dataTransfer.files]);saveDraft();wb.renderContext();}));
  let switchItems=[],switchIndex=0;
  function drawSwitcher(){const query=el('wb-switch-query').value.toLowerCase();const recent=STORE.get('wb-recent',[]);switchItems=[];
    for(const id of [...recent,...wb.state.conversations.map(c=>c.id)]){if(switchItems.some(item=>item.key==='c:'+id))continue;const c=wb.state.conversations.find(c=>c.id===id);if(c&&!c.archived&&[c.title,c.cwd,NAME[c.agent]].join(' ').toLowerCase().includes(query))switchItems.push({key:'c:'+id,label:c.title+' · '+NAME[c.agent],action:()=>wb.open(id)});}
    for(const project of S.projects){if([project.name,project.path,project.agent].join(' ').toLowerCase().includes(query))switchItems.push({key:'p:'+project.agent+project.path,label:'项目 · '+project.name+' · '+NAME[project.agent],action:()=>selectProject(project)});for(const session of project.sessions||[])if(!session.id.startsWith('workbench:')&&!session.archived&&session.title.toLowerCase().includes(query))switchItems.push({key:'s:'+session.id,label:session.title+' · '+NAME[project.agent],action:()=>openThread(session.id,project)});}
    switchItems=switchItems.slice(0,60);switchIndex=Math.min(switchIndex,Math.max(0,switchItems.length-1));const list=el('wb-switch-list');list.replaceChildren();switchItems.forEach((item,index)=>{const button=document.createElement('button');button.textContent=item.label;button.classList.toggle('active',index===switchIndex);button.onclick=()=>{el('wb-switch-dialog').close();item.action();};list.append(button);});
  }
  el('wb-switch-query').oninput=()=>{switchIndex=0;drawSwitcher();};el('wb-switch-query').onkeydown=event=>{if(['ArrowDown','ArrowUp'].includes(event.key)){event.preventDefault();switchIndex=Math.max(0,Math.min(switchItems.length-1,switchIndex+(event.key==='ArrowDown'?1:-1)));drawSwitcher();el('wb-switch-list').children[switchIndex]?.scrollIntoView({block:'nearest'});}else if(event.key==='Enter'){event.preventDefault();el('wb-switch-list').children[switchIndex]?.click();}};
  document.addEventListener('keydown',event=>{if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='k'){event.preventDefault();el('wb-switch-query').value='';switchIndex=0;drawSwitcher();el('wb-switch-dialog').showModal();el('wb-switch-query').focus();}if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='n'){event.preventDefault();wb.newConversation(S.project);}if(event.key==='Escape')el('wb-task-drawer').hidden=true;});
  document.addEventListener('contextmenu',event=>{const row=event.target.closest('.sess[data-id^="workbench:"]');if(!row)return;event.preventDefault();event.stopImmediatePropagation();const id=row.dataset.id.slice(10),conversation=wb.state.conversations.find(c=>c.id===id);if(!conversation)return;ctxMenu.replaceChildren();
    for(const [label,action] of [[conversation.pinned?'取消置顶':'置顶',async()=>{await call('/conversation','PATCH',{id,pinned:!conversation.pinned});await wb.sync();renderProjects();}],['重命名',async()=>{await wb.open(id);el('wb-rename').click();}],['归档',()=>wb.archive(id,true)]]){const button=document.createElement('button');button.textContent=label;button.onclick=safe(async()=>{hideCtx();await action();});ctxMenu.append(button);}
    ctxMenu.hidden=false;ctxMenu.style.left=Math.min(event.clientX,innerWidth-180)+'px';ctxMenu.style.top=Math.min(event.clientY,innerHeight-130)+'px';
  },true);
  const search=el('sess-search');const searchHits=document.createElement('div');searchHits.className='wb-search-hits';searchHits.hidden=true;search.closest('.sess-search').after(searchHits);
  const nativeSearch=document.createElement('button');nativeSearch.className='wb-native-search';nativeSearch.textContent='搜索原生历史全文';nativeSearch.hidden=true;search.closest('.sess-search').after(nativeSearch);
  let historySearch;
  nativeSearch.onclick=()=>{
    if(historySearch){historySearch.close();historySearch=null;nativeSearch.textContent='搜索原生历史全文';return;}
    const query=search.value.trim();if(!query)return;searchHits.hidden=false;searchHits.replaceChildren();nativeSearch.textContent='正在搜索 · 点击停止';
    historySearch=new EventSource('/api/history-search?q='+encodeURIComponent(query));
    historySearch.addEventListener('hit',event=>{const hit=JSON.parse(event.data);const button=document.createElement('button');button.textContent=NAME[hit.agent]+' · '+hit.title;const preview=document.createElement('small');preview.textContent=hit.snippet;button.append(preview);button.onclick=()=>{historySearch?.close();historySearch=null;const project=S.projects.find(p=>p.agent===hit.agent&&p.path.toLowerCase()===hit.cwd.toLowerCase())||{agent:hit.agent,path:hit.cwd,name:hit.cwd.split(/[\\/]/).pop()};search.value='';search.dispatchEvent(new Event('input',{bubbles:true}));openThread(hit.id,project);};searchHits.append(button);});
    historySearch.addEventListener('progress',event=>{const p=JSON.parse(event.data);nativeSearch.textContent=`已查 ${p.scanned}/${p.total} · ${p.hits} 命中 · 点击停止`;});
    historySearch.addEventListener('done',event=>{const p=JSON.parse(event.data);historySearch?.close();historySearch=null;nativeSearch.textContent=`原生全文：${p.hits} 命中 · 搜索完成`;});
    historySearch.onerror=()=>{historySearch?.close();historySearch=null;nativeSearch.textContent='全文搜索连接中断 · 点击重试';};
  };
  let searchGeneration=0,searchTimer;
  search.addEventListener('input',()=>{historySearch?.close();historySearch=null;nativeSearch.hidden=!search.value.trim();nativeSearch.textContent='搜索原生历史全文';const query=search.value.trim();const generation=++searchGeneration;clearTimeout(searchTimer);if(!query){searchHits.hidden=true;searchHits.replaceChildren();return;}
    searchTimer=setTimeout(safe(async()=>{const result=await call('/search?q='+encodeURIComponent(query));if(generation!==searchGeneration)return;searchHits.replaceChildren();searchHits.hidden=!result.hits.length;
      for(const hit of result.hits){const button=document.createElement('button');button.textContent=hit.title+(hit.archived?' · 已归档':'');button.title=hit.snippet;button.onclick=()=>{search.value='';search.dispatchEvent(new Event('input',{bubbles:true}));wb.open(hit.conversationId);};const preview=document.createElement('small');preview.textContent=hit.snippet;button.append(preview);searchHits.append(button);}
    }),250);
  });
  el('messages').addEventListener('click',event=>{const link=event.target.closest('a[data-file]');if(!link)return;event.preventDefault();event.stopImmediatePropagation();safe(async()=>{if(!S.project&&!wb.selected)throw new Error('先选择项目');const lineNumber=link.dataset.file.match(/:(\d+)(?::\d+)?$/)?.[1];let file=link.dataset.file.replace(/:\d+(?::\d+)?$/,'').replaceAll('\\','/');const root=(wb.selected?.cwd||S.project.path).replaceAll('\\','/').replace(/\/$/,'');if(file.toLowerCase().startsWith(root.toLowerCase()+'/'))file=file.slice(root.length+1);else if(/^[A-Za-z]:|^\//.test(file))throw new Error('该文件在当前项目之外，可在原生应用查看');await wb.showFiles();await viewFile(file,lineNumber);})();},true);
  async function connect(){
    await wb.sync();renderProjects();const stream=new EventSource(API+'/events');wb.stream=stream;
    stream.addEventListener('workbench',safe(async event=>{
      const data=JSON.parse(event.data);
      if(data.type==='state'){if((data.revision||0)<(wb.state.revision||0))return;wb.state=data;if(wb.selected){wb.selected=data.conversations.find(c=>c.id===wb.selected.id)||wb.selected;await wb.hydrate(wb.selected.id);await wb.render();}wb.drawTasks();wb.bar();renderProjects();}
      else if(data.type==='event'){const event=data.event,events=wb.events.get(event.taskId)||[];if(!events.some(e=>e.seq===event.seq)){events.push(event);events.sort((a,b)=>a.seq-b.seq);wb.events.set(event.taskId,events);}if(event.conversationId===wb.selected?.id){clearTimeout(wb.renderTimer);wb.renderTimer=setTimeout(()=>wb.render(),80);}}
    }));
    stream.onerror=()=>{el('wb-context').textContent='任务连接重连中 · 输入草稿已保留';};
    const saved=STORE.get('wb-last-conversation',null);if(saved&&wb.state.conversations.some(c=>c.id===saved))await wb.open(saved);else restoreDraft();
    wb.ready=true;
  }
  let connecting=false;async function startConnection(){if(connecting)return;connecting=true;try{await connect();}catch(error){notify('工作台服务：'+error.message,true);setTimeout(startConnection,1500);}finally{connecting=false;}}
  startConnection();
})();
