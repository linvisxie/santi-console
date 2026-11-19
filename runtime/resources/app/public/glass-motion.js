/* Pointer reflection updates at most 30 Hz on one panel, never scrolls or moves content. */
(() => {
  const reduced=matchMedia('(prefers-reduced-motion: reduce)'),opaque=matchMedia('(prefers-reduced-transparency: reduce)');let last=0;
  document.addEventListener('pointermove',event=>{
    if(reduced.matches||opaque.matches||document.documentElement.dataset.perf==='lite'||performance.now()-last<33)return;
    const glass=event.target.closest?.('.glass');if(!glass)return;last=performance.now();const r=glass.getBoundingClientRect();
    glass.style.setProperty('--glass-x',(event.clientX-r.left)+'px');glass.style.setProperty('--glass-y',(event.clientY-r.top)+'px');
  },{passive:true});
})();
