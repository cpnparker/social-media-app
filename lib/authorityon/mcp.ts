/**
 * AuthorityOn's MCP server, called server-side with one platform key per
 * organisation.
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
 *
 * ── ONE KEY IS ONE ORGANISATION, SO THERE CAN BE SEVERAL KEYS ──────────────
 *
 * Read from the platform's own code (apps/web/lib/partner/caller.ts): a key
 * resolves to exactly one organisation, a brand belongs to exactly one, and
 * no tool takes an organisation argument. The first key minted was for The
 * Content Engine's organisation and its seventeen brands. The Siemens
 * engagement — the Infrastructure Transition Monitor audit, six frozen
 * reports — lives in a separate "Siemens" organisation created on
 * 2026-08-17, and the platform answers `brand_not_found` for it, because from
 * that key's side it does not exist. A key cannot be widened.
 *
 * So this module holds a LIST of keys — AUTHORITYON_MCP_KEY, then
 * AUTHORITYON_MCP_KEY_2 … _9, each with an optional _LABEL — and routes:
 *
 *   - list_brands fans out to every key and unions the result, each brand
 *     carrying the organisation it came from.
 *   - A brand-taking tool goes to the key whose organisation lists that
 *     brand. The route table is built from list_brands (sub-entities
 *     included, because a tracked report or programme is a sub-entity of its
 *     parent brand) and rebuilt once on a miss; a brand still unknown after
 *     that is tried against every key in turn, because the platform resolves
 *     by slug things list_brands does not list.
 *   - get_audit_report carries a report id and no brand, so it is tried
 *     against every key until one has the row.
 *   - get_plan_and_usage is per organisation, so it fans out and labels.
 *
 * With one key configured none of this costs a request: the routing is
 * skipped and the call goes straight through, as before.
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

/** How many numbered keys are looked for. Nine organisations is far above
 *  anything real; the bound exists so the env scan has an end. */
const MAX_KEYS = 9;

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
  /** Which organisation answered, when there is more than one to choose from. */
  organisation?: string;
}

/** One platform key and the organisation it stands for. The label is what a
 *  user sees ("Siemens"); the index is what the operator alert names, so a
 *  rejected key can be identified without its value ever being written. */
interface KeySlot {
  index: number;
  key: string;
  label: string;
}

function keySlots(): KeySlot[] {
  const out: KeySlot[] = [];
  const first = (process.env.AUTHORITYON_MCP_KEY || "").trim();
  if (first) {
    out.push({ index: 1, key: first, label: (process.env.AUTHORITYON_MCP_KEY_LABEL || "").trim() || "organisation 1" });
  }
  for (let n = 2; n <= MAX_KEYS; n++) {
    const k = (process.env[`AUTHORITYON_MCP_KEY_${n}`] || "").trim();
    if (!k) continue;
    out.push({ index: n, key: k, label: (process.env[`AUTHORITYON_MCP_KEY_${n}_LABEL`] || "").trim() || `organisation ${n}` });
  }
  return out;
}

function baseUrl(): string {
  return (process.env.AUTHORITYON_MCP_URL || DEFAULT_URL).trim();
}

/** Whether this deployment can reach AuthorityOn at all. The tool is only
 *  registered when this is true, so the model is never offered a tool that
 *  can only fail. */
export function authorityOnEnabled(): boolean {
  return keySlots().length > 0;
}

/** How many organisations this deployment holds a key for, and their labels
 *  in slot order. Surfaced to the model so "not tracked" can say where it
 *  looked. */
