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
  Object.defineProperty(win, "matchMedia", { value: () => ({ matches: false, addEventListener: vi.fn() }) });
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
      actionsUsed: 0,
      actionLimit: 20,
      scope: null as string | null,
      target: null as null | { windowId: string; title: string; appName: string },
      stoppedReason: null as string | null,
    },
  };
  let onEvent: (event: Record<string, unknown>) => void = () => {};
  let onSelection: (value: unknown) => void = () => {};
  let onDoubleAlt: () => void = () => {};
  const api = {
    getStatus: vi.fn(async () => status),
    getSelectionContext: vi.fn(async () => null),
    onSessionEvent: vi.fn((listener: typeof onEvent) => { onEvent = listener; return () => {}; }),
    onSelectionContext: vi.fn((listener: typeof onSelection) => { onSelection = listener; return () => {}; }),
    onDoubleAltGesture: vi.fn((listener: typeof onDoubleAlt) => { onDoubleAlt = listener; return () => {}; }),
    setFloatingExpanded: vi.fn(async (expanded: boolean) => ({ expanded, horizontal: "left", vertical: "up", docked: undefined })),
    moveFloatingBall: vi.fn(async () => ({ expanded: false, horizontal: "left", vertical: "up", docked: undefined })),
    clampFloatingBall: vi.fn(async () => ({ expanded: false, horizontal: "left", vertical: "up", docked: undefined })),
    unsnapFloatingBall: vi.fn(async () => ({ expanded: false, horizontal: "left", vertical: "up", docked: undefined })),
    chooseWorkspace: vi.fn(async () => ({ ok: true, resolved: "C:\\orb" })),
    setWorkspace: vi.fn(async () => { status = { ...status, configured: true }; return status; }),
    ensureSession: vi.fn(async () => "session-1"),
    sendPrompt: vi.fn(async () => {}),
    clearSelectionContext: vi.fn(async () => true),
    abort: vi.fn(async () => {}),
    newConversation: vi.fn(async () => "session-2"),
    listSessionHistory: vi.fn(async () => ({ ok: true, sessions: [{ sessionId: "session-old", name: "Earlier", firstMessage: "Earlier", modified: "2026-09-30T00:00:00Z", messageCount: 2 }] })),
    openSessionHistory: vi.fn(async () => ({ ok: true, sessionId: "session-old", messages: [{ role: "user", text: "Old question" }, { role: "assistant", text: "Old answer" }] })),
    listDesktopWindows: vi.fn(async () => ({ ok: true, windows: [{ windowId: "7", title: "Editor", appName: "Code" }] })),
    setDesktopTarget: vi.fn(async () => { status.desktopTask.target = { windowId: "7", title: "Editor", appName: "Code" }; return { ok: true }; }),
    getDesktopTaskStatus: vi.fn(async () => status.desktopTask),
    authorizeDesktopTask: vi.fn(async ({ scope }: { scope: string }) => { status.desktopTask.authorized = true; status.desktopTask.scope = scope; return status.desktopTask; }),
    revokeDesktopTask: vi.fn(async () => { status.desktopTask.authorized = false; return status.desktopTask; }),
    captureScreenshot: vi.fn(async () => ({ ok: true, observationId: "observation-1", mimeType: "image/png", data: "iVBORw0KGgo=", width: 2, height: 2, bytes: 12, targetDescription: "Editor", targetStale: false })),
    resolveScreenshot: vi.fn(async () => ({ ok: true, sent: true })),
    exportScreenshot: vi.fn(async () => ({ ok: true, path: "C:\\capture.png", clipboard: true })),
    discardScreenshot: vi.fn(async () => true),
    setShortcut: vi.fn(async () => status),
    openShellMenu: vi.fn(async () => true),
    listModels: vi.fn(async () => ({ ok: true, models: [{ provider: "test", id: "one", name: "One", input: ["text"] }], selected: null })),
    setModel: vi.fn(async () => ({ ok: true, selected: { provider: "test", id: "one" } })),
    respondQuestion: vi.fn(async () => {}),
  };
  Object.defineProperty(win, "orb", { value: api });
  runInContext(script, dom.getInternalVMContext());
  const document = win.document;
  const byId = (id: string) => document.getElementById(id)!;
  return { dom, win, document, byId, api, emit: (event: Record<string, unknown>) => onEvent(event), select: (value: unknown) => onSelection(value), doubleAlt: () => onDoubleAlt() };
}

afterEach(() => { for (const dom of openDoms.splice(0)) dom.window.close(); });

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

it("keeps desktop approval and screenshot confirmation explicit", async () => {
  const h = harness();
  await expect.poll(() => h.byId("composer").hidden).toBe(false);
  h.byId("access-open").click();
  expect(h.byId("access-sheet").hidden).toBe(false);
  h.byId("target-open").click();
  await expect.poll(() => h.document.querySelectorAll("#target-list button").length).toBe(1);
  (h.document.querySelector("#target-list button") as HTMLElement).click();
  await expect.poll(() => h.byId("access-target").textContent).toContain("Editor");
  (h.byId("task-scope") as HTMLInputElement).value = "Edit this window";
  h.byId("authorize-form").dispatchEvent(new h.win.Event("submit", { bubbles: true, cancelable: true }));
  await expect.poll(() => h.api.authorizeDesktopTask.mock.calls.length).toBe(1);
  expect(h.byId("permission-label").textContent).toBe("Desktop access");
  h.byId("access-close").click();
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
  expect(h.document.querySelector(".orb-tool p")?.textContent).toBe("Completed");
  h.emit({ type: "question", id: "ask-1", method: "select", title: "Choose", message: "Pick one", options: ["First (Recommended)", "Second"], prefill: "" });
  expect(h.byId("question").hidden).toBe(false);
  expect(h.document.querySelector(".question-recommended")?.textContent).toBe("Recommended");
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
  h.byId("model-open").click();
  await expect.poll(() => h.document.querySelectorAll("#model-list button").length).toBe(1);
  (h.document.querySelector("#model-list button") as HTMLElement).click();
  await expect.poll(() => h.api.setModel.mock.calls.length).toBe(1);
  expect(h.api.setModel).toHaveBeenCalledWith({ generation: 1, provider: "test", id: "one" });
});
