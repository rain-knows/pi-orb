import { createRunDirectory } from '../../scripts/verify/run-directory.mjs';
// Real packaged Electron/Pi Web wire fixture: cross-chat bookmarks and stopped completion reports.
// No real model, credentials, screenshots of external apps or desktop input are used.
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
const repo = resolve(import.meta.dirname, '../..');
const reportDir = createRunDirectory('ui');
const version = JSON.parse(readFileSync(join(repo,'package.json'),'utf8')).version;
const runRoot = join('D:/pi-orb-p2-runs',`reference-ui-${Date.now()}`);
const workspace = join(runRoot,'workspace');
mkdirSync(workspace,{recursive:true});
const configPath = join(runRoot,'orb-config.json');
writeFileSync(configPath,JSON.stringify({version:1,orbWorkspace:workspace,shortcut:'CommandOrControl+Shift+Space',window:{alwaysOnTop:true,x:null,y:null,width:420,height:640}}));
writeFileSync(join(runRoot,'code-agent-sessions.json'),JSON.stringify([
 {owner:'owner-main',session_id:'worker-stopped',task:'整理项目说明',cwd:workspace,status:'running',pending:false,outcome:'',tools:['read']},
 {owner:'owner-other',session_id:'worker-completed',task:'生成使用手册',cwd:workspace,status:'running',pending:false,outcome:'',tools:['read']},
]));
const commands=[];
const streams = new Map();
const server=createServer(async(req,res)=>{
 const path = new URL(req.url,'http://localhost').pathname;
 if(path==='/api/web-auth'){res.writeHead(404).end();return;}
 if(path==='/api/agent/new'){res.writeHead(200,{'content-type':'application/json'}).end(JSON.stringify({sessionId:'owner-main'}));return;}
 const stream=path.match(/^\/api\/agent\/([^/]+)\/events$/);
 if(stream){res.writeHead(200,{'content-type':'text/event-stream'});res.flushHeaders();streams.set(stream[1],res);res.on('close',()=>streams.delete(stream[1]));return;}
 const history=path.match(/^\/api\/sessions\/([^/]+)$/);
 if(history){
  const stopped=history[1]==='worker-stopped';
  res.writeHead(200,{'content-type':'application/json'}).end(JSON.stringify({info:{id:history[1],cwd:workspace},context:{messages:[{role:'assistant',stopReason:stopped?'aborted':'stop',content:[{type:'text',text:stopped?'已完成部分整理，用户手动停止。':'手册已生成。'}]}]}}));return;
 }
 if(path==='/api/sessions'){res.writeHead(200,{'content-type':'application/json'}).end(JSON.stringify({sessions:[
  {id:'owner-main',cwd:workspace,name:'项目整理',firstMessage:'整理项目',modified:new Date().toISOString()},
  {id:'owner-other',cwd:workspace,name:'使用手册',firstMessage:'编写手册',modified:new Date().toISOString()},
 ]}));return;}
 if(path==='/api/models'){res.writeHead(200,{'content-type':'application/json'}).end(JSON.stringify({modelList:[{provider:'fixture',id:'one',input:['text','image']}]}));return;}
 const agent=path.match(/^\/api\/agent\/([^/]+)$/);
 if(agent){
  const chunks=[];for await(const chunk of req)chunks.push(chunk);
  const command=JSON.parse(Buffer.concat(chunks).toString());commands.push({sessionId:agent[1],...command});
  res.writeHead(200,{'content-type':'application/json'}).end(JSON.stringify({success:true,data:command.type==='get_state'?{model:{provider:'fixture',id:'one'},isStreaming:false,isPromptRunning:false}:{} }));
  if(command.type==='prompt')setTimeout(()=>{
   const s=streams.get(agent[1]);
   const emit=value=>s?.write(`data: ${JSON.stringify(value)}\n\n`);
   emit({type:'message_update',assistantMessageEvent:{type:'text_delta',contentIndex:0,delta:'后台任务已停止，保留现有结果。'}});
   emit({type:'message_end',message:{role:'assistant',stopReason:'stop',content:[{type:'text',text:'后台任务已停止，保留现有结果。'}]}});
   emit({type:'agent_end',stopReason:'stop'});emit({type:'agent_settled'});
  },250);
  return;
 }
 res.writeHead(404).end();
});
await new Promise(done=>server.listen(0,'127.0.0.1',done));
const port=server.address().port;
const env={...process.env,PI_ORB_CONFIG:configPath,PI_ORB_PI_WEB_URL:`http://127.0.0.1:${port}`};
delete env.ELECTRON_RUN_AS_NODE;
const child=spawn(join(repo,'release',version,'win-unpacked','pi-orb.exe'),[`--user-data-dir=${join(runRoot,'userData')}`,'--remote-debugging-port=31996','--inspect=31997'],{env,stdio:['ignore','pipe','pipe'],windowsHide:true});
let logs='';child.stdout.on('data',b=>logs+=b);child.stderr.on('data',b=>logs+=b);
const sleep=ms=>new Promise(done=>setTimeout(done,ms));
const checks=[];const check=(name,ok,detail)=>{checks.push({name,ok:Boolean(ok),detail});if(!ok)throw new Error(name);};
let socket, mainSocket;
try{
 let target;
 for(let i=0;i<60;i++){try{target=(await(await fetch('http://127.0.0.1:31996/json/list')).json()).find(t=>t.type==='page');}catch{}if(target)break;await sleep(250);}
 check('packaged renderer exists',Boolean(target));
 socket=new WebSocket(target.webSocketDebuggerUrl);await new Promise(done=>socket.addEventListener('open',done,{once:true}));
 const pending=new Map();let next=0;
 socket.addEventListener('message',e=>{const m=JSON.parse(e.data.toString());if(pending.has(m.id)){const p=pending.get(m.id);pending.delete(m.id);m.error?p.reject(new Error(m.error.message)):p.resolve(m.result);}});
 const send=(method,params)=>new Promise((resolve,reject)=>{const id=++next;pending.set(id,{resolve,reject});socket.send(JSON.stringify({id,method,params}));});
 const evaluate=async expression=>{const r=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw new Error(r.exceptionDetails.exception?.description??'evaluation failed');return r.result.value;};
 const mainTarget=(await(await fetch('http://127.0.0.1:31997/json/list')).json())[0];
 mainSocket=new WebSocket(mainTarget.webSocketDebuggerUrl);await new Promise(done=>mainSocket.addEventListener('open',done,{once:true}));
 const mainPending=new Map();let mainNext=0;
 mainSocket.addEventListener('message',e=>{const m=JSON.parse(e.data.toString());if(mainPending.has(m.id)){const p=mainPending.get(m.id);mainPending.delete(m.id);m.error?p.reject(new Error(m.error.message)):p.resolve(m.result);}});
 const mainEvaluate=async expression=>{
  const r=await new Promise((resolve,reject)=>{const id=++mainNext;mainPending.set(id,{resolve,reject});mainSocket.send(JSON.stringify({id,method:'Runtime.evaluate',params:{expression,awaitPromise:true,returnByValue:true}}));});
  if(r.exceptionDetails)throw new Error(r.exceptionDetails.exception?.description??'main evaluation failed');return r.result.value;
 };
 // Capture external navigation and native menu selection only in this isolated fixture process.
 await mainEvaluate(`globalThis.__uiElectron=process.mainModule.require('electron');globalThis.__opened=[];
  __uiElectron.shell.openExternal=async url=>{__opened.push(url)};
  __uiElectron.Menu.buildFromTemplate=items=>{globalThis.__uiMenu=items;return {popup:options=>options.callback?.()}};`);
 for(let i=0;i<80;i++){if(await evaluate("typeof window.orb === 'object' && document.querySelector('#composer').hidden === false"))break;await sleep(250);}
 await evaluate('window.orb.ensureSession()');
 await evaluate("document.body.dispatchEvent(new PointerEvent('pointerenter')); true");
 for(let i=0;i<80;i++){if(await evaluate("document.querySelectorAll('.agent-chip').length === 2 && document.querySelector('[data-kind=notice]') !== null && document.querySelector('.orb-message--assistant') !== null && document.querySelector('.agent-chip').title.includes('来自对话: 使用手册')"))break;await sleep(250);}
 const ui=await evaluate(`(() => {
  const card=document.querySelector('[data-kind=notice]');
  return {chips:[...document.querySelectorAll('.agent-chip')].map(n=>({state:n.dataset.state,title:n.title,color:n.style.getPropertyValue('--agent-color')})),
   cardCount:document.querySelectorAll('[data-kind=notice]').length,folded:card?.hasAttribute('data-expanded')===false,cardText:card?.textContent,
   strip:document.body.style.getPropertyValue('--strip-w'),width:window.outerWidth,body:document.body.className,hasGuard:document.querySelector('#transcript').textContent.includes('Do not restart')};
 })()`);
 check('cross-conversation bookmarks show completed and stopped states',ui.chips.length===2&&ui.chips.some(c=>c.state==='stopped')&&ui.chips.some(c=>c.state==='completed'),ui.chips);
 check('caller attribution uses separate reference colors',new Set(ui.chips.map(c=>c.color)).size===2,ui.chips);
 check('caller attribution uses Pi Web conversation titles',ui.chips.some(c=>c.title.includes('来自对话: 项目整理'))&&ui.chips.some(c=>c.title.includes('来自对话: 使用手册')),ui.chips);
 check('bookmarks widen the real packaged window',ui.strip==='208px'&&ui.width>=552,ui);
 check('completion creates exactly one folded report',ui.cardCount===1&&ui.folded,ui);
 check('report shows partial output while hiding model instructions',ui.cardText.includes('用户手动停止')&&!ui.hasGuard,ui.cardText);
 check('Pi Web owner prompt receives the no-restart guard once',commands.filter(c=>c.type==='prompt'&&c.sessionId==='owner-main'&&c.message?.includes('Do not restart')).length===1,commands.filter(c=>c.type==='prompt').map(c=>({sessionId:c.sessionId,message:c.message})));
 check('other owner is not woken',!commands.some(c=>c.type==='prompt'&&c.sessionId==='owner-other'));
 const caps=await evaluate(`(() => {const p=document.querySelector('#panel').getBoundingClientRect(),s=document.querySelector('#stop').getBoundingClientRect();return {panel:{left:p.left,right:p.right},stop:{left:s.left,right:s.right,width:s.width}}})()`);
 check('stop cap stays inside the widened panel',caps.stop.width>0&&caps.stop.left>=caps.panel.left&&caps.stop.right<=caps.panel.right,caps);
 const snapshot=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
 writeFileSync(join(reportDir, 'bookmarks-folded.png'),Buffer.from(snapshot.data,'base64'));
 await evaluate("document.querySelector('[data-kind=notice] [role=button]').click(); true");
 check('report expands through its real click handler',await evaluate("document.querySelector('[data-kind=notice]').hasAttribute('data-expanded')"));
 const expanded=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
 writeFileSync(join(reportDir, 'bookmarks-expanded.png'),Buffer.from(expanded.data,'base64'));
 await evaluate("document.querySelector('[data-kind=notice] [role=button]').click(); true");
 check('report folds again without duplicating',await evaluate("!document.querySelector('[data-kind=notice]').hasAttribute('data-expanded') && document.querySelectorAll('[data-kind=notice]').length === 1"));
 await evaluate("document.querySelector('.agent-chip[data-state=completed]').click(); true");
 for(let i=0;i<40;i++){if(await mainEvaluate('__opened.length === 1'))break;await sleep(50);}
 check('bookmark click opens the exact public Pi Web session URL once',JSON.stringify(await mainEvaluate('__opened'))===JSON.stringify([`http://127.0.0.1:${port}/?session=worker-completed`]));
 check('bookmark click keeps the Orb owner active and hides the read finished bookmark',await evaluate("(async()=>{const items=await window.orb.getAgentBookmarks();return await window.orb.ensureSession()==='owner-main'&&!items.some(i=>i.sessionId==='worker-completed')})()"));
 check('unknown bookmarks cannot open arbitrary sessions',await evaluate("window.orb.openAgent('unregistered').then(()=>false,()=>true)"));
 await evaluate("window.orb.openShellMenu({isEditable:false,canCut:false,canCopy:false,canPaste:false,canSelectAll:false,hasSelectionContext:false})");
 check('observation ribbon menu defaults to enabled',await mainEvaluate("__uiMenu.find(i=>i.label==='观察框彩带').checked===true"));
 await mainEvaluate("__uiMenu.find(i=>i.label==='观察框彩带').click();true");
 const preferencePath=join(runRoot,'userData','observation-frame.json');
 check('native ribbon toggle persists into isolated userData',JSON.parse(readFileSync(preferencePath,'utf8')).enabled===false);
 await evaluate("window.orb.openShellMenu({isEditable:false,canCut:false,canCopy:false,canPaste:false,canSelectAll:false,hasSelectionContext:false})");
 check('reopening the ribbon menu reads the disabled preference',await mainEvaluate("__uiMenu.find(i=>i.label==='观察框彩带').checked===false"));
}catch(error){checks.push({name:'probe completed',ok:false,detail:error.message});}
finally{socket?.close();mainSocket?.close();child.kill();for(const s of streams.values())s.end();server.close();await sleep(750);}
const result={at:new Date().toISOString(),runRoot,kind:'real packaged Electron with deterministic Pi Web wire fixture; no real model or OS pointer input',checks,passed:checks.length>0&&checks.every(c=>c.ok),logs:logs.slice(-2000)};
writeFileSync(join(reportDir, 'ui-probe.json'),JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify({passed:result.passed,checks:checks.length,failed:checks.filter(c=>!c.ok)}));
if(!result.passed)process.exitCode=1;
