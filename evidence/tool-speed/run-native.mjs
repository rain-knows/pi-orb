// Bundle the current TypeScript adapter; production dependencies remain external.
import { build } from "esbuild";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { spawn } from "node:child_process";
const cache=resolve('.tmp/tool-speed');mkdirSync(cache,{recursive:true});
await build({entryPoints:[process.argv.includes('--callback-stress')?'evidence/tool-speed/native-callback-stress.ts':process.argv.includes('--wait')?'evidence/tool-speed/wait-experiment.ts':process.argv.includes('--safety')?'evidence/tool-speed/native-batch-safety.ts':'evidence/tool-speed/native-benchmark.ts'],outfile:resolve(cache,'native.cjs'),bundle:true,platform:'node',format:'cjs',external:['koffi','electron'],tsconfig:'tsconfig.json'});
const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
const child=spawn(resolve('node_modules/electron/dist/electron.exe'),[resolve(cache,'native.cjs'),...process.argv.slice(2)],{env,stdio:'inherit',windowsHide:true});
await new Promise((done,reject)=>{child.on('error',reject);child.on('exit',code=>code===0?done():reject(new Error(`Native benchmark exited ${code}`)));});
