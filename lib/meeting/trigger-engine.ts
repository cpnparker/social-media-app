/**
 * EngineAI Live — client-side trigger engine.
 *
 * Runs entirely in the companion window (the deck is already in memory, so a
 * T1 hit → card render is network-free and well inside the <500ms budget).
 *
 * T1: compiled regex lexicons (from /api/ai/meeting/deck triggerSpecs) scanned
 *     against each finalised utterance — <1ms, zero cost. deck-target hits
 *     render a cached deck card immediately.
 * T2: content-receipts and other semantic kinds batch finalised utterances and
 *     POST to /api/ai/meeting/triggers for LLM extraction + live retrieval.
 *
 * Dedup/cooldown/volume caps prevent the "tail-chasing"/over-triggering
 * anti-patterns the research flagged: one live chip at a time, per-key
 * cooldowns, a global rate cap, then drawer-only mode.
 */

export interface TriggerSpec {
  id: string;
  kind: string;
  patterns: string[];
  target: "deck" | "t2" | "moment";
  cardKey?: string;
  title?: string;
  cooldownMs: number;
  priority: number;
}

/**
 * MOMENT triggers — the family that watches the ROOM rather than the client
 * record.
 *
 * Every other card family is a lookup keyed on a client, so a meeting with a
 * prospect who has no Engine record produced nothing at all — while the
 * transcript was full of the things you actually want flagged. These fire from
 * the utterance itself: no deck, no client, no server round-trip, so they work
 * in a pitch to someone we have never billed.
 *
 * Precision over recall, deliberately. A false flag in a live meeting costs
 * the operator attention at the worst possible moment, so each pattern targets
 * language that is hard to say by accident.
 */
export const MOMENT_TRIGGERS: TriggerSpec[] = [
  {
    id: "moment_scope",
    kind: "moment",
    title: "Scope request",
    // Asking for something beyond what is on the table — the single most
    // valuable thing to catch while you can still respond to it.
    patterns: [
      "\\b(could|can|would) you (also|as well)\\b",
      "\\b(bring|move|roll|fold|put) (it|that|them|everything|the \\w+) (in )?under (the )?(same|one) (contract|umbrella|agreement|retainer)\\b",
      "\\b(under one|the same) (umbrella|contract|roof|agreement)\\b",
      "\\b(also|additionally) (take care of|handle|look after|cover|manage)\\b",
      "\\b(add|include|extend .{0,20}to cover) (the )?(website|social|media|events?|design|seo)\\b",
      "\\bis there (a )?(scenario|way|possibility)\\b",
    ],
    target: "moment",
    cooldownMs: 90_000,
    priority: 6,
  },
  {
    id: "moment_commitment",
    kind: "moment",
    title: "You committed",
    // Something OUR side just promised. Worth seeing written down while it can
    // still be qualified — unmet promises are what sour a retainer.
    patterns: [
      "\\b(we'?ll|we will|we can|we'?re happy to|we'd be happy to) (do|get|send|share|put together|draft|prepare|deliver|set up|arrange|look into|come back)\\b",
      "\\b(leave (it|that) with (me|us)|i'?ll (send|get|share|come back|follow up)|we'?ll (revert|follow up|circle back))\\b",
      "\\b(that'?s|that is) (possible|doable|fine|no problem)\\b",
      "\\b(yes,? we (can|could|do))\\b",
      "\\bwe (are|'re) flexible\\b",
    ],
    target: "moment",
    cooldownMs: 90_000,
    priority: 5,
  },
  {
    id: "moment_date",
    kind: "moment",
    title: "Date on the table",
    patterns: [
      "\\b(start(ing)? (from|in)|kick ?off (in|from)|go live (in|from)|by the end of|no later than|deadline is|due (by|in))\\s+(january|february|march|april|may|june|july|august|september|october|november|december|q[1-4]|next (week|month|quarter|year)|\\d{1,2}(st|nd|rd|th)?)\\b",
      "\\b(last|first) week of (january|february|march|april|may|june|july|august|september|october|november|december)\\b",
      "\\b(hand ?over|onboarding|transition) (in|from|the (last|first) week)\\b",
      "\\b(\\d+)[- ](year|month) (contract|term|engagement|timeframe|deal)\\b",
      "\\bfor the next \\d+ (year|month)s?\\b",
    ],
    target: "moment",
    cooldownMs: 120_000,
    priority: 4,
  },
  {
    id: "moment_decision",
    kind: "moment",
    title: "How they'll decide",
    // Their stated criteria, and the process. Gold for the follow-up.
    patterns: [
      "\\b(what (we|they)'?re looking for is|the (main|key) thing (for us|is)|what matters (to us|most) is)\\b",
      "\\b(what )?we('| a)?re looking for\\b",
      "\\bwe want (someone|a firm|an agency) (who|that)\\b",
      "\\b(interview(ing)? process|decision|shortlist|next steps?|we'?ll (let you know|be in touch)|get in touch on next steps)\\b",
      "\\b(other (agencies|suppliers|bidders)|competitor|incumbent|current (agency|supplier|provider))\\b",
    ],
    target: "moment",
    cooldownMs: 120_000,
    priority: 3,
  },
  {
    id: "moment_pricing",
    kind: "moment",
    title: "Pricing question",
    patterns: [
      "\\b(how (much|many) (does|do|would) (it|they|that) cost)\\b",
      "\\b(cost per|price per|rate per|per (content )?unit|day rate|hourly rate)\\b",
      "\\b(how (do|can) (we|you) distinguish|how is (it|that) (priced|costed|calculated))\\b",
      "\\b(is (that|it) (locked|fixed)|does (that|the price) (change|vary|increase))\\b",
    ],
    target: "moment",
    cooldownMs: 120_000,
    priority: 4,
  },
  {
    id: "moment_risk",
    kind: "moment",
    title: "Worth addressing",
    // Doubt, objection or a constraint stated aloud — say something now.
    patterns: [
      "\\b(my (only )?(concern|worry|hesitation)|i'?m (a bit )?(concerned|worried)|the (concern|risk|issue) is)\\b",
      "\\b(we'?ve (been )?(burned|disappointed)|last (agency|supplier|provider) (didn'?t|failed|never))\\b",
      "\\b(unfortunately|the problem is|that (might|could) be (a problem|difficult|tricky))\\b",
      "\\b(not sure (if|whether|that)|i doubt|that seems (expensive|a lot|steep))\\b",
    ],
    target: "moment",
    cooldownMs: 90_000,
    priority: 6,
  },
];

