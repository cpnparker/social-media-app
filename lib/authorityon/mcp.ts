/**
 * AuthorityOn's MCP server, called server-side with one platform key.
 *
 * ── WHY THIS FILE EXISTS RATHER THAN THE MESSAGES API MCP CONNECTOR ─────────
 *
 * Anthropic's Messages API can attach an MCP server directly (`mcp_servers` +
 * `mcp_toolset`), and Claude then calls its tools inside the request with no
 * tool-execution loop on our side. That was the first plan, and it is the
 * wrong shape for THIS app, for three reasons that all have the same root:
 * the results never pass through our code.
 *
 *   1. The post-taint policy blocks tools by NAME, in providers.ts, and
 *      scripts/verify-post-taint-policy.ts fails the build on any registered
 *      tool nobody classified. Connector tools have no name there — Anthropic
 *      resolves them server-side — so they would be neither classified nor
 *      blocked, and the guard would stay green while an unclassified tool
 *      surface existed.
 *   2. AuthorityOn returns SCRAPED THIRD-PARTY TEXT: verbatim AI answers about
 *      a brand, earned media, citations, stories. That is attacker-influenced
 *      content — anyone who wants EngineAI to act need only get the words onto
 *      a page AuthorityOn reads. `fenceUntrusted` and the taint flag are how
 *      this app already handles exactly that shape, and neither can run on
 *      content that never enters our process.
 *   3. The connector is Anthropic-only. The auto-router sends most traffic to
 *      Grok, so "every Engine AI user" would have been false on day one.
 *
 * Calling it ourselves fixes all three at once: the tools get a name the
 * policy can see, their results get fenced, and every chain can use them.
 *
 * ── WHY NOT @modelcontextprotocol/sdk ──────────────────────────────────────
 *
 * A DELIBERATE DEVIATION from the integration plan, which said not to
 * hand-roll JSON-RPC. The plan was written before reading this repo. The
 * server is stateless Streamable HTTP: every POST is one complete JSON-RPC
 * exchange, there is no session to keep alive, no reconnection, no server
 * notifications — none of the machinery the SDK's transport exists to manage.
 * We use exactly two methods. Against that, adding a dependency means editing
 * package.json in a working tree shared with other sessions, and a new
 * transitive surface in a Next.js bundle.
 *
 * If AuthorityOn ever ships a stateful transport, elicitation, or server-sent
 * notifications, this becomes the wrong call and the SDK becomes right. That
 * is the trigger to watch for, and it is why the framing below is kept honest
 * rather than clever.
 */

/** Where AuthorityOn lives. Overridable for staging; never sent to a browser. */
const DEFAULT_URL = "https://www.authorityon.ai/api/mcp";

/** The protocol revision the server was built against. Sent on every request
 *  because the endpoint is stateless — there is no initialize handshake whose
 *  result we could remember. */
const PROTOCOL_VERSION = "2025-06-18";

/** Long enough for a report, short enough that a hung upstream does not eat
 *  the whole 300s function budget with nothing to show. */
const TIMEOUT_MS = 45_000;

export interface AuthorityOnResult {
  ok: boolean;
  /** The tool's text content, already joined. Fencing happens at the CALLER,
   *  in providers.ts, so this module stays a transport and the security
   *  decision lives beside the other security decisions. */
  text?: string;
  /** AuthorityOn's own structured payload, when it sent one. */
  data?: unknown;
  /** Set when the call could not be made or the server refused it. */
  error?: string;
  /**
   * Which KIND of failure, because two of them read identically to a user and
   * must not:
   *   - "auth"        the key is missing, revoked or expired — an operator
   *                   problem. The user is told the connection is unavailable,
   *                   NEVER that the brand does not exist.
   *   - "tool_error"  AuthorityOn answered, and its answer is a refusal
   *                   ("brand_not_found"). That is a normal reply to relay.
   *   - "transport"   network, timeout, or a malformed frame.
   *   - "disabled"    no key configured on this deployment.
   */
  kind?: "auth" | "tool_error" | "transport" | "disabled";
}

function config(): { url: string; key: string } | null {
  const key = (process.env.AUTHORITYON_MCP_KEY || "").trim();
  if (!key) return null;
  const url = (process.env.AUTHORITYON_MCP_URL || DEFAULT_URL).trim();
  return { url, key };
}

/** Whether this deployment can reach AuthorityOn at all. The tool is only
 *  registered when this is true, so the model is never offered a tool that
 *  can only fail. */
export function authorityOnEnabled(): boolean {
  return config() !== null;
}

/**
 * The SSE frame the server replies with, even for a single response.
 *
 * Streamable HTTP wraps the JSON-RPC reply as `event: message` followed by
 * `data: {json}`. A body can carry several frames and comment lines, so this
 * takes the LAST `data:` payload that parses as an object with a jsonrpc id —
 * taking the first would pick up a keep-alive or a progress notification and
 * report it as the answer.
 *
 * Exported so the check can drive it with real frames rather than a mock:
 * frame parsing is where a hand-written client earns its scepticism.
 */
