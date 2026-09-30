/** 100 trials per candidate/scenario; fixture state at capture start is authoritative. */
import { app } from "electron";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { ReferenceWindowsDriver } from "../../src/main/reference-windows-driver";
import { createWindowsDesktopBackend } from "../../src/main/reference-windows/windows";
import { createProductionWindowsOps } from "../../src/main/reference-windows/windows-native";
import type { DesktopAction, DesktopObservation } from "../../src/shared/orb-tools";

async function main(){
 const root=resolve(`.tmp/tool-speed/wait-${Date.now()}`);mkdirSync(root,{recursive:true});
 const env={...process.env,PI_ORB_SPEED_ROOT:root};delete env.ELECTRON_RUN_AS_NODE;
 const target=spawn(resolve('node_modules/electron/dist/electron.exe'),[resolve('evidence/tool-speed/target-app')],{env,stdio:'ignore',windowsHide:true});
 const sleep=(ms:number)=>new Promise(r=>setTimeout(r,ms));
 const progressPath=resolve('evidence/tool-speed/wait-progress.json');
 const report:{candidate:number;scenario:string;passed:number;failed:number;durations:number[];errors:string[]}[]=process.argv.includes('--resume')&&existsSync(progressPath)?JSON.parse(readFileSync(progressPath,'utf8')).report:[];
 try {
  for(let i=0;i<100&&!existsSync(join(root,'geometry.json'));i++)await sleep(100);
  if(!existsSync(join(root,'geometry.json')))throw new Error('Target missing');await sleep(300);
  const geometry=JSON.parse(readFileSync(join(root,'geometry.json'),'utf8'));
  // An append can be observed mid-line. Only complete JSONL records are committed events.
  const events=()=>existsSync(join(root,'events.jsonl'))?readFileSync(join(root,'events.jsonl'),'utf8').split(/\r?\n/).slice(0,-1).filter(Boolean).map(l=>JSON.parse(l)):[];
  const ops=createProductionWindowsOps();const original=createWindowsDesktopBackend(ops);
  let capturedEvents:Record<string,unknown>[]=[];
  const backend={...original,capture:async(...args:Parameters<typeof original.capture>)=>{capturedEvents=events();return original.capture(...args);}};
  for(const candidate of [600,400,200])for(const scenario of ['click','type-submit','hotkey','menu','dialog']){
   if(report.some(r=>r.candidate===candidate&&r.scenario===scenario&&r.passed+r.failed===100))continue;
   const result={candidate,scenario,passed:0,failed:0,durations:[] as number[],errors:[] as string[]};report.push(result);
   const driver=new ReferenceWindowsDriver({ops,backend,ownProcessId:process.pid,postActionWaitMs:candidate});
   for(let trial=0;trial<100;trial++){
    const nonce=`${candidate}-${scenario}-${trial}`;writeFileSync(join(root,'control.json'),JSON.stringify({nonce}));
    let acknowledged=false;
    for(let i=0;i<100;i++){
     try {acknowledged=existsSync(join(root,'control-ack.json'))&&JSON.parse(readFileSync(join(root,'control-ack.json'),'utf8')).nonce===nonce;}catch{/* Writer has not finished its acknowledgement yet. */}
     if(acknowledged)break;await sleep(10);
    }
    if(!acknowledged)throw new Error('Target did not acknowledge reset');
    const observed=await driver.observe({includeImage:true});
    if(!observed.ok||observed.observation?.window.title!=='Orb speed target')throw new Error('Unsafe trial: target not selected');
    const obs:DesktopObservation=observed.observation;
    const point=(id:string)=>{const p=geometry.points[id];const b=obs.window.bounds;return {x:Math.round((p.x-b.x)/b.width*1000),y:Math.round((p.y-b.y)/b.height*1000)};};
    const from=events().length;
    const action:DesktopAction=scenario==='hotkey'?{kind:'hotkey',observationId:obs.observationId,keys:['ctrl','a']}:
     scenario==='type-submit'?{kind:'type',observationId:obs.observationId,position:point('text'),text:nonce,replace:true,submit:true}:
     {kind:'click',observationId:obs.observationId,position:point(scenario==='click'?'a':scenario)};
    const start=performance.now();const outcome=await driver.act(action,obs);result.durations.push(performance.now()-start);
    const atCapture=capturedEvents.slice(from);
    const expected=scenario==='click'?atCapture.some(e=>e.kind==='click'&&e.id==='a'):scenario==='type-submit'?atCapture.some(e=>e.kind==='submit'&&e.value===nonce):scenario==='hotkey'?atCapture.some(e=>e.kind==='keyup'&&String(e.key).toLowerCase()==='a'):atCapture.some(e=>e.kind===`${scenario}-ready`);
    if(outcome.ok&&expected)result.passed++;else {result.failed++;if(result.errors.length<3)result.errors.push(outcome.ok?'Target was not ready at capture start':outcome.error??'failed');}
   }
   console.log(JSON.stringify({candidate,scenario,passed:result.passed,failed:result.failed}));
   writeFileSync(progressPath,JSON.stringify({terminal:false,report},null,2));
  }
  const p95=(values:number[])=>[...values].sort((a,b)=>a-b)[Math.ceil(values.length*.95)-1]!;
  const eligible=[200,400].filter(candidate=>report.filter(r=>r.candidate===candidate).every(r=>r.passed===100&&p95(r.durations)<=p95(report.find(b=>b.candidate===600&&b.scenario===r.scenario)!.durations)*.8));
  const selected=eligible[0]??600;
  writeFileSync(resolve('evidence/tool-speed/wait-experiment.json'),JSON.stringify({terminal:true,method:'real native adapter, target event readback at capture start, no model',trialsPerScenario:100,selected,report},null,2)+'\n');
  console.log(`Selected ${selected}ms`);
 }finally{if(target.pid)spawn('taskkill',['/PID',String(target.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});}
}
void app.whenReady().then(main).then(()=>app.quit(),error=>{console.error(error);app.exit(1);});
