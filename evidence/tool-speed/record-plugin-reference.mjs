// Read-only source/port manifest. The reference paths are development inputs, never runtime imports.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
const root='D:\\pi-orb-ref\\dsh-orb-cordis';
const commit='9cdc50302d202f4497569731be488a8afa500da7';
const git=(...args)=>execFileSync('git',['-C',root,...args],{encoding:'utf8'}).trim();
if(git('rev-parse','HEAD')!==commit||git('status','--porcelain'))throw new Error('Plugin reference must be clean at its pinned commit');
const sha256=path=>createHash('sha256').update(readFileSync(path)).digest('hex');
const ports=[
 {source:'packages/computer-use/src/raster.ts',target:'src/shared/observation-raster.ts',adaptation:'Header parser copied; unused export policy helpers removed'},
 {source:'packages/computer-use/src/coordinates.ts',target:'src/shared/pixel-coordinates.ts',adaptation:'Pixel validator and HID formula copied; Cordis imports and dual-mode branch removed'},
];
const sourceFiles=['LICENSE','THIRD-PARTY-NOTICES.md','docs/02-architecture.md','packages/computer-use/src/coordinate-mode.ts','packages/computer-use/src/observe.ts','packages/computer-use/src/policy.ts','packages/computer-use/src/config.ts'];
const record={at:new Date().toISOString(),repository:'https://github.com/rain-knows/dsh-orb-cordis',checkout:root,commit,clean:true,license:'MIT; mini-yifan, derived Computer Use DeepSeek',ports:ports.map(p=>({...p,sourceSha256:sha256(join(root,p.source)),targetSha256:sha256(p.target),provenanceHeader:readFileSync(p.target,'utf8').includes(commit)&&readFileSync(p.target,'utf8').includes('MIT')})),sources:sourceFiles.map(path=>({path,sha256:sha256(join(root,path))}))};
record.passed=record.ports.every(p=>p.provenanceHeader);
writeFileSync('evidence/tool-speed/plugin-reference.json',JSON.stringify(record,null,2)+'\n');
console.log(JSON.stringify({commit,clean:record.clean,ports:record.ports.length,passed:record.passed}));
if(!record.passed)process.exitCode=1;
