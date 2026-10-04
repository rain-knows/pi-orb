// Boot the actual global Pi CLI, with all user extensions. Keep its private
// prompt/transcript out of evidence; export only the verified test response.
import { spawn } from "node:child_process";
import { join } from "node:path";
import { writeFileSync } from "node:fs";
const cli = join(process.env.APPDATA, "npm/node_modules/@earendil-works/pi-coding-agent/dist/cli.js");
const child = spawn(process.execPath, [cli, "--mode", "json", "--no-session", "--provider", "TZcode", "--model", "deepseek-v4.1-flash", "--thinking", "off", "-p", "这是全局 Pi CLI 与插件兼容性冒烟。不使用任何工具，不启动子代理。只回答 PI_CLI_COMPAT_OK。"], { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
let output = "", errors = "", timedOut = false;
child.stdout.on("data", chunk => output += chunk.toString()); child.stderr.on("data", chunk => errors += chunk.toString());
const timer = setTimeout(() => { timedOut = true; child.kill(); }, 120000);
const code = await new Promise(resolve => child.on("close", resolve)); clearTimeout(timer);
const records = output.split(/\r?\n/u).flatMap(line => { try { return [JSON.parse(line)]; } catch { return []; } });
const last = records.filter(record => record.type === "message_end" && record.message?.role === "assistant").at(-1)?.message;
const text = last?.content?.filter(block => block.type === "text").map(block => block.text).join("") ?? "";
const report = { method: "Global Pi 1.0.1 CLI + installed global plugins + real provider", checks: [
  { name: "CLI exits successfully", ok: code === 0 && !timedOut },
  { name: "real provider returns the requested sentinel", ok: text.includes("PI_CLI_COMPAT_OK") && last.stopReason === "stop" },
  { name: "global extension boot has no load or runtime error", ok: !/Failed to load|Extension.*error|Cannot find module|SyntaxError|TypeError/u.test(errors) },
], passed: false };
report.passed = report.checks.every(check => check.ok);
writeFileSync(new URL("cli-runtime.json", import.meta.url), JSON.stringify(report, null, 2) + "\n"); console.log(JSON.stringify(report, null, 2));
if (!report.passed) process.exitCode = 1;
