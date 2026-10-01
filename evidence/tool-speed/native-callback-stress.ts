/** Stress the production Koffi bindings, independently of model accuracy or Pi context. */
import { app, crashReporter } from 'electron';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createProductionWindowsOps } from '../../src/main/reference-windows/windows-native';
import { observationRasterSize } from '../../src/shared/observation-raster';
import koffi from 'koffi';

const dumps = resolve('.tmp/tool-speed/native-crash-dumps');
mkdirSync(dumps,{recursive:true});
app.setPath('crashDumps',dumps);
crashReporter.start({uploadToServer:false});
void app.whenReady().then(async () => {
  const started=performance.now();
  const report={koffi:koffi.version,versions:process.versions,enumerations:0,captures:0,passed:false,durationMs:0};
  try {
    const ops=createProductionWindowsOps();
    for(let index=0;index<1000;index++) {
      const snapshot=ops.listWindows();
      if(!snapshot.windows.some(window=>window.hwnd===snapshot.foregroundHwnd))throw new Error('Foreground absent from enumeration');
      report.enumerations++;
      // Captures remain in memory and are never saved. A tiny physical patch suffices to exercise GDI/PNG.
      if(index%20===0) {
        const raster=observationRasterSize(ops.capturePng({x:0,y:0,width:64,height:64}));
        if(raster?.width!==64||raster.height!==64)throw new Error('Native capture header mismatch');
        report.captures++;
      }
      await new Promise(done=>setTimeout(done,1));
    }
    report.passed=true;
  } finally {
    report.durationMs=performance.now()-started;
    writeFileSync(resolve('evidence/tool-speed/native-callback-stress.json'),JSON.stringify(report,null,2)+'\n');
    console.log(JSON.stringify({koffi:report.koffi,enumerations:report.enumerations,captures:report.captures,passed:report.passed,durationMs:report.durationMs}));
    app.exit(report.passed?0:1);
  }
}).catch(error=>{console.error(error);app.exit(1);});
