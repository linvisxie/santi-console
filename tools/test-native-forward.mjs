import {WorkbenchClient} from '../runtime/resources/app/lib/workbench-client.mjs';
import fs from 'node:fs';
process.env.CONSOLE_WORKBENCH_DIR='D:/santi-console/tools/.bridge-live-test';fs.mkdirSync(process.env.CONSOLE_WORKBENCH_DIR,{recursive:true});if(!fs.existsSync(process.env.CONSOLE_WORKBENCH_DIR+'/store.json'))fs.copyFileSync('D:/santi-console/runtime/resources/app/.workbench/store.json',process.env.CONSOLE_WORKBENCH_DIR+'/store.json');
const app='D:\\santi-console\\runtime\\resources\\app',c=new WorkbenchClient(app);
const s=JSON.parse(fs.readFileSync(app+'/.workbench/store.json'));
const v=s.conversations.find(x=>x.nativeId==='<session-id>');
console.log(await c.request('/tasks','POST',{conversationId:v.id,clientRequestId:'bridge-e2e-20261102-1',prompt:'【三体完整链路测试】经过任务服务和适配器投递，收到后仅确认收到，保留开发任务。',mode:'read'}));
