/**
 * Minimal pi-web client adapter.
 *
 * Scope (see doc/product-contract.md §4.1 "pi-web 客户端适配"):
 *  - only the documented HTTP/SSE surface is used,
 *  - credentials never leave the Electron main process,
 *  - no internal pi-web module, registry or React state is touched.
 *
 * Verified behaviour this adapter depends on (evidence/p0-03):
 *  - `POST /api/agent/new` accepts a `cwd` and returns the real session id,
 *  - `POST /api/agent/{id}` accepts prompt/abort/get_state,
 *  - SSE must be subscribed *before* the prompt, otherwise the turn is missed,
 *  - a sandboxed renderer with an opaque origin cannot call these routes at all
 *    (403), so every call here runs in the main process.
 */

const JSON_HEADERS = { "Content-Type": "application/json" } as const;

/**
 * Pi's image content block, as pi-web's `validateAgentImages` expects it on a
 * `prompt` command: `{ type: "image", data, mimeType }`.
 */
export interface ImageContent {
  readonly type: "image";
  readonly data: string;
  readonly mimeType: string;
}

export interface PiWebEndpoints {
  readonly baseUrl: string;
  readonly password?: string;
}

export interface AgentState {
  readonly provider: string | null;
  readonly modelId: string | null;
  readonly thinkingLevel: string | null;
  readonly running?: boolean;
}

export interface PiWebModelChoice {
  readonly provider: string;
  readonly id: string;
  readonly name: string;
  readonly input: readonly string[];
}

export type PiWebUiResponse =
  | { readonly id: string; readonly value: string }
  | { readonly id: string; readonly confirmed: boolean }
  | { readonly id: string; readonly cancelled: true };

export interface PiWebSessionSummary {
  readonly id: string;
  readonly cwd: string;
  readonly name?: string;
  readonly modified: string;
  readonly firstMessage: string;
  readonly messageCount: number;
}

export interface PiWebHistoryMessage {
  readonly role: "user" | "assistant";
  readonly text: string;
}

export class PiWebError extends Error {
  readonly status: number;
  readonly code?: string;
  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = "PiWebError";
    this.status = status;
    if (code !== undefined) this.code = code;
  }
}

export function normalizeBaseUrl(input: string): string {
  const url = new URL(input);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`Unsupported pi-web protocol: ${url.protocol}`);
  }
  return url.origin;
}

export class PiWebClient {
  readonly #endpoints: PiWebEndpoints;
  #sessionCookie: string | null = null;

  constructor(endpoints: PiWebEndpoints) {
    this.#endpoints = { ...endpoints, baseUrl: normalizeBaseUrl(endpoints.baseUrl) };
  }

  get baseUrl(): string {
    return this.#endpoints.baseUrl;
  }

  /**
   * Establish an authenticated session using pi-web's documented password
   * endpoint (`POST /api/web-auth`).
   *
   * The resulting session cookie stays in the main process and is never handed
   * to the renderer (see evidence/p0-05/DECISION.md §2). When pi-web runs
   * without a password the endpoint answers 404 and there is nothing to do.
   */
  async authenticate(): Promise<void> {
    const response = await fetch(new URL("/api/web-auth", this.#endpoints.baseUrl), {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({ password: this.#endpoints.password ?? "" }),
    });
    if (response.status === 404) return; // password authentication is disabled
    if (response.status === 429) {
      throw new PiWebError(
        "pi-web is temporarily throttling password attempts; retry later.",
        429,
      );
    }
    if (!response.ok) {
      throw new PiWebError(
        `pi-web authentication failed (HTTP ${response.status}).`,
        response.status,
      );
    }
    const session = readSessionCookie(response.headers);
    if (session) this.#sessionCookie = session;
  }

  /**
   * Probe whether a pi-web service answers at the configured URL.
   *
   * Any HTTP response means the service is up, including `401`/`403`: an
   * authentication failure is a different problem from "nothing is listening",
   * and conflating them would tell the user to start a service that is already
   * running.
   */
  async probeService(): Promise<boolean> {
    try {
      await fetch(new URL("/api/web-auth", this.#endpoints.baseUrl), {
        method: "GET",
      });
      return true;
    } catch {
      return false;
    }
  }

