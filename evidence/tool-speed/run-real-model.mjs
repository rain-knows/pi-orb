// Real Pi Web + provider + product broker, isolated disposable target only.
// Reuses the P1-06 acceptance topology; never edits provider configuration.
import { spawn, execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, linkSync, symlinkSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
const repo=resolve('.'), stamp=Date.now(), root=resolve(`.tmp/tool-speed/model-${stamp}`);
const workspace=join(root,'workspace'), shellData=join(root,'shell'), agent=join(tmpdir(),`pi-orb-speed-agent-${stamp}`);
const config=join(root,'orb-config.json'), binary=resolve('node_modules/electron/dist/electron.exe');
const piWebTree=join(tmpdir(),'pi-orb-p0-head-src'), port=40000+process.pid%8000, debug=port+1;
const password='isolated-speed-probe', base=`http://127.0.0.1:${port}`, authorization=`Basic ${Buffer.from(`pi:${password}`).toString('base64')}`;
const model={provider:'TZcode',id:'deepseek-v4.1-flash',thinking:'off'};
for(const dir of [root,workspace,shellData,agent])mkdirSync(dir,{recursive:true});
const children=[];let webLog='',shellLog='';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const report={method:'real provider, Pi Web, product pipe/broker/native driver, disposable target readback',model,rows:[],passed:false};
report.fixture=process.argv.includes('--large-controls')?'large independent controls':'compact independent controls';
const output=resolve(process.argv.includes('--long-only')?'evidence/tool-speed/real-model-long-20.json':process.argv.includes('--large-controls')?'evidence/tool-speed/real-model-large-controls.json':'evidence/tool-speed/real-model.json');
function jsonl(file){if(!existsSync(file))return [];return readFileSync(file,'utf8').split(/\r?\n/).flatMap(line=>{try{return [JSON.parse(line)];}catch{return [];}});}
function messages(){const dir=join(agent,'sessions');if(!existsSync(dir))return [];return readdirSync(dir,{withFileTypes:true}).filter(x=>x.isDirectory()).flatMap(x=>readdirSync(join(dir,x.name)).filter(f=>f.endsWith('.jsonl')).flatMap(f=>jsonl(join(dir,x.name,f)))).filter(x=>x.message).map(x=>x.message);}
function run(cmd,args,options={}){const child=spawn(cmd,args,{windowsHide:true,stdio:['ignore','pipe','pipe'],...options});children.push(child);return child;}
async function until(test,timeout=60000){const deadline=Date.now()+timeout;while(Date.now()<deadline){try{const result=await test();if(result)return result;}catch{}await sleep(200);}throw new Error('Probe timed out');}
async function cdp(){const targets=await until(async()=>{const r=await fetch(`http://127.0.0.1:${debug}/json/list`);const rows=await r.json();return rows.find(t=>t.type==='page'&&t.webSocketDebuggerUrl);});
 const socket=new WebSocket(targets.webSocketDebuggerUrl);await new Promise((r,j)=>{socket.addEventListener('open',r,{once:true});socket.addEventListener('error',j,{once:true});});let id=0;const pending=new Map();
 socket.addEventListener('message',event=>{const value=JSON.parse(event.data.toString());if(pending.has(value.id)){const {r,j}=pending.get(value.id);pending.delete(value.id);value.error?j(new Error(value.error.message)):r(value.result);}});
 socket.addEventListener('close',()=>{for(const {j} of pending.values())j(new Error('Isolated renderer disconnected'));pending.clear();});
 const send=(method,params={})=>new Promise((r,j)=>{const current=++id;const timer=setTimeout(()=>{pending.delete(current);j(new Error('CDP command timed out'));},60000);pending.set(current,{r:value=>{clearTimeout(timer);r(value);},j:error=>{clearTimeout(timer);j(error);}});socket.send(JSON.stringify({id:current,method,params}));});
 return async expression=>{const value=await send('Runtime.evaluate',{expression:`(async()=>JSON.stringify(await (${expression})))()`,awaitPromise:true,returnByValue:true});if(value.exceptionDetails)throw new Error(value.exceptionDetails.text);return value.result?.value?JSON.parse(value.result.value):null;};
}
try{
 const real=join(process.env.USERPROFILE,'.pi','agent');linkSync(join(real,'models.json'),join(agent,'models.json'));if(existsSync(join(real,'auth.json')))symlinkSync(join(real,'auth.json'),join(agent,'auth.json'));
 writeFileSync(join(agent,'settings.json'),JSON.stringify({defaultProvider:model.provider,defaultModel:model.id,defaultThinkingLevel:model.thinking,defaultTools:['read'],extensions:[resolve('pi-package/extensions/orb.ts')],enableInstallTelemetry:false,enableAnalytics:false}));
 writeFileSync(config,JSON.stringify({version:1,orbWorkspace:workspace,shortcut:'Control+Alt+F11',window:{alwaysOnTop:true,x:60,y:60,width:445,height:632}}));
 const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
 const target=run(binary,[resolve('evidence/tool-speed/target-app'),`--user-data-dir=${join(root,'target-data')}`],{env:{...env,PI_ORB_SPEED_ROOT:root,PI_ORB_SPEED_LARGE_CONTROLS:process.argv.includes('--large-controls')?'1':'0'}});
 await until(()=>existsSync(join(root,'geometry.json')));
 const web=run(process.execPath,[join(piWebTree,'node_modules/next/dist/bin/next'),'start','-p',String(port),'-H','127.0.0.1'],{cwd:piWebTree,env:{...env,NODE_ENV:'production',NEXT_TELEMETRY_DISABLED:'1',PI_WEB_NO_OPEN:'1',PI_WEB_SKIP_VERSION_CHECK:'1',PI_WEB_PASSWORD:password,PI_CODING_AGENT_DIR:agent,PI_ORB_CONFIG:config,PI_ORB_BRIDGE_TOKEN_FILE:join(shellData,'bridge-token.json')}});
 for(const stream of [web.stdout,web.stderr])stream.on('data',x=>webLog+=x.toString());
 await until(async()=>{const r=await fetch(base+'/login');return r.status<500;});
 const shell=run(binary,['.',`--user-data-dir=${shellData}`,`--remote-debugging-port=${debug}`],{cwd:repo,env:{...env,PI_ORB_CONFIG:config,PI_ORB_PI_WEB_URL:base,PI_ORB_PI_WEB_PASSWORD:password}});
 shell.on('exit',(code,signal)=>{if(!report.finishedAt){report.shellExit={code,signal};writeFileSync(output,JSON.stringify(report,null,2)+'\n');}});
 for(const stream of [shell.stdout,shell.stderr])stream.on('data',x=>shellLog+=x.toString());
 const orb=await cdp();await orb(`window.orb.setWorkspace(${JSON.stringify(workspace)},true)`);await orb('window.orb.ensureSession()');
 const hwnd=Number(execFileSync('powershell.exe',['-NoProfile','-Command',`(Get-Process -Id ${target.pid}).MainWindowHandle.ToInt64()`],{encoding:'utf8',windowsHide:true}).trim());if(!hwnd)throw new Error('No disposable target handle');
 // Each trial gets a fresh conversation; same model and thinking level for both modes.
 for(const mode of process.argv.includes('--long-only')?['long-20']:['single','batch','single','batch','single','batch','menu']){
  const index=report.rows.length;
  await orb('window.orb.newConversation()');const status=await orb('window.orb.getStatus()');
  const nonce=`real-${index}`;writeFileSync(join(root,'control.json'),JSON.stringify({nonce}));await until(()=>JSON.parse(readFileSync(join(root,'control-ack.json'),'utf8')).nonce===nonce);
  execFileSync('powershell.exe',['-NoProfile','-File',resolve('evidence/lib/activate-window.ps1'),'-Hwnd',String(hwnd),'-ForegroundOnly'],{windowsHide:true,stdio:'ignore'});
  const access=await orb(`window.orb.setOrbAccess({generation:${status.generation},level:'full-access'})`);if(!access?.authorized)throw new Error('Isolated session grant failed');
  const before=messages().length, beforeEvents=jsonl(join(root,'events.jsonl')).length, beforeLog=webLog.length;
  const text=mode==='long-20'?'本次验证图片上下文预算。只对 Orb speed target 连续调用 orb_observe 恰好 20 次，不使用其他工具，不点击、输入或切换窗口。可在同一次响应中列出多个观察调用，工具会串行运行。每个调用须真正执行，不用文字模拟。全部完成后用一句话结束。':mode==='menu'?'先用 orb_observe 观察 Orb speed target。打开“打开菜单”，再点击新出现的“菜单项”。菜单项只有打开菜单后才可见，因此必须分步执行，不得放在同一批次。只操作该测试窗口，完成即结束。':`先用 orb_observe 观察 Orb speed target。按 A、B、C 顺序各点击一次，三个按钮在初始截图中均已可见且互相独立。${mode==='single'?'本次对照仅使用单步 orb_click，不使用 orb_batch。每次使用上一步返回的新观察编号。':'使用 orb_batch 一次提交三个独立按钮动作，根据截图自行判断坐标。'}动作已有新截图，不重复观察。只操作该测试窗口，完成即结束。`;
  const start=performance.now();await orb(`window.orb.sendPrompt({generation:${status.generation},text:${JSON.stringify(text)}})`);
  let finished=false;const deadline=Date.now()+180000;
  while(Date.now()<deadline){await sleep(500);const added=messages().slice(before);const assistants=added.filter(m=>m.role==='assistant');if(assistants.length&&['stop','error'].includes(assistants.at(-1).stopReason)){finished=true;break;}}
  if(!finished)await orb(`window.orb.abort({generation:${status.generation}})`);
  const totalMs=performance.now()-start, added=messages().slice(before), assistants=added.filter(m=>m.role==='assistant');
  const calls=assistants.flatMap((m,response)=>m.content.filter(b=>b.type==='toolCall').map(b=>({response,name:b.name,arguments:b.arguments})));
  const events=jsonl(join(root,'events.jsonl')).slice(beforeEvents).filter(e=>['click','menu-click','menu-ready','menu-item'].includes(e.kind)).map(e=>({kind:e.kind,id:e.id}));
  const budgets=webLog.slice(beforeLog).split(/\r?\n/).flatMap(line=>{const pos=line.indexOf('[pi-orb] image-budget ');if(pos<0)return [];try{return [JSON.parse(line.slice(pos+'[pi-orb] image-budget '.length))];}catch{return [];}});
  const succeeded=finished&&(mode==='long-20'?calls.filter(c=>c.name==='orb_observe').length===20&&calls.every(c=>c.name==='orb_observe')&&budgets.every(b=>b.images<=3):mode==='menu'?events.some(e=>e.kind==='menu-item')&&!calls.some(c=>c.name==='orb_batch'):events.filter(e=>e.kind==='click').map(e=>e.id).join(',')==='a,b,c');
  const row={mode,succeeded,finished,totalMs,modelResponses:assistants.length,toolCalls:calls,events,imageBudgets:budgets,toolResultImages:added.filter(m=>m.role==='toolResult').map(m=>({tool:m.toolName,text:m.content.filter(b=>b.type==='text').map(b=>b.text).join('\n'),count:m.content.filter(b=>b.type==='image').length,encodedBytes:m.content.filter(b=>b.type==='image').reduce((n,b)=>n+Buffer.byteLength(b.data,'base64'),0)})),errors:assistants.filter(m=>m.stopReason==='error').map(m=>m.errorMessage??'provider error')};
  report.rows.push(row);writeFileSync(output,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({mode,succeeded,totalMs,modelResponses:row.modelResponses,tools:calls.map(c=>c.name)}));
 }
 report.passed=report.rows.every(r=>r.succeeded)&&report.rows.filter(r=>r.mode==='batch').every(r=>r.toolCalls.some(c=>c.name==='orb_batch'&&c.arguments?.actions?.length===3));
}catch(error){report.error=String(error.message??error);console.log('Real model probe: '+report.error);}
finally{
 report.diagnostics=shellLog.split(/\r?\n/).filter(line=>line.includes('window-validation')||line.includes('act-failed')||line.includes('Unhandled')||line.includes('FATAL')||line.includes('Check failed')).slice(-20);
 report.finishedAt=new Date().toISOString();writeFileSync(output,JSON.stringify(report,null,2)+'\n');
 for(const child of children.reverse())if(child.pid)try{execFileSync('taskkill.exe',['/PID',String(child.pid),'/T','/F'],{stdio:'ignore',windowsHide:true});}catch{}
 // Remove only our known credential links, leaving synthetic session history for review.
 for(const file of ['models.json','auth.json']){const path=join(agent,file);if(existsSync(path)){const {unlinkSync}=await import('node:fs');unlinkSync(path);}}
}
if(!report.passed)process.exitCode=1;
