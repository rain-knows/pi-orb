/** Browser adaptation: Microsoft's public Playwright MCP API owns DOM/CDP/extension transport.
 * The Orb only binds that connection to its existing session Access grant. No Pi engine changes.
 * Reference boundary: dsh-orb-cordis 9cdc503, packages/computer-use/src/plugin.ts.
 */
import { createConnection } from "@playwright/mcp";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { CallToolResultSchema } from "@modelcontextprotocol/sdk/types.js";
import type { BrokerStatus } from "./desktop-broker";

const allowedTools = new Set([
  "browser_snapshot", "browser_navigate", "browser_navigate_back", "browser_click", "browser_type",
  "browser_fill_form", "browser_press_key", "browser_hover", "browser_drag", "browser_select_option",
  "browser_tabs", "browser_wait_for",
]);

export class BrowserBroker {
  readonly #access: () => BrokerStatus | null;
  readonly #createServer: () => Promise<Server>;
  #client: Client | null = null;
  #opening: Promise<Client> | null = null;
  #epoch = 0;
  #executing = false;

  constructor(access: () => BrokerStatus | null, createServer = () => createConnection({ extension: true, webmcp: false, snapshot: { mode: "none" }, codegen: "none" })) {
    this.#access = access;
    this.#createServer = createServer;
  }

  revoke(): void {
    this.#epoch++;
    const client = this.#client;
    this.#client = null;
    this.#opening = null;
    void client?.close().catch(() => {});
  }

  #authorized(sessionId: string, generation: number): boolean {
    const access = this.#access();
    return access?.authorized === true && access.level === "full-access"
      && access.sessionId === sessionId && access.generation === generation;
  }

  async #connect(): Promise<Client> {
    if (this.#client) return this.#client;
    if (this.#opening) return this.#opening;
    const epoch = this.#epoch;
    const opening = (async () => {
      const server = await this.#createServer();
      const client = new Client({ name: "pi-orb", version: "0.1.0" });
      const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
      try {
        await server.connect(serverTransport);
        await client.connect(clientTransport);
        if (this.#epoch !== epoch) throw new Error("Browser connection was revoked while opening.");
        this.#client = client;
        return client;
      } catch (error) {
        await Promise.allSettled([client.close(), server.close()]);
        throw error;
      }
    })();
    this.#opening = opening;
    try { return await opening; }
    finally { if (this.#opening === opening) this.#opening = null; }
  }

  async call(value: unknown, sessionId: string, generation: number, signal?: AbortSignal): Promise<unknown> {
    if (!this.#authorized(sessionId, generation)) return { ok: false, reason: "no-task-authorization", message: "Browser tools require Full Access for this Orb session." };
    const request = value as { name?: unknown; arguments?: unknown } | null;
    if (!request || typeof request.name !== "string" || (request.name !== "tools" && !allowedTools.has(request.name))
      || (request.arguments !== undefined && (!request.arguments || typeof request.arguments !== "object" || Array.isArray(request.arguments)))) {
      return { ok: false, reason: "malformed", message: "Use tools to discover the supported browser commands and their schemas." };
    }
    if (this.#executing) return { ok: false, reason: "busy", message: "Another browser command is running." };
    if (signal?.aborted) return { ok: false, reason: "cancelled", message: "Browser request cancelled." };
    this.#executing = true;
    const epoch = this.#epoch;
    const cancel = () => this.revoke();
    signal?.addEventListener("abort", cancel, { once: true });
    try {
      const client = await this.#connect();
      if (signal?.aborted || this.#epoch !== epoch || !this.#authorized(sessionId, generation)) throw new Error("Browser Access was revoked.");
      if (request.name === "tools") {
        const { tools } = await client.listTools();
        return { ok: true, tools: tools.filter(t => allowedTools.has(t.name)), connection: "Playwright extension in existing Chrome; first action opens its tab selection page." };
      }
      const result = CallToolResultSchema.parse(await client.callTool({ name: request.name, arguments: request.arguments as Record<string, unknown> | undefined }, undefined, { signal, timeout: 90_000 }));
      // MCP 0.0.83 puts automatic snapshots in local files. Pi runs in another process: return
      // one explicit inline snapshot after each successful action instead of a dead file link or
      // requiring another model round trip. Automatic file snapshots are disabled above.
      const snapshot = !result.isError && request.name !== "browser_snapshot"
        ? CallToolResultSchema.parse(await client.callTool({ name: "browser_snapshot", arguments: {} }, undefined, { signal, timeout: 15_000 })) : null;
      if (this.#epoch !== epoch || !this.#authorized(sessionId, generation)) throw new Error("Browser Access was revoked.");
      const failed = result.isError || snapshot?.isError;
      return { ok: !failed, reason: failed ? "browser-error" : undefined, content: [...result.content, ...(snapshot?.content ?? [])] };
    } catch (error) {
      const cancelled = signal?.aborted || this.#epoch !== epoch;
      this.revoke();
      return { ok: false, reason: cancelled ? "cancelled" : "browser-error", message: error instanceof Error ? error.message : String(error) };
    } finally {
      signal?.removeEventListener("abort", cancel);
      this.#executing = false;
    }
  }
}