  async createSession(cwd: string, options?: { toolNames?: readonly string[]; provider?: string; modelId?: string; thinkingLevel?: string }): Promise<string> {
    const response = await this.#request("/api/agent/new", {
      method: "POST",
      body: JSON.stringify({ cwd, type: "ensure_session", ...options }),
    });
    const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    const sessionId = body.sessionId;
    if (typeof sessionId !== "string" || sessionId.length === 0) {
      const detail = typeof body.error === "string" && body.error.trim().length > 0
        ? body.error
        : "pi-web did not return a session id.";
      throw new PiWebError(detail, response.status, typeof body.code === "string" ? body.code : undefined);
    }
    return sessionId;
  }

  async listSessions(): Promise<readonly PiWebSessionSummary[]> {
    const response = await this.#request("/api/sessions?summary=1", { method: "GET" });
    if (!response.ok) throw new PiWebError("Could not load pi-web session history.", response.status);
    const body = (await response.json().catch(() => ({}))) as { sessions?: unknown };
    if (!Array.isArray(body.sessions)) return [];
    return body.sessions.flatMap((value) => parseSessionSummary(value));
  }

  async getSessionHistory(sessionId: string): Promise<{ readonly cwd: string; readonly messages: readonly PiWebHistoryMessage[] }> {
    const response = await this.#request(`/api/sessions/${encodeURIComponent(sessionId)}?tail=80`, { method: "GET" });
    const body = (await response.json().catch(() => ({}))) as { info?: unknown; context?: unknown; error?: string };
    if (!response.ok || typeof body.info !== "object" || body.info === null) {
      throw new PiWebError(body.error ?? "Could not load the selected pi-web session.", response.status);
    }
    const info = body.info as Record<string, unknown>;
    const cwd = typeof info.cwd === "string" ? info.cwd : "";
    const context = typeof body.context === "object" && body.context !== null ? body.context as Record<string, unknown> : {};
    const messages = Array.isArray(context.messages) ? context.messages.flatMap((value) => parseHistoryMessage(value)) : [];
    return { cwd, messages };
  }

  async prompt(sessionId: string, text: string, images?: readonly ImageContent[], cwd?: string): Promise<void> {
    if (images && images.length > 0) {
      if (!cwd) throw new Error("The Orb workspace is unknown. The screenshot was not sent.");
      await this.#requireImageModel(sessionId, cwd);
    }
    await this.#sessionCommand(sessionId, {
      type: "prompt",
      message: text,
      ...(images && images.length > 0 ? { images } : {}),
    });
  }

  /** Check the selected session model against pi-web's own model list before uploading pixels. */
  async #requireImageModel(sessionId: string, cwd: string): Promise<void> {
    const selected = await this.getState(sessionId);
    if (!selected.provider || !selected.modelId) {
      throw new Error("The current model could not be identified. The screenshot was not sent.");
    }
    const models = await this.listModels(cwd);
    const model = models.find(
      (candidate) => candidate.provider === selected.provider && candidate.id === selected.modelId,
    );
    if (!model) {
      throw new Error("The current model is missing from pi-web's model list. The screenshot was not sent.");
    }
    if (!model.input?.includes("image")) {
      throw new Error("The current model does not support image input. Choose an image-capable model before sending the screenshot.");
    }
  }

  async abort(sessionId: string): Promise<void> {
    await this.#sessionCommand(sessionId, { type: "abort" });
  }

  async queuePrompt(sessionId: string, text: string): Promise<void> {
    await this.#sessionCommand(sessionId, { type: "prompt", message: text, streamingBehavior: "followUp" });
  }

  async clearQueue(sessionId: string): Promise<void> {
    await this.#sessionCommand(sessionId, { type: "clear_queue" });
  }

  async setSessionName(sessionId: string, name: string): Promise<void> {
    await this.#sessionCommand(sessionId, { type: "set_session_name", name });
  }

  async lastAssistantOutcome(sessionId: string): Promise<{ text: string; error: string | null; userStopped: boolean }> {
    // Pi Web's command adapter does not expose the SDK's get_messages command.
    // Read its public history response, with a bounded tail and deferred media.
    const response = await this.#request(`/api/sessions/${encodeURIComponent(sessionId)}?tail=1&tree=summary&deferThinking=1&deferMedia=1`, { method: "GET" });
    const result = await response.json() as { error?: string; context?: { messages?: { role: string; stopReason?: string; errorMessage?: string; content?: { type: string; text?: string }[] }[] } };
    if (!response.ok || !Array.isArray(result.context?.messages)) throw new PiWebError(result.error ?? "Could not read the background session outcome.", response.status);
    const message = result.context.messages.findLast(item => item.role === "assistant");
    const text = message?.content?.filter(block => block.type === "text").map(block => block.text ?? "").join("\n") ?? "";
    const error = message?.stopReason === "error" || message?.stopReason === "aborted"
      ? message.errorMessage || `Background prompt ${message.stopReason}.`
      : null;
    return { text, error, userStopped: message?.stopReason === "aborted" };
  }

  async getState(sessionId: string): Promise<AgentState> {
    const data = await this.#sessionCommand<{
      model?: { id?: string; provider?: string };
      thinkingLevel?: string;
      isStreaming?: boolean;
      isPromptRunning?: boolean;
      isBashRunning?: boolean;
    }>(sessionId, { type: "get_state" });
    return {
      provider: data.model?.provider ?? null,
      modelId: data.model?.id ?? null,
      thinkingLevel: data.thinkingLevel ?? null,
      running: data.isStreaming === true || data.isPromptRunning === true || data.isBashRunning === true,
    };
  }

  async listModels(cwd: string): Promise<readonly PiWebModelChoice[]> {
    const response = await this.#request(`/api/models?cwd=${encodeURIComponent(cwd)}`, { method: "GET" });
    if (!response.ok) throw new PiWebError("Could not load Pi Web models.", response.status);
    const body = (await response.json().catch(() => ({}))) as { modelList?: unknown };
    if (!Array.isArray(body.modelList)) return [];
    return body.modelList.flatMap((value): PiWebModelChoice[] => {
      if (typeof value !== "object" || value === null) return [];
      const item = value as Record<string, unknown>;
      if (typeof item.provider !== "string" || typeof item.id !== "string") return [];
      return [{
        provider: item.provider,
        id: item.id,
        name: typeof item.name === "string" ? item.name : item.id,
        input: Array.isArray(item.input) ? item.input.filter((part): part is string => typeof part === "string") : [],
      }];
    });
  }

  async setModel(sessionId: string, provider: string, modelId: string): Promise<AgentState> {
    await this.#sessionCommand(sessionId, { type: "set_model", provider, modelId });
    return this.getState(sessionId);
  }

  async respondToExtensionUi(sessionId: string, response: PiWebUiResponse): Promise<void> {
    await this.#sessionCommand(sessionId, { type: "extension_ui_response", ...response });
  }

  /**
   * Open the SSE event stream for a session.
   *
   * Returns an abort function. Callers must subscribe before prompting.
   */
  async openEventStream(
    sessionId: string,
    onEvent: (event: unknown) => void,
    onError: (error: Error) => void,
  ): Promise<() => void> {
    const controller = new AbortController();
    const url = new URL(
      `/api/agent/${encodeURIComponent(sessionId)}/events`,
      this.#endpoints.baseUrl,
    );
    let response: Response;
    try {
      response = await fetch(url, {
        headers: this.#authHeaders({ Accept: "text/event-stream" }),
        signal: controller.signal,
      });
    } catch (error) {
      onError(error instanceof Error ? error : new Error(String(error)));
      return () => controller.abort();
    }
    if (!response.ok || !response.body) {
      onError(new PiWebError("Could not open the event stream.", response.status));
      return () => controller.abort();
    }

    void consumeSse(response.body, onEvent, onError, controller.signal);
    return () => controller.abort();
  }

  async #sessionCommand<T = unknown>(
    sessionId: string,
    command: Record<string, unknown>,
  ): Promise<T> {
    const response = await this.#request(
      `/api/agent/${encodeURIComponent(sessionId)}`,
      { method: "POST", body: JSON.stringify(command) },
    );
    const body = (await response.json().catch(() => ({}))) as {
      success?: boolean;
      data?: T;
      error?: string;
      code?: string;
    };
    if (!response.ok || body.error) {
      throw new PiWebError(
        body.error ?? `HTTP ${response.status}`,
        response.status,
        body.code,
      );
    }
    return body.data as T;
  }

  /**
   * The session cookie captured by `authenticate`, for tests and diagnostics.
   * Never expose this to a renderer.
   */
  get sessionCookie(): string | null {
    return this.#sessionCookie;
  }

  async #request(path: string, init: RequestInit): Promise<Response> {
    const headers = this.#authHeaders(
      init.method === "POST" ? JSON_HEADERS : {},
    );
    const response = await fetch(new URL(path, this.#endpoints.baseUrl), {
      ...init,
      headers: { ...headers, ...(init.headers as Record<string, string> | undefined) },
    });
    if (response.status === 401) {
      throw new PiWebError(
        "pi-web rejected the request: authentication required.",
        401,
      );
    }
    if (response.status === 403) {
      throw new PiWebError("pi-web rejected the request origin.", 403);
    }
    return response;
  }

  #authHeaders(base: Record<string, string>): Record<string, string> {
    const headers: Record<string, string> = { ...base };
    if (this.#sessionCookie) {
      headers.Cookie = this.#sessionCookie;
    } else if (this.#endpoints.password) {
      const credentials = Buffer.from(`pi:${this.#endpoints.password}`, "utf8").toString(
        "base64",
      );
      headers.Authorization = `Basic ${credentials}`;
    }
    return headers;
  }
}

