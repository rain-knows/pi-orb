import { readFileSync } from "node:fs";
import { join } from "node:path";
import { runInContext } from "node:vm";
import { JSDOM } from "jsdom";
import { afterEach, expect, it, vi } from "vitest";

// Adapted from deepseek-harness-orb/apps/desktop/tests/floating-renderer.spec.ts
// at 72f1d738458a223696685a909e806b683eff5885 (MIT). The original mocks
// DSH RPC; this harness verifies the Pi preload calls and real DOM transitions.
const root = join(import.meta.dirname, "..");
const html = readFileSync(join(root, "src/renderer/index.html"), "utf8");
const script = readFileSync(join(root, "src/renderer/floating.js"), "utf8");
const openDoms: JSDOM[] = [];

function harness(configured = true) {
  const dom = new JSDOM(html, { runScripts: "outside-only", url: "https://orb.local/index.html" });
  openDoms.push(dom);
  const win = dom.window;
  const themeListeners: Array<() => void> = [];
  const media = { matches: false, addEventListener: (_name: string, listener: () => void) => themeListeners.push(listener) };
  Object.defineProperty(win, "matchMedia", { value: () => media });
  Object.defineProperty(win.HTMLElement.prototype, "setPointerCapture", { value: vi.fn() });
  Object.defineProperty(win.HTMLElement.prototype, "releasePointerCapture", { value: vi.fn() });
  let status = {
    configured,
    generation: 1,
    busy: false,
    sessionId: null as string | null,
    shortcut: "Alt+Space",
    shortcutRegistered: true,
    shortcutProblem: null as string | null,
    desktopTask: {
      authorized: false,
      level: null as string | null,
      sessionId: null as string | null,
      generation: null as number | null,
      stoppedReason: null as string | null,
    },
  };
  let onEvent: (event: Record<string, unknown>) => void = () => {};
  let onSelection: (value: unknown) => void = () => {};
  let onDoubleAlt: () => void = () => {};
  let onShellMenuAction: (action: "model" | "screenshot" | "shortcut" | "workspace") => void = () => {};
  const api = {
    getStatus: vi.fn(async () => status),
    getSelectionContext: vi.fn(async () => null),
    onSessionEvent: vi.fn((listener: typeof onEvent) => { onEvent = listener; return () => {}; }),
    onSelectionContext: vi.fn((listener: typeof onSelection) => { onSelection = listener; return () => {}; }),
    onDoubleAltGesture: vi.fn((listener: typeof onDoubleAlt) => { onDoubleAlt = listener; return () => {}; }),
    setFloatingExpanded: vi.fn(async (expanded: boolean) => ({ expanded, horizontal: "left", vertical: "up", docked: undefined })),
    moveFloatingBall: vi.fn(async () => ({ expanded: false, horizontal: "left", vertical: "up", docked: undefined })),
    clampFloatingBall: vi.fn(async () => ({ expanded: false, horizontal: "left", vertical: "up", docked: undefined as "left" | "right" | undefined })),
    unsnapFloatingBall: vi.fn(async () => ({ expanded: false, horizontal: "left", vertical: "up", docked: undefined })),
    chooseWorkspace: vi.fn(async () => ({ ok: true, resolved: "C:\\orb" })),
    setWorkspace: vi.fn(async () => { status = { ...status, configured: true, generation: status.generation + 1 }; return status; }),
    ensureSession: vi.fn(async () => "session-1"),
    sendPrompt: vi.fn(async () => {}),
    clearSelectionContext: vi.fn(async () => true),
    abort: vi.fn(async () => {}),
    newConversation: vi.fn(async () => "session-2"),
    listSessionHistory: vi.fn(async () => ({ ok: true, sessions: [{ sessionId: "session-old", name: "Earlier", firstMessage: "Earlier", modified: "2026-09-30T00:00:00Z", messageCount: 2 }] })),
    openSessionHistory: vi.fn(async () => ({ ok: true, sessionId: "session-old", messages: [{ role: "user", text: "Old question" }, { role: "assistant", text: "Old answer" }] })),
    setOrbAccess: vi.fn(async ({ generation, level }: { generation: number; level: string }) => { status.desktopTask = { ...status.desktopTask, authorized: true, level, sessionId: "session-1", generation }; return status.desktopTask; }),
    getOrbAccess: vi.fn(async () => status.desktopTask),
    revokeOrbAccess: vi.fn(async () => { status.desktopTask = { ...status.desktopTask, authorized: false, level: null }; return status.desktopTask; }),
    captureScreenshot: vi.fn(async () => ({ ok: true, observationId: "observation-1", mimeType: "image/png", data: "iVBORw0KGgo=", width: 2, height: 2, bytes: 12, targetDescription: "Editor", targetStale: false })),
    resolveScreenshot: vi.fn(async () => ({ ok: true, sent: true })),
    exportScreenshot: vi.fn(async () => ({ ok: true, path: "C:\\capture.png", clipboard: true })),
    discardScreenshot: vi.fn(async () => true),
    setShortcut: vi.fn(async () => status),
    openShellMenu: vi.fn(async (_request: unknown) => true),
    onShellMenuAction: vi.fn((listener: typeof onShellMenuAction) => { onShellMenuAction = listener; return () => {}; }),
    listModels: vi.fn(async () => ({ ok: true, models: [{ provider: "test", id: "one", name: "One", input: ["text"] }], selected: null })),
    setModel: vi.fn(async () => ({ ok: true, selected: { provider: "test", id: "one" } })),
    respondQuestion: vi.fn(async () => {}),
  };
  Object.defineProperty(win, "orb", { value: api });
  runInContext(script, dom.getInternalVMContext());
  const document = win.document;
  const byId = (id: string) => document.getElementById(id)!;
  return { dom, win, document, byId, api, emit: (event: Record<string, unknown>) => onEvent(event), select: (value: unknown) => onSelection(value), doubleAlt: () => onDoubleAlt(), shellAction: (action: "model" | "screenshot" | "shortcut" | "workspace") => onShellMenuAction(action), setDark: (dark: boolean) => { media.matches = dark; for (const listener of themeListeners) listener(); } };
}

