import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';

// A package runner passes its own directory to children. Standalone probes get a new run each time.
export function createRunDirectory(topic) {
  const directory = process.env.PI_ORB_VERIFY_OUTPUT
    ? resolve(process.env.PI_ORB_VERIFY_OUTPUT)
    : resolve(import.meta.dirname, '../../evidence/runs', topic + '-' + Date.now() + '-' + randomUUID().slice(0, 8));
  mkdirSync(directory, { recursive: true });
  return directory;
}