function parseSessionSummary(value: unknown): PiWebSessionSummary[] {
  if (typeof value !== "object" || value === null) return [];
  const record = value as Record<string, unknown>;
  if (typeof record.id !== "string" || typeof record.cwd !== "string" || typeof record.modified !== "string") return [];
  return [{
    id: record.id,
    cwd: record.cwd,
    ...(typeof record.name === "string" ? { name: record.name } : {}),
    modified: record.modified,
    firstMessage: typeof record.firstMessage === "string" ? record.firstMessage : "(no messages)",
    messageCount: typeof record.messageCount === "number" && Number.isFinite(record.messageCount) ? record.messageCount : 0,
  }];
}

function parseHistoryMessage(value: unknown): PiWebHistoryMessage[] {
  if (typeof value !== "object" || value === null) return [];
  const record = value as Record<string, unknown>;
  if (record.role !== "user" && record.role !== "assistant") return [];
  const content = record.content;
  const text = typeof content === "string"
    ? content
    : Array.isArray(content)
      ? content.map((part) => typeof part === "object" && part !== null && typeof (part as { text?: unknown }).text === "string" ? (part as { text: string }).text : "").join("")
      : "";
  return text.length > 0 ? [{ role: record.role, text }] : [];
}

/**
 * Parse an SSE byte stream into event payloads.
 *
 * Only the `data:` fields matter here; event names are ignored because the
 * payload already carries its own `type` discriminator.
 */
