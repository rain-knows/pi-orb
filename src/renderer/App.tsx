import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { DesktopTaskStatus, DesktopWindowChoice, FloatingWindowState, OrbSessionEvent, WorkspaceStatus } from "@shared/ipc";
import { formatBytes } from "@shared/screenshot";
import { getBridge } from "./bridge";
import avatarUrl from "./orb-avatar.png";

interface ChatMessage { readonly role: "user" | "assistant" | "error"; readonly text: string }
interface PreviewState { readonly observationId: string; readonly dataUrl: string; readonly width: number; readonly height: number; readonly bytes: number; readonly targetDescription: string; readonly targetStale: boolean }

export function App() {
  const bridge = useMemo(() => getBridge(), []);
  const [status, setStatus] = useState<WorkspaceStatus | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [preview, setPreview] = useState<PreviewState | null>(null);
  const [controlsOpen, setControlsOpen] = useState(false);
  const [shortcutDraft, setShortcutDraft] = useState("");
  const [taskScope, setTaskScope] = useState("");
  const [desktopTask, setDesktopTask] = useState<DesktopTaskStatus | null>(null);
  const [windowChoices, setWindowChoices] = useState<readonly DesktopWindowChoice[] | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [floatingState, setFloatingState] = useState<FloatingWindowState>({ expanded: false, horizontal: "right", vertical: "down", docked: undefined });
  const drag = useRef<{ pointerId: number; startX: number; startY: number; offsetX: number; offsetY: number; moved: boolean } | null>(null);
  const streaming = useRef("");
  const generation = status?.generation ?? 0;

  useEffect(() => {
    void bridge.getStatus().then((next) => { setStatus(next); setDesktopTask(next.desktopTask); });
    return bridge.onSessionEvent((event: OrbSessionEvent) => {
      if (event.type === "assistant-delta") { streaming.current += event.text; setMessages((current) => withStreaming(current, streaming.current)); }
      else if (event.type === "assistant-message") { streaming.current = ""; setMessages((current) => withCompleted(current, event.text)); }
      else if (event.type === "error") { setNotice(event.message); setBusy(false); }
      else if (event.type === "idle") setBusy(false);
      else if (event.type === "session") setNotice(`Session ${event.sessionId.slice(0, 8)} ready.`);
    });
  }, [bridge]);

  const refresh = useCallback(async () => { const next = await bridge.refreshConnection(); setStatus(next); setDesktopTask(next.desktopTask); }, [bridge]);
  const setExpandedState = useCallback(async (next: boolean) => {
    try {
      const state = await bridge.setFloatingExpanded(next);
      setFloatingState(state);
      setExpanded(state.expanded);
    } catch (error) { setNotice(error instanceof Error ? error.message : String(error)); }
  }, [bridge]);
  const chooseWorkspace = useCallback(async () => { const picked = await bridge.chooseWorkspace(); if (!picked.ok) { if (picked.message) setNotice(picked.message); return; } const next = await bridge.setWorkspace(picked.resolved ?? "", false); setStatus(next); setDesktopTask(next.desktopTask); }, [bridge]);
  const send = useCallback(async () => {
    const text = draft.trim(); if (!text || busy || generation === 0) return;
    setDraft(""); setNotice(null); streaming.current = ""; setMessages((current) => [...current, { role: "user", text }]); setBusy(true);
    try { await bridge.ensureSession(); await bridge.sendPrompt({ generation, text }); }
    catch (error) { setBusy(false); setMessages((current) => [...current, { role: "error", text: error instanceof Error ? error.message : String(error) }]); }
  }, [bridge, busy, draft, generation]);
  const stop = useCallback(async () => { try { await bridge.abort({ generation }); } catch (error) { setNotice(error instanceof Error ? error.message : String(error)); } finally { setBusy(false); } }, [bridge, generation]);
  const screenshot = useCallback(async () => {
    if (busy || generation === 0) return; const result = await bridge.captureScreenshot({ generation, text: draft.trim() });
    if (!result.ok) { setNotice(result.message); return; }
    setPreview({ observationId: result.observationId, dataUrl: `data:${result.mimeType};base64,${result.data}`, width: result.width, height: result.height, bytes: result.bytes, targetDescription: result.targetDescription, targetStale: result.targetStale });
  }, [bridge, busy, draft, generation]);
  const resolveScreenshot = useCallback(async (confirmed: boolean) => {
    const current = preview; setPreview(null); if (!current) return;
    const result = await bridge.resolveScreenshot({ generation, observationId: current.observationId, confirmed });
    if (!result.sent) { if (confirmed) setNotice(result.message); return; }
    setMessages((items) => [...items, { role: "user", text: `[screenshot] ${current.targetDescription}` }]); setBusy(true);
  }, [bridge, generation, preview]);
  const loadWindows = useCallback(async () => { const result = await bridge.listDesktopWindows(); if (!result.ok) setNotice(result.message); else setWindowChoices(result.windows); }, [bridge]);
  const chooseTarget = useCallback(async (windowId: string) => { const result = await bridge.setDesktopTarget(windowId); if (!result.ok) { setNotice(result.message); return; } setWindowChoices(null); setTaskScope(""); setDesktopTask(await bridge.getDesktopTaskStatus()); }, [bridge]);
  const authorizeDesktop = useCallback(async () => { const scope = taskScope.trim(); if (!scope || generation === 0) return; const next = await bridge.authorizeDesktopTask({ generation, scope }); setDesktopTask(next); setNotice(next.authorized ? "Desktop task approved." : next.stoppedReason); }, [bridge, generation, taskScope]);
  const revokeDesktop = useCallback(async () => { setDesktopTask(await bridge.revokeDesktopTask()); setNotice("Desktop authorization revoked."); }, [bridge]);
  const saveShortcut = useCallback(async () => { const candidate = shortcutDraft.trim(); if (!candidate) return; const next = await bridge.setShortcut(candidate); setStatus(next); setShortcutDraft(""); setNotice(next.shortcutRegistered ? `Wake shortcut set to ${next.shortcut}.` : next.shortcutProblem); }, [bridge, shortcutDraft]);

  const floatingClasses = [
    "orb",
    expanded ? "orb--expanded" : "orb--collapsed",
    `orb--expand-${floatingState.horizontal}`,
    `orb--expand-${floatingState.vertical}`,
    floatingState.docked ? `orb--docked-${floatingState.docked}` : "",
  ].filter(Boolean).join(" ");

  return <div className={floatingClasses} onPointerEnter={() => void setExpandedState(true)}>
    <header className="orb__header">
      <button type="button" className="orb__round-button" onClick={() => void refresh()} title="Refresh connection" aria-label="Refresh connection">◷</button>
      <button type="button" className="orb__permission" onClick={() => setControlsOpen((open) => !open)} aria-expanded={controlsOpen} title="Open Orb controls"><span className={`orb__status-dot ${status?.piWeb.reachable ? "orb__status-dot--live" : ""}`} />{desktopTask?.authorized ? "Desktop access" : "Orb access"}<span className="orb__chevron">⌄</span></button>
      <button type="button" className="orb__round-button" onClick={() => setControlsOpen((open) => !open)} title="Open controls" aria-label="Open controls">+</button>
    </header>

    {!status?.configured ? <section className="orb__setup"><img src={avatarUrl} alt="" className="orb__setup-avatar" /><h1>Choose a workspace</h1><p>Give pi-orb its own folder to start a private desktop conversation.</p><button type="button" className="orb__button orb__button--primary" onClick={() => void chooseWorkspace()}>Choose folder</button></section> : <>
      <main className="orb__messages">
        {messages.length === 0 && <div className="orb__empty"><img src={avatarUrl} alt="" className="orb__empty-avatar" /><p>Ask me anything about the window you're working in.</p><div className="orb__suggestions"><button type="button" onClick={() => setDraft("Summarize what is on screen")}>Summarize this screen</button><button type="button" onClick={() => setDraft("Help me with this task")}>Help me with this task</button></div></div>}
        {messages.map((message, index) => <article key={index} className={`orb__message orb__message--${message.role}`}><span className="orb__message-role">{message.role === "user" ? "You" : message.role === "error" ? "Error" : "Orb"}</span><div>{message.text}</div></article>)}
        {busy && <div className="orb__thinking"><span /><span /><span /> <em>Thinking</em></div>}
      </main>
      <form className="orb__composer" onSubmit={(event) => { event.preventDefault(); void send(); }}><textarea value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="Ask anything" rows={2} /><div className="orb__composer-footer"><button type="button" className="orb__text-button" onClick={() => void screenshot()} disabled={busy}>Add context</button><span className="orb__composer-spacer" />{busy && <button type="button" className="orb__text-button orb__text-button--danger" onClick={() => void stop()}>Stop</button>}<button type="submit" className="orb__send" disabled={busy || !draft.trim()} aria-label="Send">↑</button></div></form>
    </>}

    <img src={avatarUrl} alt="pi-orb" className="orb__avatar" />
    {controlsOpen && status?.configured && <section className="orb__controls" aria-label="Orb controls"><div className="orb__control-heading"><strong>Orb controls</strong><button type="button" className="orb__close" onClick={() => setControlsOpen(false)} aria-label="Close controls">×</button></div><div className="orb__control-section"><span className="orb__eyebrow">DESKTOP TASK</span><strong>{desktopTask?.target?.title ?? "No target selected"}</strong><small>{desktopTask?.authorized ? `Approved · ${desktopTask.actionsUsed}/${desktopTask.actionLimit} actions` : "Locked until you approve a task"}</small><button type="button" className="orb__button" onClick={() => void loadWindows()}>Choose target</button>{windowChoices && <div className="orb__window-list">{windowChoices.map((choice) => <button key={choice.windowId} type="button" onClick={() => void chooseTarget(choice.windowId)}><strong>{choice.title || choice.appName}</strong><small>{choice.appName}</small></button>)}</div>}<form onSubmit={(event) => { event.preventDefault(); void authorizeDesktop(); }}><input value={taskScope} onChange={(event) => setTaskScope(event.target.value)} placeholder="What may Orb do?" aria-label="Desktop task scope" /><div className="orb__actions"><button type="submit" className="orb__button orb__button--primary" disabled={!taskScope.trim()}>Approve</button><button type="button" className="orb__button" onClick={() => void revokeDesktop()} disabled={!desktopTask?.authorized}>Revoke</button></div></form></div><div className="orb__control-section"><span className="orb__eyebrow">SHORTCUT</span><small>Wake or hide the orb from anywhere.</small><form className="orb__shortcut-form" onSubmit={(event) => { event.preventDefault(); void saveShortcut(); }}><input value={shortcutDraft} onChange={(event) => setShortcutDraft(event.target.value)} placeholder={status.shortcut} aria-label="Wake shortcut" /><button type="submit" className="orb__button" disabled={!shortcutDraft.trim()}>Apply</button></form></div></section>}
    {preview && <section className="orb__preview"><div className="orb__preview-heading"><strong>Review screenshot</strong><button type="button" className="orb__close" onClick={() => void resolveScreenshot(false)} aria-label="Close preview">×</button></div><p>{preview.targetDescription}</p>{preview.targetStale && <p className="orb__notice orb__notice--error">The window changed since capture.</p>}<img className="orb__preview-image" src={preview.dataUrl} alt="Screenshot preview" width={preview.width} height={preview.height} /><small>{preview.width}x{preview.height} · {formatBytes(preview.bytes)} · not sent yet</small><div className="orb__actions"><button type="button" className="orb__button orb__button--primary" onClick={() => void resolveScreenshot(true)}>Send</button><button type="button" className="orb__button" onClick={() => void resolveScreenshot(false)}>Discard</button></div></section>}
    {notice && <p className="orb__notice">{notice}</p>}
    {floatingState.docked && <button
      type="button"
      className="orb__dock-tab"
      onClick={() => {
        void bridge.unsnapFloatingBall()
          .then((state) => { setFloatingState(state); setExpanded(state.expanded); })
          .catch((error: unknown) => setNotice(error instanceof Error ? error.message : String(error)));
      }}
      aria-label="Pull orb out of the screen edge"
    />}
    <button
      type="button"
      className="orb__ball"
      onClick={() => {
        if (drag.current?.moved) { drag.current = null; return; }
        void setExpandedState(!expanded);
      }}
      onPointerDown={(event) => {
        event.currentTarget.setPointerCapture(event.pointerId);
        const bounds = event.currentTarget.getBoundingClientRect();
        drag.current = {
          pointerId: event.pointerId,
          startX: event.screenX,
          startY: event.screenY,
          offsetX: event.clientX - bounds.left,
          offsetY: event.clientY - bounds.top,
          moved: false,
        };
      }}
      onPointerMove={(event) => {
        const current = drag.current;
        if (!current || current.pointerId !== event.pointerId) return;
        if (!current.moved && Math.hypot(event.screenX - current.startX, event.screenY - current.startY) <= 4) return;
        const wasMoved = current.moved;
        current.moved = true;
        if (!wasMoved && expanded) void setExpandedState(false);
        void bridge.moveFloatingBall(event.screenX - current.offsetX, event.screenY - current.offsetY)
          .then((state) => { setFloatingState(state); setExpanded(state.expanded); })
          .catch((error: unknown) => setNotice(error instanceof Error ? error.message : String(error)));
      }}
      onPointerUp={(event) => {
        if (drag.current?.pointerId !== event.pointerId) return;
        if (drag.current.moved) {
          void bridge.clampFloatingBall()
            .then((state) => { setFloatingState(state); setExpanded(state.expanded); })
            .catch((error: unknown) => setNotice(error instanceof Error ? error.message : String(error)));
        }
        event.currentTarget.releasePointerCapture(event.pointerId);
      }}
      onPointerCancel={() => {
        drag.current = null;
        void bridge.clampFloatingBall()
          .then((state) => { setFloatingState(state); setExpanded(state.expanded); })
          .catch((error: unknown) => setNotice(error instanceof Error ? error.message : String(error)));
      }}
      aria-label={expanded ? "Collapse orb" : "Expand orb"}
    ><img src={avatarUrl} alt="" /></button>
  </div>;
}

function withStreaming(current: ChatMessage[], text: string): ChatMessage[] { const copy = [...current]; const last = copy[copy.length - 1]; if (last?.role === "assistant") copy[copy.length - 1] = { role: "assistant", text }; else copy.push({ role: "assistant", text }); return copy; }
function withCompleted(current: ChatMessage[], text: string): ChatMessage[] { return withStreaming(current, text); }
