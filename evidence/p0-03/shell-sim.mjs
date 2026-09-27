// Minimal "shell" client for P0-03.
//
// Connects to an ALREADY RUNNING pi-web with real credentials and an isolated
// agent directory. It never starts, restarts, upgrades, or kills the service —
// that ownership rule is exactly what N4 requires (doc §4.4). Dropping the SSE
// connection must not affect the service or the session either.
//
// Stream order matters: a client must subscribe BEFORE prompting, or the run's
// events are already gone by the time the stream opens. This mirrors the real
// client and is why the prompt is sent from inside the stream callback.
//
// Prints one JSON line describing what it did, then exits 0.

const base = process.env.PI_WEB_URL;
const password = process.env.PI_WEB_PASSWORD;
const cwd = process.env.PI_ORB_P0_CWD;
const auth = `Basic ${Buffer.from(`pi:${password}`, "utf8").toString("base64")}`;

const out = { base, steps: [] };

async function api(path, options = {}) {
  const res = await fetch(`${base}${path}`, {
    ...options,
    headers: { "content-type": "application/json", authorization: auth, ...(options.headers ?? {}) },
  });
  const text = await res.text();
  let body;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  return { status: res.status, body };
}

async function readSse(url, { onConnected, isDone, timeoutMs }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const events = [];
  let text = "";
  let connectedSeen = false;
  try {
    const res = await fetch(url, { headers: { authorization: auth }, signal: controller.signal });
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let index;
      while ((index = buffer.indexOf("\n\n")) !== -1) {
        const raw = buffer.slice(0, index);
        buffer = buffer.slice(index + 2);
        text += raw;
        for (const line of raw.split(/\r?\n/)) {
          if (!line.startsWith("data: ")) continue;
          try { events.push(JSON.parse(line.slice(6))); } catch { /* heartbeat */ }
        }
      }
      const hasConnected = events.some((event) => event.type === "connected");
      if (hasConnected && !connectedSeen && onConnected) {
        connectedSeen = true;
        await onConnected();
      }
      if (isDone(events, text)) break;
    }
  } catch (error) {
    if (error?.name !== "AbortError") out.steps.push({ step: "sse-error", message: String(error) });
  } finally {
    clearTimeout(timer);
  }
  return { events, text };
}

try {
  const probe = await fetch(`${base}/api/web-auth`);
  out.steps.push({ step: "web-auth-probe", status: probe.status, body: await probe.json() });

  const created = await api("/api/agent/new", {
    method: "POST",
    body: JSON.stringify({ cwd, type: "ensure_session", toolNames: ["read"] }),
  });
  const sessionId = created.body?.sessionId;
  out.sessionId = sessionId;
  out.steps.push({ step: "create-session", status: created.status, sessionId });

  const state = await api(`/api/agent/${encodeURIComponent(sessionId)}`);
  out.steps.push({ step: "get-state", status: state.status, running: state.body?.running });


  let promptStatus;
  const sse = await readSse(`${base}/api/agent/${encodeURIComponent(sessionId)}/events`, {
    // Subscribe first, prompt second.
    onConnected: async () => {
      const prompted = await api(`/api/agent/${encodeURIComponent(sessionId)}`, {
        method: "POST",
        body: JSON.stringify({ type: "prompt", message: "p0-03 shell prompt" }),
      });
      promptStatus = prompted.status;
    },
    isDone: (events, text) => text.includes("p0-ok") || events.some((event) => event.type === "message_end"),
    timeoutMs: 45000,
  });
  out.steps.push({ step: "prompt", status: promptStatus });
  out.sse = {
    connected: sse.events.some((event) => event.type === "connected"),
    assistantTextSeen: sse.text.includes("p0-ok"),
    eventTypes: [...new Set(sse.events.map((event) => event.type))],
    textSample: sse.text.slice(-700),
  };
  out.steps.push({ step: "sse", status: "closed-by-client", sse: out.sse });

  // Dropping the stream, then reconnecting, must not disturb the session.
  const reconnect = await readSse(`${base}/api/agent/${encodeURIComponent(sessionId)}/events`, {
    isDone: (events) => events.some((event) => event.type === "connected"),
    timeoutMs: 20000,
  });
  out.reconnect = { connected: reconnect.events.some((event) => event.type === "connected") };
  out.steps.push({ step: "sse-reconnect", status: "closed-by-client", reconnect: out.reconnect });

  const aborted = await api(`/api/agent/${encodeURIComponent(sessionId)}`, {
    method: "POST",
    body: JSON.stringify({ type: "abort" }),
  });
  out.steps.push({ step: "abort", status: aborted.status, data: aborted.body?.data ?? null });
  out.ok = true;
} catch (error) {
  out.ok = false;
  out.error = String(error);
}

process.stdout.write(`${JSON.stringify(out)}\n`);
process.exit(0);
