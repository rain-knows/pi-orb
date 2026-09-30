/** Native batch readback: window change and revoke during held mouse input. */
import { app } from 'electron';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import koffi from 'koffi';
import { DesktopBroker } from '../../src/main/desktop-broker';
import { ReferenceWindowsDriver } from '../../src/main/reference-windows-driver';
import { createWindowsDesktopBackend } from '../../src/main/reference-windows/windows';
import { createProductionWindowsOps } from '../../src/main/reference-windows/windows-native';
import type { DesktopObservation } from '../../src/shared/orb-tools';
async function main(){
 const root=resolve(`.tmp/tool-speed/safety-${Date.now()}`);mkdirSync(root,{recursive:true});
 const env={...process.env,PI_ORB_SPEED_ROOT:root};delete env.ELECTRON_RUN_AS_NODE;
 const target=spawn(resolve('node_modules/electron/dist/electron.exe'),[resolve('evidence/tool-speed/target-app')],{env,stdio:'ignore',windowsHide:true});
 const sleep=(ms:number)=>new Promise(r=>setTimeout(r,ms));
 const events=():Record<string,unknown>[]=>existsSync(join(root,'events.jsonl'))?readFileSync(join(root,'events.jsonl'),'utf8').split(/\r?\n/).slice(0,-1).filter(Boolean).map(l=>JSON.parse(l)):[];
 const checks:{name:string;ok:boolean;detail:unknown}[]=[];
 const check=(name:string,ok:boolean,detail:unknown)=>checks.push({name,ok,detail});
 try{
  for(let i=0;i<100&&!existsSync(join(root,'geometry.json'));i++)await sleep(100);
  const geometry=JSON.parse(readFileSync(join(root,'geometry.json'),'utf8'));
  const ops=createProductionWindowsOps(),driver=new ReferenceWindowsDriver({ops,backend:createWindowsDesktopBackend(ops),ownProcessId:process.pid});
  const broker=new DesktopBroker({driver,isLive:()=>true});
  const setup=async(nonce:string)=>{
   writeFileSync(join(root,'control.json'),JSON.stringify({nonce}));
   let acknowledged=false;
   for(let i=0;i<100;i++){try{acknowledged=JSON.parse(readFileSync(join(root,'control-ack.json'),'utf8')).nonce===nonce;}catch{}if(acknowledged)break;await sleep(10);}
   if(!acknowledged)throw new Error('Reset not acknowledged');
   const own=ops.listWindows().windows.find(w=>w.pid===target.pid&&w.title==='Orb speed target');
   if(!own||!ops.focusWindow(own.hwnd))throw new Error('Disposable target could not be foregrounded');await sleep(100);
   broker.authorize({sessionId:'native',generation:1,level:'full-access'});await broker.observe('native',1);
   if(driver.lastObservation?.window.title!=='Orb speed target')throw new Error('Unsafe target');
  };
  const point=(id:string)=>{const obs=driver.lastObservation as DesktopObservation,p=geometry.points[id],b=obs.window.bounds;return {x:Math.round((p.x-b.x)/b.width*1000),y:Math.round((p.y-b.y)/b.height*1000)};};
  await setup('surface');let before=events().length;
  const changed=await broker.batch({observationId:driver.lastObservation!.observationId,actions:[{kind:'click',position:point('dialog')},{kind:'click',position:point('a')}]},'native',1) as Record<string,unknown>;
  check('new native dialog aborts batch after its first step',changed.reason==='surface-changed'&&changed.completed===1,{reason:changed.reason,completed:changed.completed});
  check('no remaining button input after window change',!events().slice(before).some(e=>e.kind==='click'),events().slice(before).map(e=>({kind:e.kind,id:e.id})));
  await setup('stop');before=events().length;
  const pending=broker.batch({observationId:driver.lastObservation!.observationId,actions:[{kind:'hotkey',keys:['ctrl','a']},{kind:'longPress',position:point('text'),durationSeconds:3},{kind:'click',position:point('c')}]},'native',1);
  let pressed=false;
  for(let i=0;i<400;i++){pressed=events().slice(before).some(e=>e.kind==='mousedown'&&e.id==='text');if(pressed)break;await sleep(10);}
  if(!pressed)throw new Error('Held mouse action did not start');broker.revoke();const stopped=await pending as Record<string,unknown>;await sleep(100);
  const after=events().slice(before);
  check('Stop keeps only the completed first step',stopped.ok===false&&stopped.completed===1,{reason:stopped.reason,completed:stopped.completed});
  check('Stop prevents final input',!after.some(e=>e.kind==='click'&&e.id==='c'),after.map(e=>({kind:e.kind,id:e.id,key:e.key})));
  check('target received mouse release',after.some(e=>e.kind==='mouseup'&&e.id==='text'),null);
  check('target received Control key release',after.some(e=>e.kind==='keyup'&&e.key==='Control'),null);
  const keyState=koffi.load('user32.dll').func('int16 __stdcall GetAsyncKeyState(int key)');
  const held=[1,0x10,0x11,0x12].filter(k=>(keyState(k)&0x8000)!==0);
  check('native mouse and modifiers are released',held.length===0,{heldVirtualKeys:held});
  const report={method:'real native input and disposable target events; no model',checks,passed:checks.every(c=>c.ok)};
  writeFileSync(resolve('evidence/tool-speed/native-batch-safety.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
  if(!report.passed)throw new Error('Native batch safety checks failed');
 }finally{if(target.pid)spawn('taskkill',['/PID',String(target.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});}
}
void app.whenReady().then(main).then(()=>app.quit(),e=>{console.error(e);app.exit(1);});
