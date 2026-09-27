// P0-03 bridge protocol prototype (probe, not product code).
//
// Verifies the cross-process seam required by doc/pi-orb-development-goals.md §4.4:
// the Pi extension runs inside the pi-web Node service, so an Electron renderer
// cannot reach it through renderer IPC. This probe models the shell side of that
// seam as a Windows named pipe and proves the authorization rules the product must
// enforce:
//
//   - transport is a named pipe, so no web page and no LAN client can reach it
//     (no wildcard CORS, no public control API);
//   - every request needs the per-connection token the shell generated;
//   - every request is bound to a session id AND a run generation, so a request
//     from an older generation is refused after reload/replacement;
//   - a native operation needs an explicit per-task authorization grant;
//   - a browser-flagged request is refused even on the pipe.
//
// The "native operation" here is writing a marker file. No desktop input, no
// screenshot, no OS permission is exercised.

import { createServer } from "node:net";
import { existsSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";

export function createBridgeProbe({ pipePath, token, markerDir, log }) {
  mkdirSync(markerDir, { recursive: true });
  const sessions = new Map();

  function registerSession(sessionId) {
    sessions.set(sessionId, { generation: 0, authorized: false });
    return 0;
  }
  function bumpGeneration(sessionId) {
    const state = sessions.get(sessionId);
    if (!state) return undefined;
    state.generation += 1;
    // A new run generation never inherits the previous task's authorization.
    state.authorized = false;
    return state.generation;
  }
  function authorizeTask(sessionId, generation) {
    const state = sessions.get(sessionId);
    if (!state || state.generation !== generation) return false;
    state.authorized = true;
    return true;
  }
  function revokeAll() {
    for (const state of sessions.values()) state.authorized = false;
  }

  function decide(request) {
    if (request.headers?.origin || request.headers?.["sec-fetch-site"] || request.headers?.["sec-fetch-mode"]) {
      return { allowed: false, reason: "browser-originated-request" };
    }
    if (request.token !== token) return { allowed: false, reason: "bad-token" };
    const state = sessions.get(request.sessionId);
    if (!state) return { allowed: false, reason: "unknown-session" };
    if (request.generation !== state.generation) return { allowed: false, reason: "stale-generation" };
    if (!state.authorized) return { allowed: false, reason: "no-task-authorization" };
    return { allowed: true, reason: "authorized" };
  }

  function execute(request) {
    const decision = decide(request);
    if (!decision.allowed) return { ...decision, executed: false };
    const marker = join(markerDir, `${request.sessionId}-g${request.generation}-${request.action}.marker`);
    writeFileSync(marker, JSON.stringify({ sessionId: request.sessionId, generation: request.generation, action: request.action }), "utf8");
    return { ...decision, executed: true, marker };
  }

  const server = createServer((socket) => {
    let buffer = "";
    socket.on("data", (chunk) => {
      buffer += chunk.toString("utf8");
      const newline = buffer.indexOf("\n");
      if (newline === -1) return;
      socket.pause();
      let request;
      try {
        request = JSON.parse(buffer.slice(0, newline));
      } catch {
        socket.end(`${JSON.stringify({ allowed: false, reason: "malformed" })}\n`);
        return;
      }
      const result = execute(request);
      log?.({ event: "bridge_request", request, result });
      socket.end(`${JSON.stringify(result)}\n`);
    });
    socket.on("error", () => {});
  });

  return {
    server,
    listen: () => new Promise((resolvePromise, reject) => {
      server.once("error", reject);
      server.listen(pipePath, () => resolvePromise());
    }),
    close: () => new Promise((resolvePromise) => server.close(() => resolvePromise())),
    registerSession,
    bumpGeneration,
    authorizeTask,
    revokeAll,
    decide,
  };
}

/** Send one newline-delimited JSON request over the named pipe. */
export function sendBridgeRequest(pipePath, request, timeoutMs = 5000) {
  return new Promise((resolvePromise, reject) => {
    let settled = false;
    const finish = (value, error) => {
      if (settled) return;
      settled = true;
      if (error) reject(error);
      else resolvePromise(value);
    };
    const timer = setTimeout(() => finish(undefined, new Error("bridge request timed out")), timeoutMs);
    import("node:net").then(({ connect }) => {
      const socket = connect(pipePath, () => socket.write(`${JSON.stringify(request)}\n`));
      let data = "";
      socket.on("data", (chunk) => { data += chunk.toString("utf8"); });
      socket.on("end", () => {
        clearTimeout(timer);
        try { finish(JSON.parse(data.trim())); } catch (error) { finish(undefined, error); }
      });
      socket.on("error", (error) => { clearTimeout(timer); finish(undefined, error); });
    }).catch((error) => { clearTimeout(timer); finish(undefined, error); });
  });
}

/** Denial matrix: every refused case must leave no marker file on disk. */
export async function runBridgeMatrix({ pipePath, token, markerDir, sessionId, log }) {
  const results = [];
  const record = (name, response, expectExecuted) => {
    results.push({ name, reason: response?.reason ?? "unreachable", executed: Boolean(response?.executed), expected: expectExecuted });
  };
  const before = existsSync(markerDir) ? 1 : 0;

  record("valid token + current generation + task authorization", await sendBridgeRequest(pipePath, {
    token, sessionId, generation: 0, action: "observe",
  }), true);
  record("missing token", await sendBridgeRequest(pipePath, {
    sessionId, generation: 0, action: "observe",
  }), false);
  record("wrong token", await sendBridgeRequest(pipePath, {
    token: `${token}-wrong`, sessionId, generation: 0, action: "observe",
  }), false);
  record("unknown session", await sendBridgeRequest(pipePath, {
    token, sessionId: "no-such-session", generation: 0, action: "observe",
  }), false);
  record("browser-originated request", await sendBridgeRequest(pipePath, {
    token, sessionId, generation: 0, action: "observe", headers: { origin: "http://evil.example", "sec-fetch-site": "cross-site" },
  }), false);

  return { results, markerDirExistsBefore: before === 1, log };
}
