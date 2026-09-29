/**
 * Orb renderer.
 *
 * Source: the DOM/CSS state machine of `deepseek-harness-orb` commit
 * `72f1d738458a223696685a909e806b683eff5885`, `apps/desktop/renderer/floating.{html,css,js}`
 * (MIT — see `THIRD_PARTY_NOTICES.md` §3.5) and `doc/p2-01-reference-reuse.md`. The interaction
 * language (hover to expand, click to pin, history/permission popovers, 72px composer) is reused;
 * the dsh host protocol behind it is not — session state comes from pi-web's public API through
 * `window.orb`.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { DesktopTaskStatus, DesktopWindowChoice, FloatingWindowState, OrbSessionEvent, OrbHistoryMessage, OrbSessionHistoryItem, OrbSelectionContext, WorkspaceStatus } from "@shared/ipc";
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
  const [pinned, setPinned] = useState(false);
  const [floatingState, setFloatingState] = useState<FloatingWindowState>({ expanded: false, horizontal: "right", vertical: "down", docked: undefined });
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyItems, setHistoryItems] = useState<readonly OrbSessionHistoryItem[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [selectionContext, setSelectionContext] = useState<OrbSelectionContext | null>(null);
  const drag = useRef<{ pointerId: number; startX: number; startY: number; offsetX: number; offsetY: number; moved: boolean } | null>(null);
  const collapseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
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

  useEffect(() => {
    void bridge.getSelectionContext().then(setSelectionContext);
    return bridge.onSelectionContext(setSelectionContext);
  }, [bridge]);

  const clearCollapseTimer = useCallback(() => {
    if (collapseTimer.current !== null) {
      clearTimeout(collapseTimer.current);
      collapseTimer.current = null;
    }
  }, []);
  const setExpandedState = useCallback(async (next: boolean) => {
    if (next) clearCollapseTimer();
    try {
      const state = await bridge.setFloatingExpanded(next);
      setFloatingState(state);
      setExpanded(state.expanded);
    } catch (error) { setNotice(error instanceof Error ? error.message : String(error)); }
  }, [bridge, clearCollapseTimer]);
  const scheduleCollapse = useCallback((allowPinned = false) => {
    clearCollapseTimer();
    if ((!allowPinned && pinned) || busy || controlsOpen || historyOpen || preview) return;
    collapseTimer.current = setTimeout(() => {
      collapseTimer.current = null;
      void setExpandedState(false);
    }, 480);
  }, [busy, clearCollapseTimer, controlsOpen, historyOpen, pinned, preview, setExpandedState]);
  // Hover drives expansion at the window edge, the way the reference wires it: the listeners sit on
  // `document.body` because the panel and the ball are siblings and the pointer crosses the gap
  // between them while the panel animates open.
  useEffect(() => {
    const onEnter = () => {
      clearCollapseTimer();
      if (!floatingState.docked && !expanded) void setExpandedState(true);
    };
    const onLeave = () => scheduleCollapse();
    document.body.addEventListener("pointerenter", onEnter);
    document.body.addEventListener("pointerleave", onLeave);
    return () => {
      document.body.removeEventListener("pointerenter", onEnter);
      document.body.removeEventListener("pointerleave", onLeave);
    };
  }, [clearCollapseTimer, expanded, floatingState.docked, scheduleCollapse, setExpandedState]);

  const chooseWorkspace = useCallback(async () => { const picked = await bridge.chooseWorkspace(); if (!picked.ok) { if (picked.message) setNotice(picked.message); return; } const next = await bridge.setWorkspace(picked.resolved ?? "", false); setStatus(next); setDesktopTask(next.desktopTask); }, [bridge]);
  const newConversation = useCallback(async () => {
    if (busy) return;
    try {
      await bridge.newConversation();
      setMessages([]);
      setDraft("");
      setNotice(null);
      streaming.current = "";
      setBusy(false);
    } catch (error) { setNotice(error instanceof Error ? error.message : String(error)); }
  }, [bridge, busy]);
  const loadHistory = useCallback(async () => {
    setControlsOpen(false);
    setHistoryOpen(true);
    setHistoryLoading(true);
    const result = await bridge.listSessionHistory();
    setHistoryLoading(false);
    if (!result.ok) { setNotice(result.message); return; }
    setHistoryItems(result.sessions);
  }, [bridge]);
  const openHistory = useCallback(async (sessionId: string) => {
    const result = await bridge.openSessionHistory(sessionId);
    if (!result.ok) { setNotice(result.message); return; }
    setMessages(result.messages.map((message: OrbHistoryMessage) => ({ role: message.role, text: message.text })));
    setHistoryOpen(false);
    setNotice(null);
    streaming.current = "";
    setBusy(false);
  }, [bridge]);
  const send = useCallback(async () => {
    const instruction = draft.trim();
    if ((!instruction && !selectionContext) || busy || generation === 0) return;
    const text = selectionContext
      ? `${instruction || "Please help me understand this selected text."}\n\n[Selected text from ${selectionContext.sourceLabel ?? "another application"}]\n${selectionContext.text}`
      : instruction;
    setDraft(""); setNotice(null); streaming.current = ""; setMessages((current) => [...current, { role: "user", text }]); setBusy(true);
    try { await bridge.ensureSession(); await bridge.sendPrompt({ generation, text }); await bridge.clearSelectionContext(); setSelectionContext(null); }
    catch (error) { setBusy(false); setMessages((current) => [...current, { role: "error", text: error instanceof Error ? error.message : String(error) }]); }
  }, [bridge, busy, draft, generation, selectionContext]);
  const stop = useCallback(async () => { try { await bridge.abort({ generation }); } catch (error) { setNotice(error instanceof Error ? error.message : String(error)); } finally { setBusy(false); } }, [bridge, generation]);
  const screenshot = useCallback(async () => {
    if (busy || generation === 0) return; const result = await bridge.captureScreenshot({ generation, text: draft.trim() });
    if (!result.ok) { setNotice(result.message); return; }
    setPreview({ observationId: result.observationId, dataUrl: `data:${result.mimeType};base64,${result.data}`, width: result.width, height: result.height, bytes: result.bytes, targetDescription: result.targetDescription, targetStale: result.targetStale });
  }, [bridge, busy, draft, generation]);
  useEffect(() => bridge.onDoubleAltGesture(() => { void screenshot(); }), [bridge, screenshot]);
  const resolveScreenshot = useCallback(async (confirmed: boolean) => {
    const current = preview; setPreview(null); if (!current) return;
    const result = await bridge.resolveScreenshot({ generation, observationId: current.observationId, confirmed });
    if (!result.sent) { if (confirmed) setNotice(result.message); return; }
    setMessages((items) => [...items, { role: "user", text: `[screenshot] ${current.targetDescription}` }]); setBusy(true);
  }, [bridge, generation, preview]);
  const exportScreenshot = useCallback(async () => {
    const current = preview;
    if (!current) return;
    const result = await bridge.exportScreenshot({ generation, observationId: current.observationId });
    if (!result.ok) {
      if (!result.canceled) setNotice(result.message);
      return;
    }
    setNotice(result.clipboard ? `Saved ${result.path} and copied it to the clipboard.` : `Saved ${result.path}.`);
  }, [bridge, generation, preview]);
  const loadWindows = useCallback(async () => { const result = await bridge.listDesktopWindows(); if (!result.ok) setNotice(result.message); else setWindowChoices(result.windows); }, [bridge]);
  const chooseTarget = useCallback(async (windowId: string) => { const result = await bridge.setDesktopTarget(windowId); if (!result.ok) { setNotice(result.message); return; } setWindowChoices(null); setTaskScope(""); setDesktopTask(await bridge.getDesktopTaskStatus()); }, [bridge]);
  const authorizeDesktop = useCallback(async () => { const scope = taskScope.trim(); if (!scope || generation === 0) return; const next = await bridge.authorizeDesktopTask({ generation, scope }); setDesktopTask(next); setNotice(next.authorized ? "Desktop task approved." : next.stoppedReason); }, [bridge, generation, taskScope]);
  const revokeDesktop = useCallback(async () => { setDesktopTask(await bridge.revokeDesktopTask()); setNotice("Desktop authorization revoked."); }, [bridge]);
  const saveShortcut = useCallback(async () => { const candidate = shortcutDraft.trim(); if (!candidate) return; const next = await bridge.setShortcut(candidate); setStatus(next); setShortcutDraft(""); setNotice(next.shortcutRegistered ? `Wake shortcut set to ${next.shortcut}.` : next.shortcutProblem); }, [bridge, shortcutDraft]);

  useEffect(() => () => clearCollapseTimer(), [clearCollapseTimer]);

  // Layout state is expressed on `body`, the way the reference does it, so the stylesheet owns
  // placement and React owns only the state. There is one mechanism for one state model: every state
  // below is a body class, and `tests/renderer-reference-parity.test.ts` fails if a selector the
  // shell can emit has no rule.
  useEffect(() => {
    const classes = [
      expanded ? "expanded" : "",
      pinned ? "pinned" : "",
      busy ? "running" : "",
      selectionContext ? "has-selection-chip" : "",
      draft.length > 120 ? "composer-capped" : "",
      floatingState.docked ? "docked" : "",
      `expand-${floatingState.horizontal}`,
      `expand-${floatingState.vertical}`,
      floatingState.docked ? `docked-${floatingState.docked}` : "",
    ].filter(Boolean);
    document.body.className = classes.join(" ");
  }, [expanded, pinned, busy, selectionContext, draft, floatingState]);

  // Theme, ported from the reference's `applyColorScheme` (floating.js:42-47): the initial value is
  // the OS preference, the attribute is toggled rather than set/removed, and `color-scheme` is set
  // too so the browser's own widgets (scrollbars, focus rings) follow instead of only our palette.
  // The reference also accepts a later `dsh.overlay.theme` message from its host; pi-orb has no such
  // channel because the shell and this renderer are one process, so the media query stays the source.
  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      document.documentElement.style.colorScheme = media.matches ? "dark" : "light";
      document.documentElement.toggleAttribute("data-ds-dark-theme", media.matches);
    };
    apply();
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, []);

  // The reference keeps `#panel` in the DOM and toggles it with `hidden`; the CSS transition on
  // #panel is what animates the reveal, so the element must exist before the state flips. The shell
  // therefore mounts the panel unconditionally and drives visibility through `hidden` plus the body
  // state classes below — the same split the reference uses.
  const panelContent = !status?.configured ? (
    <section className="empty-state">
      <img src={avatarUrl} alt="" />
      <h1>Choose a workspace</h1>
      <p>Give pi-orb its own folder to start a private desktop conversation.</p>
      <button type="button" className="pill-button pill-button--primary" onClick={() => void chooseWorkspace()}>Choose folder</button>
    </section>
  ) : (
    <>
      <div id="transcript" role="log" aria-live="polite">
        {messages.length === 0 && <div className="empty-state"><img src={avatarUrl} alt="" /><p>Ask me anything about the window you're working in.</p></div>}
        {messages.map((message, index) => <article key={index} className={`message message--${message.role}`}><span className="message-role">{message.role === "user" ? "You" : message.role === "error" ? "Error" : "Orb"}</span><div>{message.text}</div></article>)}
        {busy && <div className="thinking"><span /><span /><span /> <em>Thinking</em></div>}
      </div>
      <form id="composer" onSubmit={(event) => { event.preventDefault(); void send(); }}>
        <label id="input-label" htmlFor="prompt">Message</label>
        <textarea id="prompt" value={draft} onChange={(event) => setDraft(event.target.value)} placeholder={selectionContext ? "Ask about the selected text" : "Ask anything"} />
        <div id="composer-actions"><button type="button" className="text-button" onClick={() => void screenshot()} disabled={busy}>Add context</button><span className="composer-spacer" />{busy && <button type="button" className="text-button text-button--danger" onClick={() => void stop()}>Stop</button>}<button id="send" type="submit" disabled={busy || (!draft.trim() && !selectionContext)} aria-label="Send">↑</button></div>
      </form>
      <div id="selection-chip" hidden={!selectionContext} title={selectionContext?.text}>
        <span id="selection-chip-text">{selectionContext ? `${selectionContext.sourceLabel ?? "Another application"} · ${selectionSummary(selectionContext.text)}` : ""}</span>
        <button id="selection-chip-dismiss" type="button" onClick={() => { void bridge.clearSelectionContext(); setSelectionContext(null); }} aria-label="Remove selected text" title="Remove selected text">×</button>
      </div>
      {historyOpen && <section className="sheet" aria-label="Conversation history">{historyLoading ? <p className="history-empty">Loading…</p> : historyItems.length === 0 ? <p className="history-empty">No saved conversations.</p> : <div id="history-list" role="listbox">{historyItems.map((item) => <button type="button" key={item.sessionId} className="history-row" onClick={() => void openHistory(item.sessionId)}><strong>{item.name || item.firstMessage || "Untitled conversation"}</strong><small>{item.messageCount} messages · {formatHistoryDate(item.modified)}</small></button>)}</div>}</section>}
      {controlsOpen && (
        <section className="sheet" aria-label="Orb controls">
          <div className="sheet-heading">
            <strong>Orb controls</strong>
            <button type="button" className="icon-button" onClick={() => setControlsOpen(false)} aria-label="Close controls">×</button>
          </div>
          <div className="sheet-section">
            <span className="sheet-eyebrow">DESKTOP TASK</span>
            <strong>{desktopTask?.target?.title ?? "No target selected"}</strong>
            <small>{desktopTask?.authorized ? `Approved · ${desktopTask.actionsUsed}/${desktopTask.actionLimit} actions` : "Locked until you approve a task"}</small>
            <small>After approval, successful actions send a fresh target-window image to the model.</small>
            <button type="button" className="pill-button" onClick={() => void loadWindows()}>Choose target</button>
            {windowChoices && (
              <div className="sheet-list" role="listbox">
                {windowChoices.map((choice) => (
                  <button key={choice.windowId} type="button" aria-selected={choice.windowId === desktopTask?.target?.windowId} onClick={() => void chooseTarget(choice.windowId)}>
                    <strong>{choice.title || choice.appName}</strong>
                    <small>{choice.appName}</small>
                  </button>
                ))}
              </div>
            )}
            <form className="sheet-form" onSubmit={(event) => { event.preventDefault(); void authorizeDesktop(); }}>
              <input value={taskScope} onChange={(event) => setTaskScope(event.target.value)} placeholder="What may Orb do?" aria-label="Desktop task scope" />
            </form>
            <div className="sheet-actions">
              <button type="button" className="pill-button pill-button--primary" disabled={!taskScope.trim()} onClick={() => void authorizeDesktop()}>Approve</button>
              <button type="button" className="pill-button" onClick={() => void revokeDesktop()} disabled={!desktopTask?.authorized}>Revoke</button>
            </div>
          </div>
          <div className="sheet-section">
            <span className="sheet-eyebrow">SHORTCUT</span>
            <small>Wake or hide the orb from anywhere.</small>
            <form className="sheet-form" onSubmit={(event) => { event.preventDefault(); void saveShortcut(); }}>
              <input value={shortcutDraft} onChange={(event) => setShortcutDraft(event.target.value)} placeholder={status.shortcut} aria-label="Wake shortcut" />
              <button type="submit" className="pill-button" disabled={!shortcutDraft.trim()}>Apply</button>
            </form>
          </div>
        </section>
      )}
      {preview && <section className="sheet"><div className="sheet-heading"><strong>Review screenshot</strong><button type="button" className="icon-button" onClick={() => void resolveScreenshot(false)} aria-label="Close preview">×</button></div><p className="notice">{preview.targetDescription}</p>{preview.targetStale && <p className="notice notice--error">The window changed since capture.</p>}<img id="preview-image" src={preview.dataUrl} alt="Screenshot preview" width={preview.width} height={preview.height} /><small className="notice">{preview.width}x{preview.height} · {formatBytes(preview.bytes)} · not sent yet</small><div className="sheet-actions"><button type="button" className="pill-button pill-button--primary" onClick={() => void resolveScreenshot(true)}>Send</button><button type="button" className="pill-button" onClick={() => void exportScreenshot()}>Save copy</button><button type="button" className="pill-button" onClick={() => void resolveScreenshot(false)}>Discard</button></div></section>}
      {notice && <p id="status" className="notice" role="status">{notice}</p>}
    </>
  );

  // The reference reveals the panel by unhiding it and *then* adding `expanded`, so the 300ms
  // opacity/scale transition actually runs; on collapse it removes `expanded` first and only hides
  // the element after the transition. Deriving `hidden` straight from the expanded flag would cut
  // the animation, so the delay is part of the port.
  const [panelHidden, setPanelHidden] = useState(true);
  useEffect(() => {
    if (expanded) {
      setPanelHidden(false);
      return;
    }
    const timer = setTimeout(() => setPanelHidden(true), 300);
    return () => clearTimeout(timer);
  }, [expanded]);

  return <>
    <section
      id="panel"
      hidden={panelHidden}
      onPointerEnter={() => clearCollapseTimer()}
    >
      <button id="history" type="button" onClick={() => void loadHistory()} title="Conversation history" aria-label="Conversation history">◷</button>
      <div id="permission">
        <button id="permission-button" type="button" onClick={() => { setHistoryOpen(false); setControlsOpen((open) => !open); }} aria-haspopup="dialog" aria-expanded={controlsOpen} title="Open Orb controls">
          <span id="permission-dot" data-live={status?.piWeb.reachable ? "" : undefined} />
          <span id="permission-label">{desktopTask?.authorized ? "Desktop access" : "Orb access"}</span>
          <span id="permission-chevron">⌄</span>
        </button>
      </div>
      <button id="new-conversation" type="button" onClick={() => void newConversation()} title="New conversation" aria-label="New conversation" disabled={busy}>+</button>
      {panelContent}
    </section>
    <button
      id="ball"
      type="button"
      onClick={() => {
        if (drag.current?.moved) { drag.current = null; return; }
        if (pinned) {
          setPinned(false);
          scheduleCollapse(true);
        } else {
          setPinned(true);
          clearCollapseTimer();
          void setExpandedState(true);
        }
      }}
      onPointerDown={(event) => {
        clearCollapseTimer();
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
        if (!wasMoved) {
          setPinned(false);
          if (expanded) void setExpandedState(false);
        }
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
    <button
      id="dock-tab"
      type="button"
      hidden={!floatingState.docked}
      onClick={() => {
        void bridge.unsnapFloatingBall()
          .then((state) => { setFloatingState(state); setExpanded(state.expanded); })
          .catch((error: unknown) => setNotice(error instanceof Error ? error.message : String(error)));
      }}
      aria-hidden={!floatingState.docked}
      aria-label="Pull orb out of the screen edge"
    />
  </>;
}

function withStreaming(current: ChatMessage[], text: string): ChatMessage[] { const copy = [...current]; const last = copy[copy.length - 1]; if (last?.role === "assistant") copy[copy.length - 1] = { role: "assistant", text }; else copy.push({ role: "assistant", text }); return copy; }
function withCompleted(current: ChatMessage[], text: string): ChatMessage[] { return withStreaming(current, text); }

function formatHistoryDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function selectionSummary(text: string): string {
  const compact = text.replace(/\s+/g, " ").trim();
  return compact.length > 72 ? `${compact.slice(0, 69)}...` : compact;
}