export function parseSseEnvelope(body: string): any | null {
  const text = String(body || "");
  // A server that answers application/json rather than SSE is still valid.
  const direct = tryJson(text);
  if (direct && typeof direct === "object") return direct;

  let found: any = null;
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line.startsWith("data:")) continue;
    const payload = line.slice(5).trim();
    if (!payload || payload === "[DONE]") continue;
    const parsed = tryJson(payload);
    if (parsed && typeof parsed === "object" && "jsonrpc" in (parsed as any)) found = parsed;
  }
  return found;
}

function tryJson(s: string): unknown {
  try { return JSON.parse(s); } catch { return null; }
}

let nextId = 1;

async function rpc(method: string, params: unknown): Promise<AuthorityOnResult> {
  const cfg = config();
  if (!cfg) {
    return { ok: false, kind: "disabled", error: "AuthorityOn is not configured on this deployment." };
  }

  let res: Response;
  try {
    res = await fetch(cfg.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        // Both, because the server may answer either way.
        "Accept": "application/json, text/event-stream",
        "MCP-Protocol-Version": PROTOCOL_VERSION,
        "Authorization": `Bearer ${cfg.key}`,
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: nextId++, method, params }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (e: any) {
    const msg = e?.name === "TimeoutError" ? `timed out after ${TIMEOUT_MS / 1000}s` : (e?.message || "network error");
    console.warn(`[AuthorityOn] ${method} transport failure: ${msg}`);
    return { ok: false, kind: "transport", error: msg };
  }

  // 401 is the operator's problem, and the ONE failure a user must never see
  // described as "that brand isn't tracked". The server also advertises an
  // OAuth flow in WWW-Authenticate that is not built — do not follow it.
  if (res.status === 401 || res.status === 403) {
    console.error(`[AuthorityOn] ${res.status} — the platform key is missing, revoked or expired. OPERATOR ACTION REQUIRED.`);
    return { ok: false, kind: "auth", error: `AuthorityOn rejected our key (${res.status}).` };
  }
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    console.warn(`[AuthorityOn] ${method} HTTP ${res.status}: ${body.slice(0, 200)}`);
    return { ok: false, kind: "transport", error: `AuthorityOn returned HTTP ${res.status}.` };
  }

  const envelope = parseSseEnvelope(await res.text());
  if (!envelope) return { ok: false, kind: "transport", error: "AuthorityOn sent a reply we could not parse." };
  if (envelope.error) {
    return { ok: false, kind: "tool_error", error: String(envelope.error.message || envelope.error.code || "unknown error") };
  }
  return { ok: true, data: envelope.result };
}

/** The tool names AuthorityOn currently serves. Cached for the process: the
 *  list changes when AuthorityOn deploys, not per request. */
let toolsCache: { names: string[]; at: number } | null = null;
const TOOLS_TTL_MS = 15 * 60 * 1000;

export async function listAuthorityOnTools(force = false): Promise<string[]> {
  if (!force && toolsCache && Date.now() - toolsCache.at < TOOLS_TTL_MS) return toolsCache.names;
  const r = await rpc("tools/list", {});
  if (!r.ok) return toolsCache?.names ?? [];
  const tools = (r.data as any)?.tools;
  const names = Array.isArray(tools) ? tools.map((t: any) => String(t?.name || "")).filter(Boolean) : [];
  if (names.length) toolsCache = { names, at: Date.now() };
  return names;
}

/**
 * Call one AuthorityOn tool.
 *
 * A tool that ANSWERS with a refusal — `isError: true`, text like
 * "brand_not_found: coca-cola" — comes back as ok:false / kind:"tool_error",
 * which the caller relays in plain language. That is a different thing from
 * the connection being down, and conflating the two is how a working system
 * tells a user their brand does not exist.
 */
export async function callAuthorityOn(
  name: string,
  args: Record<string, unknown>
): Promise<AuthorityOnResult> {
  const started = Date.now();
  const r = await rpc("tools/call", { name, arguments: args || {} });
  const ms = Date.now() - started;

  if (!r.ok) {
    // Telemetry: tool, latency and outcome. No payloads, no key, no arguments
    // — arguments can carry a brand a user typed, and this line goes to a log
    // we do not treat as confidential.
    console.log(`[AuthorityOn] ${name} ${r.kind} ${ms}ms`);
    return r;
  }

  const result: any = r.data;
  const blocks = Array.isArray(result?.content) ? result.content : [];
  const text = blocks
    .filter((b: any) => b?.type === "text" && typeof b.text === "string")
    .map((b: any) => b.text)
    .join("\n")
    .trim();

  if (result?.isError) {
    console.log(`[AuthorityOn] ${name} tool_error ${ms}ms`);
    return { ok: false, kind: "tool_error", error: text || "AuthorityOn refused the call.", data: result };
  }

  console.log(`[AuthorityOn] ${name} ok ${ms}ms`);
  return { ok: true, text, data: result };
}
