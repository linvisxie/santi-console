// DSH v4 append-only records shared by history and monitoring. No model or profile writes.
export const dshTime=record=>typeof record.time==='number'?record.time:Date.parse(record.time)|| (typeof record.timestamp==='number'?record.timestamp:Date.parse(record.timestamp)||0);
const text=content=>typeof content==='string'?content:Array.isArray(content)?content.filter(c=>c&&typeof c.text==='string').map(c=>c.text).join('\n'):'';
const detail=value=>typeof value==='string'?value:JSON.stringify(value??'',null,2);
export function dshRecordItems(record){
 const data=record.data||{},ts=dshTime(record),id=data.message?.id||data.id||String(record.seq??'');
 if(record.type==='user/message')return [{role:'user',text:text(data.content),ts,id}];
 if(record.type==='assistant/message'){
  const content=Array.isArray(data.message?.content)?data.message.content:[];const out=[];
  for(const [role,parts] of [['reasoning',content.filter(c=>c.type==='reasoning')],['assistant',content.filter(c=>c.type!=='reasoning'&&typeof c.text==='string')]]){const body=text(parts);if(body.trim())out.push({role,text:body,ts,id:id+':'+role});}
  return out;
 }
 if(record.type==='tool/call')return [{role:'tool',text:data.name||'tool',meta:detail(data.arguments),arguments:data.arguments,ts,id:'call:'+data.callId}];
 if(record.type==='tool/result')return [{role:'tool',text:data.message?.isError?'工具执行失败':'工具结果',meta:text(data.message?.content),ts,id:'result:'+id}];
 if(record.type==='tool/ptc-dispatch-start')return [{role:'tool',text:data.name||'工具调用',meta:detail(data.arguments),ts,id:'dispatch:'+data.subCallId}];
 if(record.type==='turn/end')return [{role:'status',text:'本轮执行结束',ts,id:'end:'+id}];
 return [];
}
