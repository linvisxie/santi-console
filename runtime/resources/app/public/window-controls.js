(() => {
  if(!window.consoleNative?.windowCommand)return;
  const drag=document.createElement('div');drag.className='window-drag-strip';drag.setAttribute('aria-hidden','true');document.body.append(drag);
  const bar=document.createElement('div');bar.className='window-controls';bar.setAttribute('aria-label','窗口操作');
  const items=[['minimize','最小化'],['maximize','最大化'],['close','关闭窗口']];
  for(const [action,label]of items){const b=document.createElement('button');b.id='window-'+action;b.className='window-control '+action;b.title=label;b.setAttribute('aria-label',label);b.innerHTML='<i aria-hidden="true"></i>';b.onclick=()=>window.consoleNative.windowCommand(action).catch(()=>{});bar.append(b);}
  document.body.append(bar);
  const update=state=>{const b=document.getElementById('window-maximize');b.classList.toggle('restored',!!state.maximized);b.title=state.maximized?'还原窗口':'最大化';b.setAttribute('aria-label',b.title);};
  window.consoleNative.windowState().then(update).catch(()=>{});window.consoleNative.onWindowState(update);
})();
