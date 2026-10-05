/** Adapted from dsh-orb-cordis computer-use/open.ts, commit 9cdc50302d202f4497569731be488a8afa500da7 (MIT, Copyright (c) 2026 mini-yifan). */
import { realpath } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

const MULTIBYTE_UTF8_PERCENT = /%(?:[Cc][2-9A-Fa-f]|[Dd][0-9A-Fa-f]|[Ee][0-9A-Fa-f]|[Ff][0-7])(?:%[0-9A-Fa-f]{2})+/u;
const PATH_BLACKLIST = ["/System", "/private", "/etc", "/var", "/usr", "/sbin", "/bin", "/dev", "/proc", "/sys"];

export function requireBrowserUrl(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) throw new Error("url must be a non-empty http(s) URL when provided");
  const withScheme = /^https?:\/\//iu.test(trimmed) ? trimmed : `https://${trimmed}`;
  if (MULTIBYTE_UTF8_PERCENT.test(withScheme)) throw new Error("url path and query must use plain CJK text, not percent-encoding");
  let parsed: URL;
  try { parsed = new URL(withScheme); } catch { throw new Error("url must be a valid http(s) URL"); }
  if ((parsed.protocol !== "http:" && parsed.protocol !== "https:") || parsed.username || parsed.password) throw new Error("url must be an http(s) URL without userinfo");
  return withScheme;
}

export interface FinderOpenTarget { readonly path: string; readonly revealOnly: boolean }
export async function resolveFinderOpen(path: string | undefined, revealOnly: boolean, home = homedir()): Promise<FinderOpenTarget> {
  const trimmed = path?.trim() ?? "";
  const expanded = trimmed === "" || trimmed === "~" ? join(home, "Desktop") : trimmed.startsWith("~/") ? join(home, trimmed.slice(2)) : trimmed;
  const resolved = await realpath(expanded).catch(error => { throw new Error(`computer-use: path does not exist: ${expanded} (${String(error)})`); });
  if (PATH_BLACKLIST.some(prefix => resolved === prefix || resolved.startsWith(`${prefix}/`))) throw new Error(`computer-use: opening a system path is forbidden: ${resolved}`);
  return { path: resolved, revealOnly };
}
