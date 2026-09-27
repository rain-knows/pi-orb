import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { OrbSessionEvent, WorkspaceStatus } from "@shared/ipc";
import { getBridge } from "./bridge";

interface ChatMessage {
  readonly role: "user" | "assistant" | "error";
  readonly text: string;
}

export function App() {
  const bridge = useMemo(() => getBridge(), []);
  const [status, setStatus] = useState<WorkspaceStatus | null>(null);
  const [generation, setGeneration] = useState(0);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const streaming = useRef("");

  useEffect(() => {
    void bridge.getStatus().then(setStatus);
    return bridge.onSessionEvent((event: OrbSessionEvent) => {
      switch (event.type) {
        case "generation":
          setGeneration(event.generation);
          return;
        case "assistant-delta":
          streaming.current += event.text;
          setMessages((current) => withStreaming(current, streaming.current));
          return;
        case "assistant-message":
          streaming.current = "";
          setMessages((current) => withCompleted(current, event.text));
          return;
        case "error":
          setNotice(event.message);
          return;
        case "idle":
          setBusy(false);
          return;
        case "session":
          setNotice(`Session ${event.sessionId.slice(0, 8)} ready.`);
          return;
        default:
          return;
      }
    });
  }, [bridge]);

  const refreshStatus = useCallback(async () => {
    setStatus(await bridge.refreshConnection());
  }, [bridge]);

  const chooseWorkspace = useCallback(async () => {
    const result = await bridge.chooseWorkspace();
    if (!result.ok) {
      // An empty message means the user cancelled; that is not an error.
      if (result.message) setNotice(result.message);
      return;
    }
    const next = await bridge.setWorkspace(result.resolved ?? "", false);
    setStatus(next);
    setNotice(next.problem ?? `Orb workspace set to ${next.workspace}`);
  }, [bridge]);

  const send = useCallback(async () => {
    const text = draft.trim();
    if (text.length === 0 || busy) return;
    setNotice(null);
    setDraft("");
    streaming.current = "";
    setMessages((current) => [...current, { role: "user", text }]);
    setBusy(true);
    try {
      await bridge.ensureSession();
      await bridge.sendPrompt({ generation, text });
    } catch (error) {
      setBusy(false);
      setMessages((current) => [
        ...current,
        { role: "error", text: error instanceof Error ? error.message : String(error) },
      ]);
    }
  }, [bridge, busy, draft, generation]);

  const stop = useCallback(async () => {
    try {
      await bridge.abort({ generation });
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }, [bridge, generation]);

  return (
    <div className="orb">
      <header className="orb__header">
        <span className="orb__title">pi-Orb</span>
        <button
          type="button"
          className="orb__button"
          onClick={() => void refreshStatus()}
          title="Re-check the pi-web connection and workspace"
        >
          {status?.configured
            ? status.piWeb.reachable
              ? "Connected"
              : "pi-web offline"
            : "No workspace"}
        </button>
      </header>

      {!status?.configured && (
        <section className="orb__setup">
          <p>
            Orb mode activates only for its own dedicated working directory. Pick one
            to enable the orb. Until then the orb stays disabled and writes nothing.
          </p>
          <button
            type="button"
            className="orb__button orb__button--primary"
            onClick={() => void chooseWorkspace()}
          >
            Choose workspace…
          </button>
          {status?.problem && <p className="orb__problem">{status.problem}</p>}
        </section>
      )}

      {status?.configured && (
        <>
          <p className="orb__workspace" title={status.workspace ?? ""}>
            {status.workspace}
          </p>
          <div className="orb__messages">
            {messages.map((message, index) => (
              <article key={index} className={`orb__message orb__message--${message.role}`}>
                {message.text}
              </article>
            ))}
          </div>
          <form
            className="orb__composer"
            onSubmit={(event) => {
              event.preventDefault();
              void send();
            }}
          >
            <textarea
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder="Ask the orb…"
              rows={3}
            />
            <div className="orb__actions">
              <button
                type="submit"
                className="orb__button orb__button--primary"
                disabled={busy || draft.trim().length === 0}
              >
                Send
              </button>
              <button
                type="button"
                className="orb__button"
                onClick={() => void stop()}
                disabled={!busy}
              >
                Stop
              </button>
            </div>
          </form>
        </>
      )}

      {notice && <p className="orb__notice">{notice}</p>}
      {status && !status.piWeb.reachable && status.piWeb.problem && (
        <p className="orb__notice orb__notice--error">{status.piWeb.problem}</p>
      )}
      {status && !status.shortcutRegistered && (
        <p className="orb__notice">
          Wake shortcut “{status.shortcut}” is unavailable. Use the tray icon instead.
        </p>
      )}
    </div>
  );
}

function withStreaming(current: ChatMessage[], text: string): ChatMessage[] {
  const copy = [...current];
  const last = copy[copy.length - 1];
  if (last?.role === "assistant") {
    copy[copy.length - 1] = { role: "assistant", text };
  } else {
    copy.push({ role: "assistant", text });
  }
  return copy;
}

function withCompleted(current: ChatMessage[], text: string): ChatMessage[] {
  const copy = [...current];
  const last = copy[copy.length - 1];
  if (last?.role === "assistant") {
    copy[copy.length - 1] = { role: "assistant", text };
  } else {
    copy.push({ role: "assistant", text });
  }
  return copy;
}
