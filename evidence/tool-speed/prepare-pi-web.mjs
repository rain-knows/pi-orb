// Prepare only an isolated committed source snapshot. Never modifies the user's pi-web or Pi config.
import { execFileSync, spawn } from 'node:child_process';
import { mkdirSync, existsSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
const source=process.env.PI_ORB_P0_PI_WEB??'C:\\Users\\JUSTLIKEZYP\\OneDrive\\文档\\daily\\pi-web';
const commit='95a58744532c7fccaa933aa7757a1419ace67ed2';
const destination=resolve('.tmp/plugin-pointing/pi-web');
mkdirSync(destination,{recursive:true});
if(!existsSync(join(destination,'package.json'))){
 const archive=execFileSync('git',['-C',source,'archive','--format=tar',commit],{maxBuffer:512*1024*1024});
 execFileSync('tar',['-x','-f','-','-C',destination],{input:archive,maxBuffer:512*1024*1024});
 writeFileSync(join(destination,'evidence-source.json'),JSON.stringify({source,commit})+'\n');
}
const run=(args,nodeEnv)=>new Promise((done,reject)=>{
 const env={...process.env,NODE_ENV:nodeEnv,NEXT_TELEMETRY_DISABLED:'1',NODE_OPTIONS:'--max-old-space-size=4096'};
 const child=spawn('npm.cmd',args,{cwd:destination,env,stdio:'inherit',shell:true,windowsHide:true});
 child.once('error',reject);child.once('exit',code=>code===0?done():reject(new Error(`Isolated npm ${args.join(' ')} exited ${code}`)));
});
if(!existsSync(join(destination,'node_modules/next/dist/bin/next')))await run(['ci','--no-audit','--no-fund'],'development');
if(!existsSync(join(destination,'.next/BUILD_ID')))await run(['run','build'],'production');
console.log(`PI_ORB_EVIDENCE_PI_WEB=${destination}`);
