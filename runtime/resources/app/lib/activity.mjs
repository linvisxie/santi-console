// A provider may have several simultaneous sessions; one session ending must not mask another.
export function classifyActivity(agent,events,running,sampledAt=Date.now(),ownedTasks=[]){
 const owned=ownedTasks.filter(t=>t.agent===agent&&['starting','running','waiting','stopping'].includes(t.state));
 if(owned.length)return {busy:true,phase:owned.some(t=>t.state==='waiting')?'waiting':'running',lastActivity:Math.max(...owned.map(t=>t.startedAt||t.createdAt)),source:'三体原生任务服务',detail:`${owned.length} 个任务有明确运行状态`,confidence:'confirmed',scope:'owned',sampledAt};
 const valid=events.filter(e=>e.ts>0&&e.ts<=sampledAt+30000).sort((a,b)=>a.ts-b.ts),groups=new Map();
 for(const event of valid){const id=event.sessionId||'default',group=groups.get(id)||[];group.push(event);groups.set(id,group)}
 const sessions=[...groups].map(([sessionId,items])=>{const end=items.filter(e=>e.phase==='end').at(-1),work=items.filter(e=>e.phase==='start'||e.phase==='work').at(-1),last=items.at(-1);return {sessionId,lastActivity:last.ts,busy:!!work&&sampledAt-work.ts<120000&&(!end||work.ts>end.ts),ended:!!end&&(!work||end.ts>=work.ts)}});
 const active=sessions.filter(s=>s.busy),last=valid.at(-1),busy=!!active.length,ended=sessions.length&&sessions.every(s=>s.ended),phase=busy?'running':!running?'offline':ended?'idle':'unknown';
 return {busy,phase,lastActivity:last?.ts||0,source:last?(agent==='codex'?'Codex 原生事件时间':'原生会话事件时间'):'进程采样',detail:busy?`${active.length} 个外部会话最近有执行事件，尚未见对应结束事件`:ended?'观察到对应会话结束事件':running?'进程在线，近期执行状态未确认':'没有检测到代理进程或近期执行证据',confidence:last?'event-evidence':'unknown',scope:'external',observedSessions:sessions.length,activeSessions:active.length,freshnessMs:last?sampledAt-last.ts:null,sampledAt};
}