export interface DeckCard {
  id: string | null;
  kind: string;
  key: string;
  title: string;
  body: any;
  receipt: any;
}

export interface LiveCard {
  localId: string;
  dbId: string | null;
  kind: string;
  source: "deck" | "t1" | "t2" | "manual" | "auto";
  title: string;
  body: any;
  receipt: any;
  firedAt: number;
  state: "live" | "pinned" | "drawer";
  triggerText?: string;
  insight?: string; // natural, conversation-aware framing (LLM-generated, async)
}

const GLOBAL_MIN_GAP_MS = 20_000; // sustained ≥1 card / ~20s (burst-tolerant)
const HARD_CAP_PER_HOUR = 12;
const T2_BATCH_MAX = 3; // utterances
const T2_BATCH_IDLE_MS = 8_000;

let uid = 0;
const nextId = () => `c${++uid}-${performance.now().toFixed(0)}`;

export class TriggerEngine {
  private specs: { spec: TriggerSpec; regexes: RegExp[] }[] = [];
  private deckByKey = new Map<string, DeckCard>();
  private cooldowns = new Map<string, number>(); // cardKey/kind → lastFiredAt
  private lastGlobalFire = 0;
  private firedThisHour = 0;
  private hourStart = Date.now();
  private t2Buffer: { idx: number; text: string }[] = [];
  private t2Timer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private sessionId: string,
    private onCard: (card: LiveCard) => void,
    private onDrawerOnly: (card: LiveCard) => void
  ) {}

  load(specs: TriggerSpec[], deck: DeckCard[]) {
    // MOMENT specs are appended unconditionally. They need neither a client nor
    // a compiled deck, so they must survive the case that broke the IFFIm
    // pitch: no client record, therefore no deck, therefore no server-supplied
    // specs, therefore — previously — no cards at all.
    this.specs = [...specs, ...MOMENT_TRIGGERS].map((spec) => ({
      spec,
      regexes: spec.patterns.map((p) => new RegExp(p, "i")),
    }));
    this.deckByKey.clear();
    for (const c of deck) this.deckByKey.set(c.key, c);
  }

  /** Feed a finalised utterance. */
  ingest(idx: number, text: string) {
    const clean = text.trim();
    if (clean.length < 3) return;

    for (const { spec, regexes } of this.specs) {
      if (!regexes.some((re) => re.test(clean))) continue;

      if (spec.target === "t2") {
        this.queueT2(idx, clean);
        continue;
      }
      if (spec.target === "moment") {
        // No deck lookup, no network: the evidence IS the sentence, so the
        // card can be on screen while the words are still hanging in the air.
        // The insight line arrives after, via enrichCard.
        this.fire({
          kind: "moment",
          source: "t1",
          title: spec.title || "Worth catching",
          body: { moment: spec.id, quote: clean.slice(0, 400) },
          receipt: { label: "just said in the meeting" },
          dbId: null,
          cooldownKey: `moment:${spec.id}`,
          cooldownMs: spec.cooldownMs,
          priority: spec.priority,
          triggerText: clean.slice(0, 200),
        });
        continue;
      }
      // deck-target: fire the cached card
      const deck = spec.cardKey ? this.deckByKey.get(spec.cardKey) : undefined;
      if (!deck) continue;
      this.fire({
        kind: spec.kind,
        source: "t1",
        title: spec.title || deck.title,
        body: deck.body,
        receipt: deck.receipt,
        dbId: deck.id,
        cooldownKey: `${spec.kind}:${spec.cardKey}`,
        cooldownMs: spec.cooldownMs,
        priority: spec.priority,
        triggerText: clean.slice(0, 200),
      });
    }
  }

  private queueT2(idx: number, text: string) {
    this.t2Buffer.push({ idx, text });
    if (this.t2Buffer.length >= T2_BATCH_MAX) {
      this.flushT2();
    } else if (!this.t2Timer) {
      this.t2Timer = setTimeout(() => this.flushT2(), T2_BATCH_IDLE_MS);
    }
  }

  private async flushT2() {
    if (this.t2Timer) { clearTimeout(this.t2Timer); this.t2Timer = null; }
    const batch = this.t2Buffer.splice(0);
    if (batch.length === 0) return;
    try {
      const res = await fetch("/api/ai/meeting/triggers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: this.sessionId, utterances: batch }),
      });
      const data = await res.json().catch(() => ({}));
      for (const card of data.cards || []) {
        this.fire({
          kind: card.kind,
          source: "t2",
          title: card.title,
          body: card.body,
          receipt: card.receipt,
          dbId: card.id,
          cooldownKey: `${card.kind}`,
          cooldownMs: 180_000,
          priority: 2,
          triggerText: batch.map((b) => b.text).join(" ").slice(0, 200),
          alreadyLogged: true, // the triggers route already inserted the row
        });
      }
    } catch { /* transient — fine */ }
  }

  private fire(opts: {
    kind: string; source: "t1" | "t2"; title: string; body: any; receipt: any;
    dbId: string | null; cooldownKey: string; cooldownMs: number; priority: number;
    triggerText?: string; alreadyLogged?: boolean;
  }) {
    const now = Date.now();

    // Hourly cap → drawer-only mode
    if (now - this.hourStart > 3_600_000) { this.hourStart = now; this.firedThisHour = 0; }

    // Per-key cooldown
    const last = this.cooldowns.get(opts.cooldownKey) || 0;
    if (now - last < opts.cooldownMs) return;

    const card: LiveCard = {
      localId: nextId(),
      dbId: opts.dbId,
      kind: opts.kind,
      source: opts.source,
      title: opts.title,
      body: opts.body,
      receipt: opts.receipt,
      firedAt: now,
      state: "live",
      triggerText: opts.triggerText,
    };

    this.cooldowns.set(opts.cooldownKey, now);

    const overCap = this.firedThisHour >= HARD_CAP_PER_HOUR;
    const tooSoon = now - this.lastGlobalFire < GLOBAL_MIN_GAP_MS;

    if (overCap || tooSoon) {
      // Drawer-only: still logged, just not interruptive
      card.state = "drawer";
      this.onDrawerOnly(card);
      if (!opts.alreadyLogged) this.logShown(card, "suppressed");
      return;
    }

    this.lastGlobalFire = now;
    this.firedThisHour++;
    this.onCard(card);
    if (!opts.alreadyLogged) this.logShown(card, "shown");
  }

  private logShown(card: LiveCard, state: "shown" | "suppressed") {
    // Fire-and-forget; assigns a DB id for later feedback if it was a T1 card
    fetch("/api/ai/meeting/cards", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId: this.sessionId,
        cardId: card.dbId,
        action: state,
        kind: card.kind,
        title: card.title,
        receipt: card.receipt,
        triggerPattern: card.triggerText,
        latencyMs: Math.round(performance.now() % 1000),
      }),
    })
      .then((r) => r.json())
      .then((d) => { if (d?.cardId && !card.dbId) card.dbId = d.cardId; })
      .catch(() => {});
  }

  /** Report a lifecycle event for the trigger log. */
  report(card: LiveCard, action: "dismissed" | "pinned" | "expired" | "feedback", value?: number) {
    if (!card.dbId && action !== "feedback") return;
    fetch("/api/ai/meeting/cards", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId: this.sessionId, cardId: card.dbId, action, value }),
    }).catch(() => {});
  }

  destroy() {
    if (this.t2Timer) clearTimeout(this.t2Timer);
    this.t2Buffer = [];
  }
}