afterEach(() => { for (const dom of openDoms.splice(0)) dom.window.close(); });

it("shows the actual default Full Access grant immediately, and reflects revocation", async () => {
  const h = harness();
  await expect.poll(() => h.api.onSessionEvent.mock.calls.length).toBe(1);
  h.emit({ type: "access", status: { authorized: true, level: "full-access", generation: 1, sessionId: "session-1" } });
  expect(h.byId("permission-label").textContent).toBe("完全访问");
  expect(h.byId("access-full").getAttribute("aria-selected")).toBe("true");
  expect(h.api.setOrbAccess).not.toHaveBeenCalled();
  h.emit({ type: "access", status: { authorized: false, level: null, stopped: true } });
  expect(h.byId("permission-label").textContent).toBe("访问权限");
  expect(h.byId("access-full").getAttribute("aria-selected")).toBe("false");
});

it("switches workspace from the configured shell and clears previous conversation context", async () => {
  const h = harness();
  await expect.poll(() => h.api.onShellMenuAction.mock.calls.length).toBe(1);
  h.emit({ type: "assistant-message", text: "old workspace answer" });
  h.byId("prompt").textContent = "old workspace draft";
  h.select({ text: "old selection", sourceLabel: "Editor" });
  h.shellAction("workspace");
  await expect.poll(() => h.api.setWorkspace.mock.calls.length).toBe(1);
  await expect.poll(() => h.byId("prompt").textContent).toBe("");
  expect(h.document.querySelectorAll(".orb-message").length).toBe(0);
  expect(h.byId("selection-chip").hidden).toBe(true);
  expect(h.byId("composer").hidden).toBe(false);
});

