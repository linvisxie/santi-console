/* 文件工作区：分页、Office PDF、版本检查编辑和冲突合并。 */
(() => {
 const base='/api/workbench',get=async url=>{const r=await fetch(url);const value=await r.json();if(!r.ok)throw Error(value.error);return value;};
 const button=(text,fn)=>{const b=document.createElement('button');b.textContent=text;b.onclick=()=>Promise.resolve(fn()).catch(e=>notify(e.message,true));return b;};
 const drafts=new Map();let generation=0;
 async function allText(query,progress){let text='',offset=0;for(;;){const p=await get(base+'/file-page?'+query+'&offset='+offset+'&length=262144');if(p.binary)throw Error('二进制文件不能作为文本保存');text+=p.content;progress?.(p.nextOffset,p.size);if(p.eof)return text;if(p.nextOffset<=offset)throw Error('读取没有进展');offset=p.nextOffset;}}
 window.showTaskDiff=async(taskId,relative)=>{
  window.workbench?.openFilePanel?.();const host=document.getElementById('wb-file-preview');host.replaceChildren();const controls=document.createElement('div');controls.className='wb-file-controls';const pre=document.createElement('pre');host.append(controls,pre);let offset=0,stack=[];const query='id='+encodeURIComponent(taskId)+'&path='+encodeURIComponent(relative);
  const status=document.createElement('span'),download=document.createElement('a');download.textContent='下载完整差异';download.href=base+'/task-diff?'+query+'&download=1';download.download='changes.patch';
  const prev=button('上一段',()=>load(stack.pop()||0)),next=button('下一段',()=>{stack.push(offset);return load(page.nextOffset)});let page;
  async function load(at){page=await get(base+'/task-diff?'+query+'&offset='+at);offset=at;pre.textContent=page.content||page.hex;status.textContent=`${page.offset}–${page.nextOffset} / ${page.size} 字节`;prev.disabled=!stack.length;next.disabled=page.eof;}
  controls.append(prev,next,download,status);await load(0);
 };
 window.fileWorkspace={async open(file,query,lineNumber){
  if(file.mime?.startsWith('image/')||file.mime==='application/pdf'||lineNumber&&!file.tooLarge)return false;
  const current=++generation,host=document.getElementById('wb-file-preview');host.replaceChildren();
  const q=query+'&path='+encodeURIComponent(file.relative),bar=document.createElement('div');bar.className='wb-file-controls';host.append(bar);const content=document.createElement('div');content.className='wb-file-content';host.append(content);
  const download=document.createElement('a');download.textContent='下载原文件';download.href=base+'/file-content?'+q+'&download=1';download.download=file.relative.split(/[\\/]/).pop();bar.append(download);
  if(/\.(docx|xlsx|pptx)$/i.test(file.relative)){
   const message=document.createElement('p');message.textContent='本机 WPS 只读转换中（禁用宏）…';content.append(message);
   try{const response=await fetch(base+'/office-preview?'+q);if(!response.ok){const error=await response.json();throw Error(error.error)}const blob=await response.blob();if(current!==generation)return true;const url=URL.createObjectURL(blob);const frame=document.createElement('iframe');frame.src=url;frame.title=file.relative+' · 完整文档预览';content.replaceChildren(frame);bar.append(button('在浏览器预览 PDF',()=>window.consoleNative?.openExternal(new URL(base+'/office-preview?'+q,location.origin).href)));frame.onload=()=>setTimeout(()=>URL.revokeObjectURL(url),60000);}catch(error){message.textContent=error.message+'；可用“定位文件”在原生 Office 打开。';}return true;
  }
  const status=document.createElement('span'),pre=document.createElement('pre');content.append(pre);let offset=0,page,stack=[];
  async function load(at){page=await get(base+'/file-page?'+q+'&offset='+at);if(current!==generation)return;offset=at;pre.textContent=page.binary?page.hex:page.content;status.textContent=`${page.offset.toLocaleString()}–${page.nextOffset.toLocaleString()} / ${page.size.toLocaleString()} 字节${page.binary?' · 十六进制':''}`;prev.disabled=!stack.length;next.disabled=page.eof;edit.disabled=page.binary;}
  const prev=button('上一段',()=>load(stack.pop()||0)),next=button('下一段',()=>{stack.push(offset);return load(page.nextOffset)});
  const edit=button('编辑全文',async()=>{
   const version=(await get(base+'/file-version?'+q)).version;const text=await allText(q,(read,total)=>status.textContent=`加载全文 ${read.toLocaleString()} / ${total.toLocaleString()}`);if(current!==generation)return;
   if((await get(base+'/file-version?'+q)).version!==version)throw Error('加载期间文件已变化，请重新打开');
   const key=query+'|'+file.relative;const prior=drafts.get(key),area=document.createElement('textarea');area.className='wb-file-editor';area.spellcheck=false;area.value=prior?.version===version?prior.text:text;let expected=version;area.oninput=()=>drafts.set(key,{text:area.value,version:expected});content.replaceChildren(area);bar.replaceChildren();bar.append(status);status.textContent='编辑中 · 保存前检查外部改动';
   const save=button('保存',async()=>{
    save.disabled=true;try{
     const response=await fetch(base+'/file-save?'+q,{method:'POST',headers:{'content-type':'text/plain; charset=utf-8','x-file-version':expected},body:area.value});const result=await response.json();
     if(response.status===409){
      const latestVersion=(await get(base+'/file-version?'+q)).version,latest=await allText(q);if((await get(base+'/file-version?'+q)).version!==latestVersion)throw Error('磁盘仍在变化，请稍后重试合并');
      const panel=document.createElement('details');panel.open=true;panel.className='wb-merge-panel';const title=document.createElement('summary');title.textContent='保存冲突：请对照磁盘版本合并到上方编辑区';panel.append(title);for(const [label,value] of [['原始版本',text],['磁盘最新版本',latest]]){const heading=document.createElement('b'),body=document.createElement('pre');heading.textContent=label;body.textContent=value;panel.append(heading,body);}const accept=button('已合并，按最新版本重新保存',()=>{expected=latestVersion;panel.remove();status.textContent='合并已准备，请点击保存';});panel.append(accept);content.append(panel);status.textContent='外部更新冲突，未覆盖磁盘';return;
     }
     if(!response.ok)throw Error(result.error);expected=result.version;drafts.delete(key);status.textContent='已保存 · 原版本已备份';notify('文件已保存');
    }finally{save.disabled=false;}
   });bar.append(save,button('返回预览',()=>window.workbench.viewFile(file.relative)));
  });bar.append(prev,next,edit,status);await load(0);return true;
 }};
})();
