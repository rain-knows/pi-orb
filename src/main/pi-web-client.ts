/**
 * Minimal pi-web client adapter.
 *
 * Scope (see doc/pi-orb-development-goals.md §4.1 "pi-web 客户端适配"):
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

export interface PiWebEndpoints {
  readonly baseUrl: string;
  readonly password?: string;
}

export interface AgentState {
  readonly provider: string | null;
  readonly modelId: string | null;
  readonly thinkingLevel: string | null;
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

  async createSession(cwd: string): Promise<string> {
    const response = await this.#request("/api/agent/new", {
      method: "POST",
      body: JSON.stringify({ cwd, type: "ensure_session" }),
    });
    const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    const sessionId = body.sessionId;
    if (typeof sessionId !== "string" || sessionId.length === 0) {
      throw new PiWebError("pi-web did not return a session id.", response.status);
    }
    return sessionId;
  }

  async prompt(sessionId: string, text: string): Promise<void> {
    await this.#sessionCommand(sessionId, { type: "prompt", message: text });
  }

  async abort(sessionId: string): Promise<void> {
    await this.#sessionCommand(sessionId, { type: "abort" });
  }

  async getState(sessionId: string): Promise<AgentState> {
    const data = await this.#sessionCommand<{
      model?: { id?: string; provider?: string };
      thinkingLevel?: string;
    }>(sessionId, { type: "get_state" });
    return {
      provider: data.model?.provider ?? null,
      modelId: data.model?.id ?? null,
      thinkingLevel: data.thinkingLevel ?? null,
    };
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