export function authorityOnOrganisations(): string[] {
  return keySlots().map((s) => s.label);
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

/** One alert a minute per key, however many calls fail. A revoked key fails
 *  every call in every turn, and an alert that fires a hundred times is an
 *  alert somebody turns off. */
const lastAlertAt = new Map<number, number>();
const ALERT_INTERVAL_MS = 60_000;
function alertOperatorOnce(slot: KeySlot, message: string): void {
  const now = Date.now();
  if (now - (lastAlertAt.get(slot.index) || 0) < ALERT_INTERVAL_MS) return;
  lastAlertAt.set(slot.index, now);
  console.error(`[AuthorityOn][OPERATOR] ${message}`);
}

async function rpc(method: string, params: unknown, slot: KeySlot): Promise<AuthorityOnResult> {
  let res: Response;
  try {
    res = await fetch(baseUrl(), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        // Both, because the server may answer either way.
        "Accept": "application/json, text/event-stream",
        "MCP-Protocol-Version": PROTOCOL_VERSION,
        "Authorization": `Bearer ${slot.key}`,
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: nextId++, method, params }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (e: any) {
    const msg = e?.name === "TimeoutError" ? `timed out after ${TIMEOUT_MS / 1000}s` : (e?.message || "network error");
    console.warn(`[AuthorityOn] ${method} transport failure (key #${slot.index}): ${msg}`);
    return { ok: false, kind: "transport", error: msg, organisation: slot.label };
  }

  // 401 is the operator's problem, and the ONE failure a user must never see
  // described as "that brand isn't tracked". The server also advertises an
  // OAuth flow in WWW-Authenticate that is not built — do not follow it.
  if (res.status === 401 || res.status === 403) {
    // OPERATOR ALERT. Logged at error level with a stable, greppable prefix so
    // it can be alerted on in Vercel's log drain, and rate-limited to one line
    // a minute per key. The user-facing half of this is in
    // formatAuthorityOnResult, which is careful never to let a dead key read
    // as a fact about the brand.
    alertOperatorOnce(slot, `AUTHORITYON_KEY_REJECTED key=#${slot.index} (${slot.label}) status=${res.status} — the platform key is missing, revoked or expired. Mint a new one and set AUTHORITYON_MCP_KEY${slot.index === 1 ? "" : `_${slot.index}`}.`);
    return { ok: false, kind: "auth", error: `AuthorityOn rejected our key for ${slot.label} (${res.status}).`, organisation: slot.label };
  }
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    console.warn(`[AuthorityOn] ${method} HTTP ${res.status} (key #${slot.index}): ${body.slice(0, 200)}`);
    return { ok: false, kind: "transport", error: `AuthorityOn returned HTTP ${res.status}.`, organisation: slot.label };
  }

  const envelope = parseSseEnvelope(await res.text());
  if (!envelope) return { ok: false, kind: "transport", error: "AuthorityOn sent a reply we could not parse.", organisation: slot.label };
  if (envelope.error) {
    return { ok: false, kind: "tool_error", error: String(envelope.error.message || envelope.error.code || "unknown error"), organisation: slot.label };
  }
  return { ok: true, data: envelope.result, organisation: slot.label };
}

/** The tool names AuthorityOn currently serves. Cached for the process: the
 *  list changes when AuthorityOn deploys, not per request. Every organisation
 *  sees the same tools, so the first key is asked. */
let toolsCache: { names: string[]; at: number } | null = null;
const TOOLS_TTL_MS = 15 * 60 * 1000;

export async function listAuthorityOnTools(force = false): Promise<string[]> {
  if (!force && toolsCache && Date.now() - toolsCache.at < TOOLS_TTL_MS) return toolsCache.names;
  const slots = keySlots();
  if (!slots.length) return [];
  const r = await rpc("tools/list", {}, slots[0]);
  if (!r.ok) return toolsCache?.names ?? [];
  const tools = (r.data as any)?.tools;
  const names = Array.isArray(tools) ? tools.map((t: any) => String(t?.name || "")).filter(Boolean) : [];
  if (names.length) toolsCache = { names, at: Date.now() };
  return names;
}

/** One tool call against one organisation, with the result's text joined. */
async function callOne(name: string, args: Record<string, unknown>, slot: KeySlot): Promise<AuthorityOnResult> {
  const r = await rpc("tools/call", { name, arguments: args || {} }, slot);
  if (!r.ok) return r;
  const result: any = r.data;
  const blocks = Array.isArray(result?.content) ? result.content : [];
  const text = blocks
    .filter((b: any) => b?.type === "text" && typeof b.text === "string")
    .map((b: any) => b.text)
    .join("\n")
    .trim();
  if (result?.isError) {
    return { ok: false, kind: "tool_error", error: text || "AuthorityOn refused the call.", data: result, organisation: slot.label };
  }
  return { ok: true, text, data: result, organisation: slot.label };
}

/** Whether a tool_error is the platform saying "no such brand here" — the one
 *  refusal that means "ask the next organisation" rather than "stop". */
function isBrandNotFound(r: AuthorityOnResult): boolean {
  return !r.ok && r.kind === "tool_error" && /brand_not_found|not_found/i.test(String(r.error || ""));
}

/** The structured payload a tool put in its text block, when it is JSON. */
function payloadOf(r: AuthorityOnResult): any {
  const parsed = r.text ? tryJson(r.text) : null;
  if (parsed && typeof parsed === "object") return parsed;
  const sc = (r.data as any)?.structuredContent;
  return sc && typeof sc === "object" ? sc : null;
}

/** The array a listing tool returned, whatever it called it. */
function listOf(payload: any): { field: string; rows: any[] } | null {
  if (!payload || typeof payload !== "object") return null;
  if (Array.isArray(payload.brands)) return { field: "brands", rows: payload.brands };
  for (const k of Object.keys(payload)) {
    if (Array.isArray(payload[k]) && payload[k].length && typeof payload[k][0] === "object") return { field: k, rows: payload[k] };
  }
  return null;
}

// ── Brand → organisation routing ────────────────────────────────────────────

/** slug and id → key slot index. Built from list_brands across every key,
 *  sub-entities included, because a tracked report or programme is a
 *  sub-entity of its parent and is exactly the thing somebody asks for. */
let routes = new Map<string, number>();
let routesBuiltAt = 0;
const ROUTES_TTL_MS = 15 * 60 * 1000;

/** For the check: forget every route and cached tool list. */
export function resetAuthorityOnRouting(): void {
  routes = new Map();
  routesBuiltAt = 0;
  toolsCache = null;
  lastAlertAt.clear();
}

function learnRoutes(rows: any[], slot: KeySlot): void {
  for (const b of rows) {
    if (!b || typeof b !== "object") continue;
    if (typeof b.slug === "string" && b.slug) routes.set(b.slug.toLowerCase(), slot.index);
    if (typeof b.id === "string" && b.id) routes.set(b.id.toLowerCase(), slot.index);
  }
}

async function buildRoutes(slots: KeySlot[]): Promise<void> {
  const results = await Promise.all(slots.map((s) => callOne("list_brands", { includeSubEntities: true }, s)));
  routes = new Map();
  for (let i = 0; i < slots.length; i++) {
    const list = listOf(payloadOf(results[i]));
    if (list) learnRoutes(list.rows, slots[i]);
  }
  routesBuiltAt = Date.now();
}

function slotFor(brandRef: string, slots: KeySlot[]): KeySlot | null {
  const idx = routes.get(brandRef.toLowerCase());
  if (idx === undefined) return null;
  return slots.find((s) => s.index === idx) || null;
}

/** list_brands across every organisation, unioned, each brand labelled. */
async function listBrandsEverywhere(args: Record<string, unknown>, slots: KeySlot[]): Promise<AuthorityOnResult> {
  const results = await Promise.all(slots.map((s) => callOne("list_brands", args, s)));
  const brands: any[] = [];
  const organisations: { organisation: string; brands: number; status: string }[] = [];
  let anyOk = false;
  let field = "brands";
  const notes = new Set<string>();
  for (let i = 0; i < slots.length; i++) {
    const r = results[i];
    const slot = slots[i];
    if (!r.ok) {
      organisations.push({ organisation: slot.label, brands: 0, status: r.kind === "auth" ? "key rejected — flagged to an operator" : `unavailable (${r.error})` });
      continue;
    }
    anyOk = true;
    const payload = payloadOf(r);
    const list = listOf(payload);
    const rows = list ? list.rows : [];
    if (list) field = list.field;
    for (const b of rows) brands.push({ ...b, organisation: slot.label });
    learnRoutes(rows, slot);
    for (const n of payload?.meta?.notes || []) if (typeof n === "string") notes.add(n);
    organisations.push({ organisation: slot.label, brands: rows.length, status: "ok" });
  }
  if (!anyOk) {
    // Every organisation failed: report the first failure as the failure,
    // so an auth problem still reads as an auth problem.
    return results[0];
  }
  notes.add(`Brands from ${organisations.length} organisations; each carries the organisation it belongs to. A brand tracked in one organisation is not visible from another.`);
  const merged = { [field]: brands, organisations, meta: { sampleSize: brands.length, notes: Array.from(notes) } };
  return { ok: true, text: JSON.stringify(merged, null, 2), data: merged, organisation: organisations.map((o) => o.organisation).join(", ") };
}

/** A tool with no brand and no organisation — tried against each key until
 *  one has the row (a frozen report id belongs to exactly one). */
async function firstOrganisationThatHas(name: string, args: Record<string, unknown>, slots: KeySlot[]): Promise<AuthorityOnResult> {
  let last: AuthorityOnResult | null = null;
  for (const slot of slots) {
    const r = await callOne(name, args, slot);
    if (r.ok) return r;
    last = r;
    if (r.kind === "auth" || r.kind === "transport") continue;   // this org cannot answer; the next may
    if (!/not_found|not found/i.test(String(r.error || ""))) return r;   // a real refusal — do not shop it around
  }
  return last || { ok: false, kind: "tool_error", error: "not found in any organisation" };
}

/** Per-organisation figures, fanned out and labelled. */
async function eachOrganisation(name: string, args: Record<string, unknown>, slots: KeySlot[]): Promise<AuthorityOnResult> {
  const results = await Promise.all(slots.map((s) => callOne(name, args, s)));
  const rows = results.map((r, i) => ({ organisation: slots[i].label, ...(r.ok ? { result: payloadOf(r) ?? r.text } : { error: r.error, kind: r.kind }) }));
  if (!results.some((r) => r.ok)) return results[0];
  const merged = { organisations: rows };
  return { ok: true, text: JSON.stringify(merged, null, 2), data: merged, organisation: slots.map((s) => s.label).join(", ") };
}

/**
 * Call one AuthorityOn tool, in whichever organisation can answer it.
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
  const slots = keySlots();
  if (!slots.length) {
    return { ok: false, kind: "disabled", error: "AuthorityOn is not configured on this deployment." };
  }
  const started = Date.now();
  const r = await route(name, args || {}, slots);
  const ms = Date.now() - started;
  // Telemetry: tool, latency and outcome. No payloads, no key, no arguments
  // — arguments can carry a brand a user typed, and this line goes to a log
  // we do not treat as confidential.
  console.log(`[AuthorityOn] ${name} ${r.ok ? "ok" : r.kind} ${ms}ms${slots.length > 1 ? ` via ${r.organisation || "?"}` : ""}`);
  return r;
}

async function route(name: string, args: Record<string, unknown>, slots: KeySlot[]): Promise<AuthorityOnResult> {
  // ONE KEY: the plain call, no routing, no extra requests. This is the
  // path every deployment took before a second organisation existed.
  if (slots.length === 1) return callOne(name, args, slots[0]);

  if (name === "list_brands") return listBrandsEverywhere(args, slots);
  if (name === "get_plan_and_usage") return eachOrganisation(name, args, slots);
  const brandRef = typeof args.brand === "string" ? args.brand.trim() : "";
  if (!brandRef) return firstOrganisationThatHas(name, args, slots);

  // A brand-taking tool: the organisation that lists the brand, learned from
  // list_brands; rebuilt once if the table is cold or stale or the brand is
  // new; then every organisation in turn, because the platform resolves by
  // slug some things it does not list.
  let slot = slotFor(brandRef, slots);
  if (!slot && Date.now() - routesBuiltAt > ROUTES_TTL_MS) {
    await buildRoutes(slots);
    slot = slotFor(brandRef, slots);
  }
  if (slot) {
    const r = await callOne(name, args, slot);
    if (!isBrandNotFound(r)) return r;
    // The route was stale (brand moved or disabled): fall through and ask around.
  }
  // Asking around. An organisation whose key is dead or unreachable is
  // noted and skipped — it is not the answer to "does anyone have this
  // brand". A refusal that is not brand_not_found (a scope the key lacks,
  // say) is remembered and returned only if nobody has the brand, because
  // it too may come from an organisation that does not hold it.
  const unreachable: string[] = [];
  let refusal: AuthorityOnResult | null = null;
  for (const s of slots) {
    if (slot && s.index === slot.index) continue;
    const r = await callOne(name, args, s);
    if (r.ok) { learnRoutes([{ slug: brandRef }], s); return r; }
    if (r.kind === "auth" || r.kind === "transport") { unreachable.push(s.label); continue; }
    if (!isBrandNotFound(r)) { refusal = refusal || r; continue; }
  }
  if (refusal) return refusal;
  const checked = slots.filter((s) => !unreachable.includes(s.label)).map((s) => s.label).join(", ");
  const skipped = unreachable.length ? ` ${unreachable.join(", ")} could not be checked (connection unavailable — flagged to an operator).` : "";
  return {
    ok: false,
    kind: "tool_error",
    error: `brand_not_found: No brand "${brandRef}" in any of the organisations this deployment has keys for (${checked}).${skipped}`,
    organisation: checked,
  };
}
