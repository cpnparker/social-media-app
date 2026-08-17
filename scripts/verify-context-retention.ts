/**
 * Assertions for conversation context retention — `npx tsx`.
 *
 * These reproduce a real failure. A user pasted a colleague's handover note
 * into a thread, got correct answers about it for several turns, then twenty
 * turns later asked what was still outstanding on it — and was told the
 * handover was "not in the Engine task system" while the model went hunting
 * through tools. It had not stopped understanding: the 20-message cap had
 * dropped the paste, so from where the model stood no handover existed.
 *
 * The logic under test is inline in the chat route, so it is reproduced here
 * exactly. That makes these MODEL-PINNING assertions, not a test of the route —
 * they fail if the rule changes, which is the point, but they do not prove the
 * route calls them. Keep the two in step by hand.
 *
 * No network, no credentials.
 */

type Msg = { role_message: "user" | "assistant"; document_message: string; attachments?: unknown[] };

let passed = 0;
const failures: string[] = [];
const eq = (actual: unknown, expected: unknown, label: string) => {
  if (Object.is(actual, expected)) passed++;
  else failures.push(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
};

const MAX_HISTORY = 20;
const REFERENCE_DOC_MIN_CHARS = 1200;
const REFERENCE_DOC_BUDGET = 60000;
const ORPHAN_MAX_CHARS = 1200;

/** The pinning rule: which dropped user messages come back. */
function pinnedDocs(history: Msg[]): { docs: string[]; omitted: number; droppedCount: number } {
  const effective = history.length > MAX_HISTORY ? history.slice(-MAX_HISTORY) : history;
  const droppedCount = Math.max(0, history.length - effective.length);
  const dropped = history.slice(0, history.length - effective.length);
  const docs: string[] = [];
  let used = 0;
  let omitted = 0;
  for (let i = dropped.length - 1; i >= 0; i--) {
    const m = dropped[i];
    if (m.role_message !== "user") continue;
    const text = (m.document_message || "").trim();
    if (text.length < REFERENCE_DOC_MIN_CHARS) continue;
    if (used + text.length > REFERENCE_DOC_BUDGET) { omitted++; continue; }
    docs.unshift(text);
    used += text.length;
  }
  return { docs, omitted, droppedCount };
}

/** The orphan rule: merge substantial consecutive user messages, drop short ones. */
function dedupe(effective: Msg[]): Msg[] {
  const out: Msg[] = [];
  const work = effective.map((m) => ({ ...m }));
  for (let i = 0; i < work.length; i++) {
    const cur = work[i];
    const nextIsUser = i + 1 < work.length && work[i + 1].role_message === "user";
    if (cur.role_message === "user" && nextIsUser) {
      const text = (cur.document_message || "").trim();
      const hasAttachments = Array.isArray(cur.attachments) && cur.attachments.length > 0;
      if (text.length > ORPHAN_MAX_CHARS || hasAttachments) {
        work[i + 1].document_message = `${text}\n\n${(work[i + 1].document_message || "").trim()}`.trim();
      }
      continue;
    }
    out.push(cur);
  }
  return out;
}

const HANDOVER = "Below is my handover and things to watch out for during my holiday. ".repeat(60);
const u = (t: string, a?: unknown[]): Msg => ({ role_message: "user", document_message: t, attachments: a });
const a = (t: string): Msg => ({ role_message: "assistant", document_message: t });

/* ── the failure that shipped ── */
{
  // Handover pasted at message 3 of a 50-message conversation.
  const history: Msg[] = [u("Here is the handover from Roberts."), a("Let me pull that up.")];
  history.push(u(HANDOVER), a("Here is the state of play."));
  for (let i = 0; i < 23; i++) { history.push(u(`follow-up ${i}`), a(`answer ${i}`)); }

  eq(history.length, 50, "a realistic working session is 50 messages");
  eq(history.slice(-MAX_HISTORY).some((m) => m.document_message === HANDOVER), false,
    "the handover is NOT in the last 20 — this is why the answer was wrong");

  const { docs, droppedCount } = pinnedDocs(history);
  eq(docs.length, 1, "pinning brings exactly the handover back");
  eq(docs[0], HANDOVER.trim(), "and brings it back VERBATIM, not summarised (trimmed only)");
  eq(droppedCount, 30, "30 messages were dropped and the model is told so");
}

/* ── it must pin documents, not chatter ── */
{
  const history: Msg[] = [];
  for (let i = 0; i < 30; i++) { history.push(u(`short question ${i}`), a(`short answer ${i}`)); }
  const { docs } = pinnedDocs(history);
  eq(docs.length, 0, "ordinary short messages are never pinned");
}

/* ── assistant output is never pinned, however long ── */
{
  const history: Msg[] = [a("A very long assistant answer. ".repeat(200))];
  for (let i = 0; i < 25; i++) { history.push(u(`q${i}`), a(`a${i}`)); }
  const { docs } = pinnedDocs(history);
  eq(docs.length, 0, "only what the USER supplied is treated as reference material");
}

/* ── nothing is pinned when nothing was dropped ── */
{
  const history: Msg[] = [u(HANDOVER), a("ok"), u("and?"), a("here")];
  const { docs, droppedCount } = pinnedDocs(history);
  eq(droppedCount, 0, "a short conversation drops nothing");
  eq(docs.length, 0, "so nothing needs re-injecting — it is already visible");
}

/* ── the budget binds newest-first, and says what it left out ── */
{
  const big = "x".repeat(25000);
  const history: Msg[] = [u(big + "1"), u(big + "2"), u(big + "3")];
  for (let i = 0; i < 25; i++) { history.push(u(`q${i}`), a(`a${i}`)); }
  const { docs, omitted } = pinnedDocs(history);
  eq(docs.length, 2, "two 25k documents fit inside the 60k budget");
  eq(omitted, 1, "the third is reported as omitted rather than silently dropped");
  eq(docs[docs.length - 1].endsWith("3"), true, "the most recent paste is kept when the budget binds");
}

/* ── paste-then-ask: the document must survive ── */
{
  const merged = dedupe([u(HANDOVER), u("what is left on this?"), a("...")]);
  eq(merged.length, 2, "the two user messages become one, plus the assistant reply");
  eq(merged[0].document_message.includes("handover"), true, "the PASTE survives — it used to be deleted");
  eq(merged[0].document_message.includes("what is left on this?"), true, "and the question is kept with it");
}

/* ── but short orphans are still collapsed, which is what the guard was for ── */
{
  const merged = dedupe([u("hello?"), u("you there?"), u("actually, what is the revenue?"), a("...")]);
  eq(merged.length, 2, "three short unanswered messages collapse to one, plus the assistant reply");
  eq(merged[0].document_message, "actually, what is the revenue?", "the last one wins, as before");
  eq(merged[0].document_message.includes("hello?"), false, "the short orphans are genuinely gone");
}

/* ── an attachment-bearing message is never dropped, however short ── */
{
  const merged = dedupe([u("see attached", [{ name: "PO.pdf" }]), u("what does it say?"), a("...")]);
  eq(merged.length, 2, "one merged user message, plus the assistant reply");
  eq(merged[0].document_message.includes("see attached"), true, "a short message WITH an attachment is kept");
  eq(merged[0].document_message.includes("what does it say?"), true, "and carries the question with it");
}

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) {
  for (const f of failures) console.log(`  ✗ ${f}`);
  process.exit(1);
}
console.log("Context retention verified.\n");
