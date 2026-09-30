/** Native baseline: real input/readback, no model and no screenshot persistence. */
import { app } from "electron";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { DesktopBroker } from "../../src/main/desktop-broker";
import { ReferenceWindowsDriver } from "../../src/main/reference-windows-driver";
import { createWindowsDesktopBackend } from "../../src/main/reference-windows/windows";
import { createProductionWindowsOps } from "../../src/main/reference-windows/windows-native";
import { withToolTiming } from "../../src/shared/tool-timing";
import type { DesktopAction, DesktopObservation } from "../../src/shared/orb-tools";

async function main() {
  const root=resolve(`.tmp/tool-speed/native-${Date.now()}`);mkdirSync(root,{recursive:true});
  const env={...process.env,PI_ORB_SPEED_ROOT:root};delete env.ELECTRON_RUN_AS_NODE;
  const target=spawn(resolve('node_modules/electron/dist/electron.exe'),[resolve('evidence/tool-speed/target-app')],{env,stdio:'ignore',windowsHide:true});
  const sleep=(ms:number)=>new Promise(r=>setTimeout(r,ms));
  const records:Record<string,unknown>[]=[]; const samples:Record<string,number[]>={};
  try {
    for(let i=0;i<100&&!existsSync(join(root,'geometry.json'));i++)await sleep(100);
    if(!existsSync(join(root,'geometry.json')))throw new Error('Target startup failed');
    await sleep(300);
    const geometry=JSON.parse(readFileSync(join(root,'geometry.json'),'utf8'));
    const ops=createProductionWindowsOps();const backend=createWindowsDesktopBackend(ops);
    const driver=new ReferenceWindowsDriver({ops,backend,ownProcessId:process.pid});
    let observation:DesktopObservation;
    const observe=async()=>{const result=await driver.observe({includeImage:true});if(!result.ok||result.observation?.window.title!=='Orb speed target')throw new Error('Disposable target lost focus');observation=result.observation;};
    const point=(id:string)=>{const p=geometry.points[id];const b=observation.window.bounds;return {x:Math.round((p.x-b.x)/b.width*1000),y:Math.round((p.y-b.y)/b.height*1000)};};
    const events=()=>existsSync(join(root,'events.jsonl'))?readFileSync(join(root,'events.jsonl'),'utf8').trim().split(/\r?\n/).filter(Boolean).map(l=>JSON.parse(l)):[];
    const act=async(action:DesktopAction)=>{const result=await driver.act(action,observation);if(!result.ok)throw new Error(result.error??'Action failed');observation=result.observation;};
    const measure=async(name:string,run:()=>Promise<void>)=>{const start=performance.now();await withToolTiming(`${name}-${records.length}`,e=>records.push(e),run);(samples[name]??=[]).push(performance.now()-start);};
    await measure('cold-observe',observe);
    if(!process.argv.includes("--batch")) {
    for(let i=0;i<10;i++) {
      const before=events().filter(e=>e.kind==='click'&&e.id==='a').length;
      await measure('click',()=>act({kind:'click',observationId:observation.observationId,position:point('a')}));
      if(events().filter(e=>e.kind==='click'&&e.id==='a').length!==before+1)throw new Error('Click readback failed: '+JSON.stringify({geometry,window:observation.window,events:events()}));
      await measure('type',()=>act({kind:'type',observationId:observation.observationId,position:point('text'),text:`sample-${i}`,replace:true,submit:true}));
      if(!events().some(e=>e.kind==='submit'&&e.value===`sample-${i}`))throw new Error('Type/submit readback failed');
      await measure('hotkey',()=>act({kind:'hotkey',observationId:observation.observationId,keys:['ctrl','a']}));
      await measure('three-controls',async()=>{for(const id of ['a','b','c'])await act({kind:'click',observationId:observation.observationId,position:point(id)});});
    }
    for(let i=0;i<20;i++)await measure('warm-observe',observe);
    }
    if(process.argv.includes('--batch')) {
      const broker=new DesktopBroker({driver,isLive:()=>true});broker.authorize({sessionId:'native',generation:1,level:'full-access'});
      for(let i=0;i<10;i++) {
        await broker.observe('native',1);observation=driver.lastObservation!;
        const before=events().filter(e=>e.kind==='click').length;
        await measure('batch-three-controls',async()=>{
          const result=await broker.batch({observationId:observation.observationId,actions:['a','b','c'].map(id=>({kind:'click',position:point(id)}))},'native',1) as {ok:boolean;completed:number};
          if(!result.ok||result.completed!==3)throw new Error('Native batch incomplete');
        });
        const received=events().filter(e=>e.kind==='click').slice(before).map(e=>e.id);
        if(received.join(',')!=='a,b,c')throw new Error('Native batch order failed');
      }
    }
    const stats=Object.fromEntries(Object.entries(samples).map(([name,values])=>{const sorted=[...values].sort((a,b)=>a-b);return [name,{n:values.length,p50:sorted[Math.ceil(sorted.length*.5)-1],p95:sorted[Math.ceil(sorted.length*.95)-1]}];}));
    const report={at:new Date().toISOString(),method:'direct production native adapter; excludes Orb overlay, Pi, bridge and model; no pixels persisted',model:null,thinkingLevel:null,stats,samples,records,passed:true};
    writeFileSync(resolve(process.argv.includes('--batch')?'evidence/tool-speed/native-batch.json':'evidence/tool-speed/native-baseline.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(stats));
  } finally {if(target.pid)spawn('taskkill',['/PID',String(target.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});}
}
void app.whenReady().then(main).then(()=>app.quit(),e=>{console.error(e);app.exit(1);});