it("canceling workspace selection keeps the current draft and conversation", async () => {
  const h = harness();
  await expect.poll(() => h.api.onShellMenuAction.mock.calls.length).toBe(1);
  h.api.chooseWorkspace.mockResolvedValueOnce({ ok: false, resolved: "" });
  h.emit({ type: "assistant-message", text: "keep answer" });
  h.byId("prompt").textContent = "keep draft";
  h.shellAction("workspace");
  await expect.poll(() => h.api.chooseWorkspace.mock.calls.length).toBe(1);
  expect(h.api.setWorkspace).not.toHaveBeenCalled();
  expect(h.byId("prompt").textContent).toBe("keep draft");
  expect(h.document.querySelectorAll(".orb-message").length).toBe(1);
});

it("offers the workspace gate, then enables the reference composer", async () => {
  const h = harness(false);
  await expect.poll(() => h.byId("workspace-gate").hidden).toBe(false);
  expect(h.byId("composer").hidden).toBe(true);
  h.byId("choose-workspace").click();
  await expect.poll(() => h.api.setWorkspace.mock.calls.length).toBe(1);
  expect(h.byId("workspace-gate").hidden).toBe(true);
  expect(h.byId("composer").hidden).toBe(false);
});

it("expands on hover, pins on ball click, and collapses after the reference delay", async () => {
  const h = harness();
  await expect.poll(() => h.api.getStatus.mock.calls.length).toBe(1);
  h.document.body.dispatchEvent(new h.win.MouseEvent("pointerenter"));
  await expect.poll(() => h.document.body.classList.contains("expanded")).toBe(true);
  expect(h.byId("panel").hidden).toBe(false);
  h.byId("ball").dispatchEvent(new h.win.MouseEvent("pointerup", { button: 0 }));
  await expect.poll(() => h.document.body.classList.contains("pinned")).toBe(true);
  h.document.body.dispatchEvent(new h.win.MouseEvent("pointerleave"));
  await new Promise((resolve) => setTimeout(resolve, 220));
  expect(h.document.body.classList.contains("expanded")).toBe(true);
  h.byId("ball").dispatchEvent(new h.win.MouseEvent("pointerup", { button: 0 }));
  await expect.poll(() => h.document.body.classList.contains("pinned")).toBe(false);
  await expect.poll(() => h.document.body.classList.contains("expanded")).toBe(false);
});

it("keeps the panel open while editing a draft or answering a question", async () => {
  const h = harness();
  await expect.poll(() => h.byId("composer").hidden).toBe(false);
  h.document.body.dispatchEvent(new h.win.MouseEvent("pointerenter"));
  await expect.poll(() => h.document.body.classList.contains("expanded")).toBe(true);
  const prompt = h.byId("prompt");
  prompt.focus();
  h.document.body.dispatchEvent(new h.win.MouseEvent("pointerleave"));
  await new Promise((resolve) => setTimeout(resolve, 230));
  expect(h.document.body.classList.contains("expanded")).toBe(true);
  prompt.textContent = "未发送的内容";
  prompt.dispatchEvent(new h.win.Event("input", { bubbles: true }));
  prompt.blur();
  await new Promise((resolve) => setTimeout(resolve, 230));
  expect(h.document.body.classList.contains("expanded")).toBe(true);
  prompt.textContent = "";
  prompt.dispatchEvent(new h.win.Event("input", { bubbles: true }));
  h.emit({ type: "question", id: "q", method: "input", title: "问题", message: "", options: [], prefill: "" });
  h.document.body.dispatchEvent(new h.win.MouseEvent("pointerleave"));
  await new Promise((resolve) => setTimeout(resolve, 230));
  expect(h.document.body.classList.contains("expanded")).toBe(true);
});

