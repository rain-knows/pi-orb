/** Read-only session audit. Outputs counts and timings, never user/page text or credentials. */
import { readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

const samples = [
  ['recent-browser-task', '--D--workself-daily--', '2026-10-04T13-33-14-411Z_01a1071e-632a-7489-bbe9-d4af5ffe60cd.jsonl'],
  ['earlier-connection-failures', '--D--workself-daily--', '2026-10-01T09-32-18-333Z_01a0f6ce-ba1d-76e8-9a5e-1a75a56bff38.jsonl'],
];
const hash = text => createHash('sha256').update(text).digest('hex');
const percentile = (values, p) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.length ? sorted[Math.ceil(p * sorted.length) - 1] : null;
};

function summarize([label, directory, filename]) {
  const path = join(homedir(), '.pi', 'agent', 'sessions', directory, filename);
  const raw = readFileSync(path, 'utf8');
  const rows = raw.split(/\r?\n/).filter(Boolean).map(JSON.parse);
  const calls = new Map();
  const results = [];
  const counts = {};
  const commands = {};
  const assistants = [];
  let previousSnapshot = null;
  let automaticSnapshotChars = 0;
  for (const row of rows) {
    const message = row.message;
    if (!message) continue;
    if (message.role === 'assistant') {
      assistants.push({ at: row.timestamp, stopReason: message.stopReason, usage: message.usage });
      for (const block of message.content ?? []) if (block.type === 'toolCall') {
        counts[block.name] = (counts[block.name] ?? 0) + 1;
        if (block.name === 'orb_browser') commands[block.arguments?.name] = (commands[block.arguments?.name] ?? 0) + 1;
        calls.set(block.id, {
          tool: block.name, at: row.timestamp,
          ...(block.name === 'orb_browser' ? {
            command: block.arguments?.name,
            argumentKeys: Object.keys(block.arguments?.arguments ?? {}),
            ...(block.arguments?.arguments?.action ? { tabAction: block.arguments.arguments.action } : {}),
            ...(typeof block.arguments?.arguments?.time === 'number' ? { requestedWaitSeconds: block.arguments.arguments.time } : {}),
          } : {}),
          ...(block.name === 'codemode' ? { referencedMembers: [...new Set((block.arguments?.code ?? '').match(/(?:tools\.[a-zA-Z0-9_]+|searchTools|describeNamespace|describeTool)/g) ?? [])] } : {}),
        });
      }
    }
    if (message.role !== 'toolResult') continue;
    const call = calls.get(message.toolCallId);
    const blocks = (message.content ?? []).filter(block => block.type === 'text').map(block => block.text);
    const error = message.isError === true || message.details?.ok === false;
    const entry = {
      ...call, resultAt: row.timestamp,
      pairedMs: call ? Date.parse(row.timestamp) - Date.parse(call.at) : null,
      textChars: blocks.reduce((sum, block) => sum + block.length, 0),
      textBlockChars: blocks.map(block => block.length),
      error, ...(message.details?.reason ? { reason: message.details.reason } : {}),
    };
    // The current broker emits action content and one explicit snapshot as two text blocks.
    if (message.toolName === 'orb_browser' && !error && blocks.length === 2) {
      const snapshot = blocks.at(-1);
      automaticSnapshotChars += snapshot.length;
      if (previousSnapshot) {
        const before = new Set(previousSnapshot.split('\n'));
        const after = snapshot.split('\n');
        entry.snapshotLinesAlsoInPreviousFraction = after.filter(line => before.has(line)).length / after.length;
      }
      previousSnapshot = snapshot;
    }
    results.push(entry);
  }
  const system = rows.find(row => row.message?.role === 'system')?.message;
  const user = rows.find(row => row.message?.role === 'user');
  const last = assistants.at(-1);
  const elapsedMs = user && last ? Date.parse(last.at) - Date.parse(user.timestamp) : null;
  const pairedMs = results.reduce((sum, entry) => sum + (entry.pairedMs ?? 0), 0);
  const browser = results.filter(entry => entry.tool === 'orb_browser');
  return {
    label, sessionFile: path, fileSha256: hash(raw),
    modelEvents: rows.filter(row => row.type === 'model_change').map(({ provider, modelId, timestamp }) => ({ provider, modelId, timestamp })),
    thinkingEvents: rows.filter(row => row.type === 'thinking_level_change').map(({ thinkingLevel, timestamp }) => ({ thinkingLevel, timestamp })),
    logicalToolsRecordedInSystem: system?.toolsAdded,
    systemSectionCharacters: Object.fromEntries(Object.entries(system?.sections ?? {}).map(([name, value]) => [name, typeof value === 'string' ? value.length : JSON.stringify(value).length])),
    firstUserAt: user?.timestamp, lastAssistantAt: last?.at, elapsedMs,
    assistantResponses: assistants.length, toolCounts: counts, browserCommandCounts: commands,
    completedToolResults: results.length, errors: results.filter(entry => entry.error).length,
    sumPairedToolIntervalsMs: pairedMs, toolIntervalFractionOfElapsed: elapsedMs ? pairedMs / elapsedMs : null,
    browserTextCharacters: browser.reduce((sum, entry) => sum + entry.textChars, 0),
    automaticSnapshotCharacters: automaticSnapshotChars,
    browserPairedIntervalsMs: { sum: browser.reduce((sum, entry) => sum + (entry.pairedMs ?? 0), 0), median: percentile(browser.map(entry => entry.pairedMs), .5), max: Math.max(...browser.map(entry => entry.pairedMs)) },
    firstResponseUsage: assistants[0]?.usage, lastResponseUsage: last?.usage,
    lastResponseInputPlusCacheRead: (last?.usage?.input ?? 0) + (last?.usage?.cacheRead ?? 0),
    calls: results,
    caveats: ['Entry timestamp intervals include scheduling and transport; these are not isolated backend timings.', 'Provider-reported input and cacheRead are recorded separately; their sum is not newly billed input.', 'toolsAdded is a logical session record, not a proof of final provider tool declarations under Code mode.', 'Conversation completion is not independent verification of task success.'],
  };
}

const report = {
  scope: 'Selected existing local sessions, metadata only. No browser actions or model calls performed.',
  samples: samples.map(summarize),
};
const output = new URL('./session-summary.json', import.meta.url);
writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report.samples.map(({ label, elapsedMs, assistantResponses, browserTextCharacters, automaticSnapshotCharacters, sumPairedToolIntervalsMs, lastResponseInputPlusCacheRead, browserPairedIntervalsMs }) => ({ label, elapsedMs, assistantResponses, browserTextCharacters, automaticSnapshotCharacters, sumPairedToolIntervalsMs, lastResponseInputPlusCacheRead, browserPairedIntervalsMs })), null, 2));