export async function consumeSse(
  stream: ReadableStream<Uint8Array>,
  onEvent: (event: unknown) => void,
  onError: (error: Error) => void,
  signal?: AbortSignal,
): Promise<void> {
  const decoder = new TextDecoder();
  let buffer = "";
  const reader = stream.getReader();
  try {
    for (;;) {
      if (signal?.aborted) break;
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let separator = findEventSeparator(buffer);
      while (separator !== -1) {
        const rawEvent = buffer.slice(0, separator.index);
        buffer = buffer.slice(separator.index + separator.length);
        const payload = extractData(rawEvent);
        if (payload !== null) {
          try {
            onEvent(JSON.parse(payload));
          } catch {
            // A partial or non-JSON frame is ignored rather than killing the
            // stream; the next frame is still processed.
          }
        }
        separator = findEventSeparator(buffer);
      }
    }
  } catch (error) {
    if (!signal?.aborted) {
      onError(error instanceof Error ? error : new Error(String(error)));
    }
  } finally {
    reader.releaseLock();
  }
}

function findEventSeparator(buffer: string): { index: number; length: number } | -1 {
  const lf = buffer.indexOf("\n\n");
  const crlf = buffer.indexOf("\r\n\r\n");
  if (lf === -1 && crlf === -1) return -1;
  if (crlf !== -1 && (lf === -1 || crlf < lf)) return { index: crlf, length: 4 };
  return { index: lf, length: 2 };
}

/**
 * Read the pi-web session cookie from a response without depending on an
 * experimental Node/undici API surface; `set-cookie` is available directly.
 */export function readSessionCookie(headers: Headers): string | null {
  const raw = headers.get("set-cookie");
  if (!raw) return null;
  for (const part of raw.split(/,(?=[^;=]+=[^;]*)/)) {
    const pair = part.split(";", 1)[0]?.trim() ?? "";
    if (pair.startsWith("pi_web_session=")) return pair;
  }
  return null;
}

function extractData(rawEvent: string): string | null {
  const lines = rawEvent.split(/\r?\n/);
  const dataLines = lines
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trimStart());
  if (dataLines.length === 0) return null;
  const payload = dataLines.join("\n");
  return payload.length > 0 ? payload : null;
}