it("sends with the existing Pi bridge and displays streamed replies", async () => {
  const h = harness();
  await expect.poll(() => h.byId("composer").hidden).toBe(false);
  h.byId("prompt").textContent = "Hello";
  h.byId("composer").dispatchEvent(new h.win.Event("submit", { bubbles: true, cancelable: true }));
  await expect.poll(() => h.api.sendPrompt.mock.calls.length).toBe(1);
  expect(h.api.sendPrompt).toHaveBeenCalledWith({ generation: 1, text: "Hello" });
  h.emit({ type: "assistant-delta", text: "Hel" });
  h.emit({ type: "assistant-delta", text: "lo" });
  expect(h.document.querySelector(".orb-message--assistant p")?.textContent).toBe("Hello");
  h.emit({ type: "idle", stopReason: null });
  expect(h.document.body.classList.contains("running")).toBe(false);
});

it("keeps the composer available and queues follow-up turns in order", async () => {
  const h = harness();
  await expect.poll(() => h.byId("composer").hidden).toBe(false);
  h.byId("permission-button").click();
  h.byId("access-workspace-write").click();
  await expect.poll(() => h.api.setOrbAccess.mock.calls.length).toBe(1);
  const prompt = h.byId("prompt");
  prompt.textContent = "First";
  h.byId("composer").dispatchEvent(new h.win.Event("submit", { bubbles: true, cancelable: true }));
  await expect.poll(() => h.api.sendPrompt.mock.calls.length).toBe(1);

  prompt.textContent = "Second";
  h.byId("composer").dispatchEvent(new h.win.Event("submit", { bubbles: true, cancelable: true }));
  await expect.poll(() => h.api.sendPrompt.mock.calls.length).toBe(2);
  expect(h.document.body.classList.contains("running")).toBe(true);
  expect(h.document.querySelectorAll(".orb-message--user")).toHaveLength(2);

  h.emit({ type: "queued", count: 1 });
  expect(h.byId("status").textContent).toBe("1 条消息已排队");
  h.emit({ type: "turn-start" });
  h.emit({ type: "assistant-delta", text: "Second reply" });
  expect(h.document.querySelectorAll(".orb-message--assistant")).toHaveLength(1);
  expect(h.document.querySelector(".orb-message--assistant p")?.textContent).toBe("Second reply");
  h.emit({ type: "idle", stopReason: null });
  expect(h.document.body.classList.contains("running")).toBe(false);
  await expect.poll(() => h.byId("permission-label").textContent).toBe("工作区写入");
  expect(h.api.revokeOrbAccess).not.toHaveBeenCalled();
});

it("plays the reference avatar for active states and freezes it when idle", async () => {
  const h = harness();
  await expect.poll(() => h.byId("composer").hidden).toBe(false);
  const avatar = h.byId("ball-gif");
  expect(avatar.dataset.mode).toBe("still");

  h.emit({ type: "turn-start" });
  expect(avatar.dataset.mode).toBe("play");
  h.emit({ type: "idle", stopReason: null });
  expect(avatar.dataset.mode).toBe("still");

  h.select({ text: "selected text", sourceLabel: "Editor" });
  expect(avatar.dataset.mode).toBe("play");
  h.select(null);
  expect(avatar.dataset.mode).toBe("still");
});

