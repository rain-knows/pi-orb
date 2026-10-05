/** Adapted from dsh-orb-cordis computer-use/screenshot.ts, commit 9cdc50302d202f4497569731be488a8afa500da7 (MIT, Copyright (c) 2026 mini-yifan). */
import { mkdir, access, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { ImageMediaType } from "./backend";
export interface DesktopScreenshotFile { readonly data: Uint8Array; readonly mediaType: ImageMediaType; readonly screenIndex: number }
const ext: Record<ImageMediaType, string> = { "image/png": "png", "image/jpeg": "jpg", "image/gif": "gif", "image/webp": "webp" };
const pad = (v: number) => String(v).padStart(2, "0");
function stem(now: Date, index: number, count: number): string { const s = `Screenshot ${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())} at ${pad(now.getHours())}.${pad(now.getMinutes())}.${pad(now.getSeconds())}`; return count === 1 ? s : `${s} (screen ${index})`; }
async function exists(path: string): Promise<boolean> { try { await access(path); return true; } catch { return false; } }
async function unique(directory: string, base: string, suffix: string): Promise<string> { let p = join(directory, `${base}.${suffix}`); for (let i=2; await exists(p); i++) p = join(directory, `${base} ${i}.${suffix}`); return p; }
export function pairScreenshotFiles(captures: readonly Pick<DesktopScreenshotFile, "data" | "mediaType">[], screens: readonly { readonly screenIndex: number }[]): DesktopScreenshotFile[] { if (captures.length !== screens.length) throw new Error("computer-use: screenshot captures and screens disagree"); return captures.map((c, i) => ({ ...c, screenIndex: screens[i]!.screenIndex })); }
export async function writeDesktopScreenshots(files: readonly DesktopScreenshotFile[], options: { home: string; now?: Date }): Promise<string[]> { if (!files.length) throw new Error("computer-use: no screenshot files to write"); const dir = join(options.home, "Desktop"); await mkdir(dir, { recursive: true }); const now = options.now ?? new Date(); const out: string[] = []; for (const file of files) { const p = await unique(dir, stem(now, file.screenIndex, files.length), ext[file.mediaType]); await writeFile(p, file.data); out.push(p); } return out; }
