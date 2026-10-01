// Summarize only completed trials; retain failed probe names without treating them as point misses.
import { readFileSync, writeFileSync } from 'node:fs';
const directory = new URL('./', import.meta.url);
const read = name => JSON.parse(readFileSync(new URL(name, directory), 'utf8'));
function stats(values) {
  const sorted = [...values].sort((a,b) => a-b);
  return { n: sorted.length, p50: sorted[Math.ceil(sorted.length*.5)-1], p95: sorted[Math.ceil(sorted.length*.95)-1] };
}
const files = ['real-model-pixels.json','real-model-pixels-tiny.json','real-model-pixels-koffi-fixed.json'];
const report = {
  method: 'real target A,B,C events or menu-item readback; no coordinates supplied by runner',
  model: read(files[0]).model,
  limitation: 'Three samples per mode and fixture; p95 is the maximum. Historical fractions are not a paired performance baseline. Known callback defects addressed by Koffi 2.16.3; exact cause of prior intermittent exits remains unconfirmed.',
  fixtures: files.map(file => {
    const probe = read(file);
    return {
      file, passed: probe.passed, nativeDependency: probe.nativeDependency ?? { name:'koffi',version:'2.14.1' },
      modes: Object.fromEntries(['single','batch','menu'].map(mode => {
        const rows = probe.rows.filter(row => row.mode===mode);
        return [mode, {
          passed: rows.filter(row => row.succeeded).length, total: rows.length,
          durationMs: stats(rows.map(row => row.totalMs)),
          modelResponses: rows.map(row => row.modelResponses),
          maxOutboundImages: Math.max(...rows.flatMap(row => row.imageBudgets.map(budget => budget.images))),
          cumulativeOutboundImages: rows.map(row => row.imageBudgets.reduce((sum,budget) => sum+budget.images,0)),
          cumulativeImageBytes: rows.map(row => row.imageBudgets.reduce((sum,budget) => sum+budget.bytes,0)),
          historyResultImages: rows.map(row => row.toolResultImages.reduce((sum,result) => sum+result.count,0)),
        }];
      })),
    };
  }),
  nativePhasesCurrentMs: Object.fromEntries(['native-input','post-action-wait','capture-and-png','window-enumeration'].map(phase => [phase, stats(read(files.at(-1)).rows.flatMap(row => row.phaseTimings.filter(timing => timing.phase===phase).map(timing => timing.durationMs)))])),
  interruptedProbes: ['real-model-pixels-shell-exit.json','real-model-fraction-recheck.json','real-model-fraction-recheck-logged.json'].map(file => {
    const probe = read(file);
    return { file, shellExit: probe.shellExit, completedTrials: probe.rows.length, successfulTrials: probe.rows.filter(row => row.succeeded).length, error: probe.error };
  }),
};
writeFileSync(new URL('pixel-summary.json',directory),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report,null,2));
