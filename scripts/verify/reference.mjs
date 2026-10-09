import { createRunDirectory } from './run-directory.mjs';
// Complete upstream-delta coverage and current port provenance. Reference trees are read-only inputs.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
const repo = resolve(import.meta.dirname, '../..');
const reportDir = createRunDirectory('reference');
const root = 'D:/pi-orb-ref/dsh-orb-cordis-20261009';
const commit = 'aa79308e47265b7d4a774edb688de2bbd7dce66e';
const base = '9cdc50302d202f4497569731be488a8afa500da7';
const git = (...args) => execFileSync('git', ['-C', root, ...args], {encoding:'utf8'}).trim();
if (git('rev-parse','HEAD') !== commit || git('status','--porcelain')) throw new Error('Reference must be clean at the fixed commit');
const ports = [
 ['packages/helper/src/geometry.ts','src/main/floating-geometry.ts','Direct class/algorithms; Pi export names and OS reduced-motion gate'],
 ['packages/helper/src/main.ts','src/main/floating-window-controller.ts','Electron cursor/display adapter for the directly ported placement class'],
 ['packages/host/src/orb.ts','src/main/index.ts','Caller titles/cache, Pi public session navigation and observation menu boundaries'],
 ['packages/helper/assets/shell.js','src/renderer/floating.js','Direct gestures/bookmarks/folded card; Pi IPC and text rendering replace helper transport/markdown'],
 ['packages/helper/assets/floating.css','src/renderer/floating.css','Direct strip selectors and anchor corrections; Pi root theme selector'],
 ['packages/helper/assets/chat.css','src/renderer/reference-notice.css','Direct fold styles, mapped Pi tokens and plain text body'],
 ['packages/computer-use/src/gui-lock.ts','src/main/gui-lock.ts','Direct mutex; Pi Symbol namespace'],
 ['packages/computer-use/src/code-agent-completion.ts','src/shared/code-agent.ts','Direct notice guards/caps; Pi session outcome format'],
 ['packages/computer-use/src/code-agent-registry.ts','src/main/code-agent-manager.ts','Process bookmarks in existing Pi manager; persisted ownership, SSE instead of Cordis'],
 ['packages/computer-use/src/open.ts','src/main/reference-windows/open.ts','Pre-realpath and post-realpath system-path checks'],
 ['packages/host/src/preferences.ts','src/main/observation-frame-preference.ts','Default-on preference; Orb-owned atomic file, strict corrupt-file reporting'],
 ['packages/helper/tests/geometry.test.ts','tests/upstream-floating-placement.test.ts','All 21 source tests; vitest and Pi export paths'],
 ['packages/computer-use/tests/gui-lock.spec.ts','tests/gui-lock.test.ts','All four source tests; Pi import path'],
];
const sha = path => createHash('sha256').update(readFileSync(path)).digest('hex');
const map = new Map([
 ['.gitignore',['not-applicable','Local RELEASE.md ignore; absent from Pi tracked files']],
 ['README.md',['adapted','Pi README and sync documentation']],
 ['README.zh-CN.md',['adapted','Pi Chinese README and sync documentation']],
 ['docs/02-architecture.md',['adapted','Reference non-destructive boundary retained; sync documentation']],
 ['packages/helper/assets/floating.html',['adapted','Pi HTML adds reference agent-strip']],
 ['packages/helper/preload.cjs',['adapted','Pi preload adopts signal-only drag and bookmarks']],
 ['packages/helper/src/electron.d.ts',['adapted','Pi uses installed Electron official types']],
 ['packages/helper/src/menu.ts',['not-applicable','dsh updater menu; Pi has no registry updater']],
 ['packages/helper/tests/menu.test.ts',['not-applicable','dsh updater menu tests']],
 ['packages/helper/tests/transcript-model.test.ts',['adapted','Pi renderer tests cover completion-only folded cards']],
 ['packages/helper/tests/drag-input.test.ts',['adapted','Pi renderer tests cover signal-only gestures, threshold and pin lifecycle']],
 ['packages/host/src/orb.ts',['adapted','Pi manager/main/SSE and renderer implement bookmarks/notices; dsh download/update/jump-ack omitted']],
 ['packages/host/src/overlay-guard.ts',['adapted','Pi observation show boundary honors preference and hides immediately']],
 ['packages/host/src/preferences.ts',['adapted','Observation toggle adapted; dsh updater preferences omitted']],
 ['packages/host/src/routes.ts',['adapted','Pi menu persists ribbon setting; official ?session= URL replaces dsh jump route']],
 ['packages/host/src/index.ts',['not-applicable','Cordis bootstrap, dsh updater and downloaded helper lifecycle']],
 ['packages/host/src/electron-runtime.ts',['not-applicable','Electron is already bundled in Pi NSIS']],
 ['packages/host/src/update.ts',['not-applicable','pnpm/npm registry installer belongs to dsh bundle; playbook 9.4 excludes this pipeline']],
 ['packages/client-settings/client.js',['adapted','Ribbon setting in Pi native menu; dsh update/runtime download UI omitted']],
 ['packages/client-settings/tests/section.test.mjs',['adapted','Pi preference/menu tests; dsh settings/update fixtures omitted']],
 ['packages/computer-use/src/plugin.ts',['adapted','Shared Electron screen lock surrounds all observe/action requests; current owner/generation gate is stricter than dsh']],
 ['packages/computer-use/src/code-agent.ts',['adapted','Existing top-level Pi manager records bookmarks and stops sessions; no Cordis realm services']],
 ['packages/computer-use/src/code-agent-completion.ts',['adapted','Pi aborted final assistant is user stop; pending inactive-owner notices stay parked until owner is active/idle']],
 ['packages/computer-use/src/code-agent-registry.ts',['adapted','Pi process bookmarks, stopped/read state and interval timestamps']],
 ['packages/computer-use/src/open.ts',['ported','Pre-existence forbidden path check']],
 ['packages/computer-use/src/gui-lock.ts',['ported','Direct shared lock']],
 ['packages/helper/src/geometry.ts',['ported','Direct FloatingPlacement']],
 ['packages/helper/src/main.ts',['adapted','Thin Electron wrapper; no downloaded helper lifecycle']],
 ['packages/helper/assets/shell.js',['ported','Applicable gesture/bookmark/report sections']],
 ['packages/helper/assets/floating.css',['ported','Applicable strip CSS']],
 ['packages/helper/assets/chat.css',['ported','Fold styles and no flex shrink']],
 ['packages/helper/tests/geometry.test.ts',['ported','All 21 tests']],
 ['packages/computer-use/tests/gui-lock.spec.ts',['ported','All four tests']],
 ['packages/computer-use/tests/code-agent-registry.spec.ts',['adapted','Pi manager bookmark/stop/continuation tests']],
 ['packages/computer-use/tests/code-agent.spec.ts',['adapted','Pi manager completion ownership/stop guard tests']],
 ['packages/computer-use/tests/tools.spec.ts',['adapted','Pi broker global contention and forbidden open path tests']],
 ['packages/host/tests/overlay-guard.test.ts',['adapted','Pi preference show/hide and packaged menu tests']],
 ['packages/host/tests/preferences.test.ts',['adapted','Pi preference persistence tests; no updater preferences']],
 ['packages/host/tests/routes.test.ts',['adapted','Pi packaged IPC/menu and exact bookmark URL validation']],
 ['packages/host/tests/runtime.test.ts',['not-applicable','Downloaded helper retry; Pi runs as the bundled Electron application']],
 ['packages/host/tests/update.test.ts',['not-applicable','dsh plugin registry update pipeline']],
]);
function decision(path) {
 if (map.has(path)) return map.get(path);
 if (path.startsWith('packages/bundle/') || path.endsWith('/package.json') || path.endsWith('/tsdown.config.ts')) return ['not-applicable','dsh npm bundle release/build metadata and Cordis mount; Pi Vite plugin and NSIS remain'];
 throw new Error(`Unclassified upstream change: ${path}`);
}
const changes = git('diff','--name-only',base,commit).split('\n').map(path => {
 const [disposition, reason] = decision(path);
 return {path, disposition, reason, sourceSha256:sha(join(root,path))};
});
const copies = ports.map(([source,target,adaptation]) => ({source,target,adaptation,sourceSha256:sha(join(root,source)),targetSha256:sha(join(repo,target)),provenance:readFileSync(join(repo,target),'utf8').includes(commit) && readFileSync(join(repo,target),'utf8').includes('MIT')}));
const monoRoot='D:/pi-orb-ref/deepseek-harness-orb';
const monoBase='72f1d738458a223696685a909e806b683eff5885',monoCommit='51f09764d7ff99947be08ebbb2ca2388faab3df4';
const monoGit=(...args)=>execFileSync('git',['-C',monoRoot,...args],{encoding:'utf8'}).trim();
if(monoGit('rev-parse','HEAD')!==monoBase||monoGit('status','--porcelain'))throw new Error('Legacy reference checkout must remain clean at its original pin');
const monoReasons={
 'apps/desktop/README.md':'dsh Windows identity/upgrade notes; Pi retains its released per-user identity',
 'apps/desktop/README.zh.md':'dsh Windows identity/upgrade notes; Pi retains its released per-user identity',
 'apps/desktop/resources/icon-windows.png':'Deleted dsh icon; Pi already has its own single product icon',
 'apps/desktop/resources/icon-windows.svg':'Deleted dsh icon; Pi already has its own single product icon',
 'apps/desktop/scripts/electron-builder-config.mjs':'dsh appId/executable/icon/legacy machine upgrade; Pi identity and per-user NSIS already established',
 'apps/desktop/scripts/smoke-packaged-runtime.ts':'LibreOffice long-path junction smoke; no LibreOffice/dsh runtime in Pi artifact',
 'apps/desktop/src/main.ts':'dsh About-dialog icon path unified with release icon; Pi already loads its own bundled icon',
 'apps/desktop/tests/installer-packaging.spec.ts':'dsh installer identity tests; Pi P2-05 audits own identity/content',
 'apps/desktop/tests/main-startup.spec.ts':'dsh icon/startup identity tests; Pi P2-05 starts its own packaged artifact',
};
const monoChanges=monoGit('diff','--name-status',monoBase,monoCommit).split('\n').map(line=>{
 const [status,path]=line.split('\t');if(!monoReasons[path])throw new Error(`Unclassified legacy upstream change: ${path}`);
 return {path,status,disposition:'not-applicable',reason:monoReasons[path],sourceBlob:monoGit('rev-parse',`${status==='D'?monoBase:monoCommit}:${path}`)};
});
const legacy={repository:'https://github.com/rain-knows/deepseek-harness-orb',base:monoBase,commit:monoCommit,commitCount:Number(monoGit('rev-list','--count',`${monoBase}..${monoCommit}`)),changes:monoChanges};
const result = {at:new Date().toISOString(),repository:'https://github.com/mini-yifan/dsh-orb-cordis',base,commit,clean:true,commitCount:Number(git('rev-list','--count',`${base}..${commit}`)),changes,copies,legacy,passed:copies.every(port=>port.provenance)};
mkdirSync(reportDir,{recursive:true});
writeFileSync(join(reportDir, 'reference-manifest.json'),JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify({commit,commits:result.commitCount,files:changes.length,ports:copies.length,passed:result.passed}));
if(!result.passed)process.exitCode=1;