it("keeps keyboard editing in the composer and submits only a plain Enter", async () => {
  const h = harness();
  await expect.poll(() => h.byId("composer").hidden).toBe(false);
  const prompt = h.byId("prompt");
  h.byId("composer").click();
  expect(h.document.activeElement).toBe(prompt);
  prompt.textContent = "Two lines";
  prompt.dispatchEvent(new h.win.KeyboardEvent("keydown", { key: "Enter", shiftKey: true, bubbles: true }));
  prompt.dispatchEvent(new h.win.KeyboardEvent("keydown", { key: "Enter", isComposing: true, bubbles: true }));
  expect(h.api.sendPrompt).not.toHaveBeenCalled();
  prompt.dispatchEvent(new h.win.KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  await expect.poll(() => h.api.sendPrompt.mock.calls.length).toBe(1);
  expect(h.api.sendPrompt).toHaveBeenCalledWith({ generation: 1, text: "Two lines" });
});

it("offers the host edit menu when right-clicking the focused composer", async () => {
  const h = harness();
  await expect.poll(() => h.byId("composer").hidden).toBe(false);
  const prompt = h.byId("prompt");
  prompt.focus();
  prompt.dispatchEvent(new h.win.MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
  await expect.poll(() => h.api.openShellMenu.mock.calls.length).toBe(1);
  expect(h.api.openShellMenu.mock.calls[0]?.[0]).toMatchObject({ isEditable: true });
});

it("opens history and restores its messages into the actual transcript", async () => {
  const h = harness();
  await expect.poll(() => (h.byId("history") as HTMLButtonElement).disabled).toBe(false);
  h.byId("history").click();
  await expect.poll(() => h.document.querySelectorAll("#history-list button").length).toBe(1);
  (h.document.querySelector("#history-list button") as HTMLElement).click();
  await expect.poll(() => h.document.querySelectorAll(".orb-message").length).toBe(2);
  expect(h.byId("history-list").hidden).toBe(true);
  expect(h.byId("transcript").textContent).toContain("Old answer");
});

it("selects a session access tier and keeps screenshot confirmation explicit", async () => {
  const h = harness();
  await expect.poll(() => h.byId("composer").hidden).toBe(false);
  expect([...h.document.querySelectorAll("#history, #permission-button, #new-conversation")].map((button) => button.id)).toEqual([
    "history",
    "permission-button",
    "new-conversation",
  ]);
  expect([...h.document.querySelectorAll("#permission-menu [data-level]")].map((option) => option.textContent)).toEqual([
    "只读",
    "工作区写入",
    "完全访问",
  ]);
  expect(h.byId("target-open")).toBeNull();
  expect(h.byId("task-scope")).toBeNull();
  h.byId("permission-button").click();
  h.byId("access-workspace-write").click();
  await expect.poll(() => h.api.setOrbAccess.mock.calls.length).toBe(1);
  expect(h.api.setOrbAccess).toHaveBeenCalledWith({ generation: 1, level: "workspace-write" });
  expect(h.byId("permission-label").textContent).toBe("工作区写入");
  h.doubleAlt();
  await expect.poll(() => h.byId("preview-sheet").hidden).toBe(false);
  expect(h.api.resolveScreenshot).not.toHaveBeenCalled();
  h.byId("preview-send").click();
  await expect.poll(() => h.api.resolveScreenshot.mock.calls.length).toBe(1);
  expect(h.api.resolveScreenshot).toHaveBeenCalledWith({ generation: 1, observationId: "observation-1", confirmed: true });
});

it("renders tool progress and answers a Pi select request in the reference card", async () => {
  const h = harness();
  await expect.poll(() => h.byId("composer").hidden).toBe(false);
  h.emit({ type: "tool", phase: "start", id: "call-1", name: "orb_observe", detail: "Running", isError: false });
  h.emit({ type: "tool", phase: "end", id: "call-1", name: "orb_observe", detail: "Completed", isError: false });
  expect(h.document.querySelector(".orb-tool strong")?.textContent).toBe("观察桌面");
    expect(h.document.querySelector(".orb-tool-phase")?.textContent).toBe("完成");
    h.emit({ type: "tool", phase: "update", id: "batch-1", name: "orb_batch", detail: "执行第 2/3 步", isError: false });
    expect(h.document.querySelector(".orb-tool--running strong")?.textContent).toBe("批量操作");
    expect(h.document.querySelector(".orb-tool--running p")?.textContent).toBe("执行第 2/3 步");
  h.emit({ type: "question", id: "ask-1", method: "select", title: "Choose", message: "Pick one", options: ["First (Recommended)", "Second"], prefill: "" });
  expect(h.byId("question").hidden).toBe(false);
  expect(h.document.querySelector(".question-recommended")?.textContent).toBe("推荐");
  (h.document.querySelector("#question-options button") as HTMLElement).click();
  h.byId("question-continue").click();
  await expect.poll(() => h.api.respondQuestion.mock.calls.length).toBe(1);
  expect(h.api.respondQuestion).toHaveBeenCalledWith({ generation: 1, id: "ask-1", value: "First (Recommended)" });
  expect(h.byId("question").hidden).toBe(true);
});

it("supports Pi confirm, input and model selection through the restricted bridge", async () => {
  const h = harness();
  await expect.poll(() => h.byId("composer").hidden).toBe(false);
  h.emit({ type: "question", id: "confirm-1", method: "confirm", title: "Proceed?", message: "This window", options: [], prefill: "" });
  (h.document.querySelectorAll("#question-options button")[1] as HTMLElement).click();
  h.byId("question-continue").click();
  await expect.poll(() => h.api.respondQuestion.mock.calls.length).toBe(1);
  expect(h.api.respondQuestion).toHaveBeenNthCalledWith(1, { generation: 1, id: "confirm-1", confirmed: false });
  h.emit({ type: "question", id: "input-1", method: "input", title: "Name", message: "", options: [], prefill: "" });
  const field = h.byId("question-custom") as HTMLTextAreaElement;
  field.value = "Sample";
  field.dispatchEvent(new h.win.Event("input", { bubbles: true }));
  h.byId("question-continue").click();
  await expect.poll(() => h.api.respondQuestion.mock.calls.length).toBe(2);
  expect(h.api.respondQuestion).toHaveBeenNthCalledWith(2, { generation: 1, id: "input-1", value: "Sample" });
  h.shellAction("model");
  await expect.poll(() => h.document.querySelectorAll("#model-list button").length).toBe(1);
  (h.document.querySelector("#model-list button") as HTMLElement).click();
  await expect.poll(() => h.api.setModel.mock.calls.length).toBe(1);
  expect(h.api.setModel).toHaveBeenCalledWith({ generation: 1, provider: "test", id: "one" });
});

it("moves only after the four-pixel drag threshold and docks through the host state", async () => {
  const h = harness();
  await expect.poll(() => h.byId("composer").hidden).toBe(false);
  const ball = h.byId("ball");
  ball.dispatchEvent(new h.win.MouseEvent("pointerdown", { button: 0, screenX: 100, screenY: 100, clientX: 10, clientY: 10 }));
  ball.dispatchEvent(new h.win.MouseEvent("pointermove", { buttons: 1, screenX: 103, screenY: 100 }));
  expect(h.api.moveFloatingBall).not.toHaveBeenCalled();
  ball.dispatchEvent(new h.win.MouseEvent("pointermove", { buttons: 1, screenX: 110, screenY: 100 }));
  await expect.poll(() => h.api.moveFloatingBall.mock.calls.length).toBeGreaterThan(0);
  h.api.clampFloatingBall.mockResolvedValueOnce({ expanded: false, horizontal: "left", vertical: "up", docked: "left" });
  ball.dispatchEvent(new h.win.MouseEvent("pointerup", { button: 0, screenX: 110, screenY: 100 }));
  await expect.poll(() => h.document.body.classList.contains("docked-left")).toBe(true);
  expect(h.byId("dock-tab").hidden).toBe(false);
});

it("follows theme changes and removes the selected-text chip through the host", async () => {
  const h = harness();
  await expect.poll(() => h.byId("composer").hidden).toBe(false);
  h.setDark(true);
  expect(h.document.documentElement.hasAttribute("data-ds-dark-theme")).toBe(true);
  expect(h.document.documentElement.style.colorScheme).toBe("dark");
  h.select({ text: "Selected text", sourceLabel: "Editor" });
  expect(h.byId("selection-chip").hidden).toBe(false);
  expect(h.document.body.classList.contains("has-selection-chip")).toBe(true);
  h.byId("selection-chip-dismiss").click();
  await expect.poll(() => h.api.clearSelectionContext.mock.calls.length).toBe(1);
  expect(h.byId("selection-chip").hidden).toBe(true);
});
