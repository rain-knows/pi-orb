import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  DesktopTaskStatus,
  DesktopWindowChoice,
  OrbSessionEvent,
  WorkspaceStatus,
} from "@shared/ipc";
import { formatBytes } from "@shared/screenshot";
import { getBridge } from "./bridge";

interface ChatMessage {
  readonly role: "user" | "assistant" | "error";
  readonly text: string;
}

/**
 * A capture awaiting the user's decision.
 *
 * The image lives only here, as a data URL, and only until the decision is made.
 * It is never included in a status snapshot or a session event.
 */
interface PreviewState {
  readonly observationId: string;
  readonly dataUrl: string;
  readonly width: number;
  readonly height: number;
  readonly bytes: number;
  readonly targetDescription: string;
  readonly targetStale: boolean;
}

export function App() {
  const bridge = useMemo(() => getBridge(), []);
  const [status, setStatus] = useState<WorkspaceStatus | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [shortcutDraft, setShortcutDraft] = useState("");
  const [preview, setPreview] = useState<PreviewState | null>(null);
  const [taskScope, setTaskScope] = useState("");
  const [desktopTask, setDesktopTask] = useState<DesktopTaskStatus | null>(null);
  const [windowChoices, setWindowChoices] = useState<readonly DesktopWindowChoice[] | null>(null);
  const streaming = useRef("");

  // The generation is read from the status snapshot, never from a pushed event:
  // the initial generation is decided before this subscriber exists.
  const generation = status?.generation ?? 0;

  useEffect(() => {
    void bridge.getStatus().then((next) => {
      setStatus(next);
      setDesktopTask(next.desktopTask);
    });
    return bridge.onSessionEvent((event: OrbSessionEvent) => {
      switch (event.type) {
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
          setBusy(false);
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
    const next = await bridge.refreshConnection();
    setStatus(next);
    setDesktopTask(next.desktopTask);
  }, [bridge]);

  /**
   * Grant a desktop task.
   *
   * The user has to say what the task is for, and that text is what gets approved and shown
   * back. A blank scope is refused here rather than defaulted, so there is no way to approve
   * "whatever the model wants".
   */
  const authorizeDesktop = useCallback(async () => {
    const scope = taskScope.trim();
    if (scope.length === 0 || generation === 0) return;
    const next = await bridge.authorizeDesktopTask({ generation, scope });
    setDesktopTask(next);
    setNotice(next.authorized ? `Desktop task approved: ${next.scope}` : next.stoppedReason);
  }, [bridge, generation, taskScope]);

  const revokeDesktop = useCallback(async () => {
    setDesktopTask(await bridge.revokeDesktopTask());
    setNotice("Desktop authorization revoked.");
  }, [bridge]);

  /**
   * Hide the orb from its own window.
   *
   * The same routine the shortcut and the tray use, so desktop operations are revoked on every
   * route. The chat session is untouched.
   */
  const collapse = useCallback(async () => {
    setDesktopTask(await bridge.collapseOrb());
  }, [bridge]);

  /**
   * Ask the shell which windows exist, so the user can pick one explicitly.
   *
   * The orb refuses to guess a target, so this list is how a target is chosen when the recorded
   * foreground window is not the one the user wants.
   */
  const loadWindows = useCallback(async () => {
    const result = await bridge.listDesktopWindows();
    if (!result.ok) {
      setNotice(result.message);
      return;
    }
    setWindowChoices(result.windows);
  }, [bridge]);

  const chooseTarget = useCallback(
    async (windowId: string) => {
      const result = await bridge.setDesktopTarget(windowId);
      if (!result.ok) {
        setNotice(result.message);
        return;
      }
      setNotice(`Desktop target set to "${result.target.title}". Approval is required again.`);
      setWindowChoices(null);
      setTaskScope("");
      setDesktopTask(await bridge.getDesktopTaskStatus());
    },
    [bridge],
  );

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
    if (text.length === 0 || busy || generation === 0) return;
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

  /**
   * Capture the previously recorded window and show it for review.
   *
   * This sends nothing. The draft text travels with the capture, so confirming
   * sends the message and the image together and cancelling drops both.
   */
  const requestScreenshot = useCallback(async () => {
    if (busy || generation === 0) return;
    setNotice(null);
    const result = await bridge.captureScreenshot({ generation, text: draft.trim() });
    if (!result.ok) {
      setPreview(null);
      setNotice(result.message);
      return;
    }
    setPreview({
      observationId: result.observationId,
      dataUrl: `data:${result.mimeType};base64,${result.data}`,
      width: result.width,
      height: result.height,
      bytes: result.bytes,
      targetDescription: result.targetDescription,
      targetStale: result.targetStale,
    });
  }, [bridge, busy, draft, generation]);

  const resolveScreenshot = useCallback(
    async (confirmed: boolean) => {
      const current = preview;
      setPreview(null);
      if (!current) return;
      const result = await bridge.resolveScreenshot({
        generation,
        observationId: current.observationId,
        confirmed,
      });
      if (!result.sent) {
        // A discard is the user's intent, so it is not reported as a failure; a
        // failed confirmation is.
        if (confirmed) setNotice(result.message);
        return;
      }
      streaming.current = "";
      setDraft("");
      setMessages((messages) => [
        ...messages,
        { role: "user", text: `[screenshot] ${current.targetDescription}` },
      ]);
      setBusy(true);
    },
    [bridge, generation, preview],
  );

  const saveShortcut = useCallback(async () => {
    const candidate = shortcutDraft.trim();
    if (candidate.length === 0) return;
    const next = await bridge.setShortcut(candidate);
    setStatus(next);
    if (next.shortcutRegistered && next.shortcut === candidate) {
      setShortcutDraft("");
      setNotice(`Wake shortcut set to ${candidate}.`);
    } else {
      setNotice(next.shortcutProblem);
    }
  }, [bridge, shortcutDraft]);

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
        <span className="orb__header-actions">
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
          {status?.configured && (
            <button
              type="button"
              className="orb__button"
              onClick={() => void collapse()}
              title="Hide the orb. Desktop operations are revoked; the conversation continues."
            >
              Collapse
            </button>
          )}
        </span>
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
                onClick={() => void requestScreenshot()}
                disabled={busy}
              >
                Screenshot
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

      {preview && (
        <section className="orb__preview">
          <p className="orb__preview-target">{preview.targetDescription}</p>
          {preview.targetStale && (
            <p className="orb__notice orb__notice--error">
              That window is no longer the active window. The preview shows it as it
              was when recorded.
            </p>
          )}
          <img
            className="orb__preview-image"
            src={preview.dataUrl}
            alt="Screenshot preview"
            width={preview.width}
            height={preview.height}
          />
          <p className="orb__notice">
            {preview.width}x{preview.height}, {formatBytes(preview.bytes)}. Nothing has
            been sent yet.
          </p>
          <div className="orb__actions">
            <button
              type="button"
              className="orb__button orb__button--primary"
              onClick={() => void resolveScreenshot(true)}
            >
              Send with message
            </button>
            <button
              type="button"
              className="orb__button"
              onClick={() => void resolveScreenshot(false)}
            >
              Discard
            </button>
          </div>
        </section>
      )}

      {status?.configured && (
        <section className="orb__task">
          <p className="orb__task-state">
            {desktopTask?.authorized
              ? `Desktop task approved (${desktopTask.actionsUsed}/${desktopTask.actionLimit} actions used): ${desktopTask.scope}`
              : "Desktop actions are not authorized. The orb cannot click, type or scroll until you approve a task."}
          </p>
          {desktopTask?.stopped && desktopTask.stoppedReason && (
            <p className="orb__notice orb__notice--error">
              Task stopped: {desktopTask.stoppedReason} Observe again and approve a new task to
              continue.
            </p>
          )}
          {desktopTask && !desktopTask.bridgeReady && (
            <p className="orb__notice orb__notice--error">
              The desktop bridge is not listening, so the orb cannot reach the desktop even with
              approval.
            </p>
          )}
          <p className="orb__task-state">
            {desktopTask?.target
              ? `Target window: "${desktopTask.target.title}" (${desktopTask.target.appName})`
              : "No target window is selected, so desktop actions cannot run."}
          </p>
          <div className="orb__actions">
            <button type="button" className="orb__button" onClick={() => void loadWindows()}>
              Choose target window…
            </button>
          </div>
          {windowChoices && (
            <ul className="orb__windows">
              {windowChoices.length === 0 && <li>No windows are available to choose.</li>}
              {windowChoices.map((choice) => (
                <li key={choice.windowId}>
                  <button
                    type="button"
                    className="orb__button"
                    onClick={() => void chooseTarget(choice.windowId)}
                  >
                    {choice.title || choice.appName}
                  </button>
                  <span className="orb__window-meta">
                    {choice.appName} · pid {choice.pid}
                    {choice.isRecorded ? " · recorded" : ""}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <form
            className="orb__composer"
            onSubmit={(event) => {
              event.preventDefault();
              void authorizeDesktop();
            }}
          >
            <input
              type="text"
              value={taskScope}
              placeholder="What should the orb be allowed to do?"
              onChange={(event) => setTaskScope(event.target.value)}
              aria-label="Desktop task scope"
            />
            <div className="orb__actions">
              <button
                type="submit"
                className="orb__button orb__button--primary"
                disabled={taskScope.trim().length === 0 || generation === 0}
              >
                Approve desktop task
              </button>
              <button
                type="button"
                className="orb__button"
                onClick={() => void revokeDesktop()}
                disabled={!desktopTask?.authorized}
              >
                Revoke
              </button>
            </div>
          </form>
        </section>
      )}

      {status?.problem && <p className="orb__notice orb__notice--error">{status.problem}</p>}
      {notice && <p className="orb__notice">{notice}</p>}
      {status && !status.piWeb.reachable && status.piWeb.problem && (
        <p className="orb__notice orb__notice--error">{status.piWeb.problem}</p>
      )}
      {status && !status.shortcutRegistered && (
        <p className="orb__notice orb__notice--error">
          Wake shortcut “{status.shortcut}” is unavailable
          {status.shortcutProblem ? `: ${status.shortcutProblem}` : "."} Use the tray
          icon instead.
        </p>
      )}
      {status && (
        <details className="orb__shortcut">
          <summary>Wake shortcut</summary>
          <form
            className="orb__composer"
            onSubmit={(event) => {
              event.preventDefault();
              void saveShortcut();
            }}
          >
            <input
              type="text"
              value={shortcutDraft}
              placeholder={status.shortcut}
              onChange={(event) => setShortcutDraft(event.target.value)}
              aria-label="Wake shortcut"
            />
            <div className="orb__actions">
              <button
                type="submit"
                className="orb__button"
                disabled={shortcutDraft.trim().length === 0}
              >
                Apply
              </button>
            </div>
          </form>
        </details>
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
