/**
 * One-slide deck edits: patch a slide, or insert a new one.
 *
 * SEAMED OUT OF providers.ts DELIBERATELY. This is pure logic over a slide
 * array, and the interesting failures are all in its refusals — an index that
 * does not exist, an edit that names no change, an insert with nothing in it.
 * providers.ts cannot be imported by a check script (it pulls in the provider
 * SDKs and server-only config), so logic that lived there could not be tested
 * at all. Guarded by scripts/verify-slide-edit.ts.
 *
 * brand.ts is the one thing it imports, and only for the stepper's bounds. That
 * module is a true leaf — no imports of its own, no server config — so the
 * property this file's seam was cut for is intact.
 */
import { STEPPER } from "@/lib/slides/brand";

/** What each layout is DRAWN FROM. A layout in this table with its field
 *  missing has nothing to render: the slide comes out as a title over empty
 *  space. Layouts absent from the table are drawn from title/subtitle/body and
 *  cannot be blank in this way. */
const REQUIRED_PAYLOAD: { [layout: string]: string } = {
  cards: "cards",
  stat: "stats",
  "bar-chart": "chart",
  "stacked-bar": "chart",
  "line-chart": "chart",
  swot: "swot",
  matrix: "matrix",
  comparison: "comparison",
  table: "table",
  scatter: "scatter",
  venn: "venn",
  timeline: "milestones",
  "timeline-parallel": "tracks",
  process: "stages",
  // The SAME payload as `process`, because it is the same content at a count
  // process refuses: its cards are laid across the width, so a sixth is 100pt
  // wide with a two-word caption in it. A serpentine alternates its captions
  // above and below one rule and fits seven. A new field here would have made
  // the model choose a payload to choose a drawing.
  serpentine: "stages",
  "logo-wall": "logos",
  quote: "quote",
  "image-grid": "images",
  layers: "layers",
  hub: "hub",
};

/** One slide a refusal is about, in words a PERSON can read. The refusal's
 *  message is written for the model — field names, the call shape to send
 *  next — and must never be shown to the user; this is what the end-of-turn
 *  notice names instead, so it never has to parse model-directed prose. */
export interface SlideFault {
  /** 1-based, in the deck the call would have produced. */
  slide: number;
  title: string;
  layout: string;
  /** Plain words, no field names or backticks. */
  reason: string;
}

/** What the refused call was trying to do, which decides what the user is told
 *  did NOT happen: a refused append leaves the deck on screen as it was, but it
 *  is the new slides that are missing, not "the deck". */
export type RefusalScope = "build" | "insert" | "edit" | "remove";

/**
 * A generate_slides call refused for its SHAPE, with a message for the MODEL.
 *
 * WHY A CLASS. Every refusal here used to be a plain `throw new Error`, because
 * a throw is what turns into an is_error tool result the model reads and acts
 * on. But the four provider chains also forwarded every thrown message to the
 * browser as a toast, so on 2026-09-15 a user watched "Fix and send again — do
 * NOT tell the user the slide is done" appear on screen while the model quietly
 * retried and the deck built. The words were never meant for them; they reached
 * them because nothing at the throw site said who the audience was. This does.
 * lib/slides/failure.ts decides what each audience sees from the class alone.
 *
 * `faults`, `scope` and `userReason` are what a person is told if the turn ENDS
 * refused (unresolvedSlidesNotice) — a silent refusal is only safe while a later
 * call in the same turn can still succeed.
 */
export class SlideCallRefusal extends Error {
  readonly audience = "model" as const;
  readonly faults: SlideFault[];
  readonly scope?: RefusalScope;
  /** Plain words for a refusal no single slide explains (a cut-off call, no
   *  deck to edit), completing "the request couldn't be used: …". */
  readonly userReason?: string;
  constructor(message: string, detail?: { faults?: SlideFault[]; scope?: RefusalScope; userReason?: string }) {
    super(message);
    this.name = "SlideCallRefusal";
    this.faults = (detail && detail.faults) || [];
    this.scope = detail && detail.scope;
    this.userReason = detail && detail.userReason;
    // Subclassing Error loses the prototype when compiled down to ES5, and then
    // `instanceof` is false for every refusal — which would put the model's
    // words back in the toast without a single error anywhere.
    Object.setPrototypeOf(this, SlideCallRefusal.prototype);
  }
}

/** Is this a refusal? `instanceof`, with the audience marker as a fallback for
 *  a second copy of this module in another bundle chunk. */
export function isSlideCallRefusal(err: unknown): err is SlideCallRefusal {
  return err instanceof SlideCallRefusal || (!!err && (err as any).audience === "model" && err instanceof Error);
}

/** A slide title as a person would read it: accent braces and backticks out. */
function plainTitle(t: any): string {
  return typeof t === "string" ? t.replace(/[{}`]/g, "").trim() : "";
}

/** The fields a slide's words are drawn from, which the builder treats as
 *  strings without asking. */
const SLIDE_TEXT_FIELDS = ["title", "subtitle", "body", "bodyRight", "eyebrow", "notes", "today"];

/**
 * A slide's text fields as TEXT, repaired where the intent is plain, and the
 * names of those that cannot be.
 *
 * WHY. The builder calls `.split`, `.replace` and `.trim` on these without
 * asking, so `body: ["x", "y"]`, `title: 42` or `imageQuery: 5` threw a
 * TypeError. A TypeError is not a refusal: the user was toasted "an internal
 * error", the model was told the user had been shown a failure, and the call's
 * signature was released — so the identical retry threw and toasted again. The
 * malformed thing was the model's CALL, which it can fix in the same turn. A
 * list of bullets is lines of body and 42 is "42", so those are repaired; an
 * object where a title belongs is refused with the field named.
 */
function textFaults(slide: any): { out: any; bad: string[] } {
  const out: any = { ...slide };
  const bad: string[] = [];
  for (const f of SLIDE_TEXT_FIELDS) {
    const v = out[f];
    if (v === undefined || typeof v === "string") continue;
    if (v === null) { delete out[f]; continue; }
    if (typeof v === "number" || typeof v === "boolean") { out[f] = String(v); continue; }
    if (Array.isArray(v) && v.every((x: any) => typeof x === "string" || typeof x === "number")) { out[f] = v.map(String).join("\n"); continue; }
    bad.push(f);
  }
  // A picture brief that is not words is not a brief; nothing to repair it to.
  if (out.imageQuery != null && typeof out.imageQuery !== "string") bad.push("imageQuery");
  else if (out.imageQuery === null) delete out.imageQuery;
  return { out, bad };
}

const PERSON_TEXT_REASON = "part of its text was not in a form that can be drawn";

/**
 * Every slide in a deck as an object with text where text belongs, or a
 * SlideCallRefusal naming the slides that are not. Run by the generate_slides
 * guard before anything reads the deck, so a `null` in the array or a title
 * sent as an object is the model's to fix, not an internal error.
 */
export function textReadySlides(slides: any[], scope?: RefusalScope): any[] {
  const messages: string[] = [];
  const faults: SlideFault[] = [];
  const out = slides.map((s, i) => {
    if (!isObj(s)) {
      messages.push(`slide ${i + 1} is ${s === null ? "null" : Array.isArray(s) ? "an array" : `a ${typeof s}`}, not a slide object`);
      faults.push({ slide: i + 1, title: "", layout: "", reason: "it arrived empty" });
      return s;
    }
    const t = textFaults(s);
    if (t.bad.length) {
      messages.push(`slide ${i + 1} ("${plainTitle(s.title) || "untitled"}") has ${t.bad.map((f) => `\`${f}\``).join(", ")} that ${t.bad.length > 1 ? "are" : "is"} not text — each must be a string, and \`body\` takes one bullet per line`);
      faults.push({ slide: i + 1, title: plainTitle(s.title), layout: String(s.layout || ""), reason: PERSON_TEXT_REASON });
    }
    return t.out;
  });
  if (messages.length) {
    throw new SlideCallRefusal(`Cannot build these slides: ${messages.join("; ")}. Nothing was built or changed; send them again with those fields as text.`, { scope, faults });
  }
  return out;
}

function isEmptyPayload(v: any): boolean {
  if (v == null) return true;
  if (Array.isArray(v)) return v.length === 0;
  if (typeof v === "object") return Object.keys(v).length === 0;
  return false;
}

const isObj = (v: any): boolean => !!v && typeof v === "object" && !Array.isArray(v);

/** The hub's shape, written into every refusal that concerns one. A refusal
 *  that only says "no `hub`" sends the model back to the same guess: the one
 *  that reached production put `caption` and `groups` beside the slide's
 *  title, and the fix it needed was WHERE they go, not that they exist. */
const HUB_SHAPE =
  "hub: { title: the short name in the circle, caption?, groups: [{ name, tone, items: [{ title, icon }] }] } — caption and groups go INSIDE hub, never beside the slide title";

/**
 * Does this hub draw at least one connection?
 *
 * WHY NOT "IS `hub` PRESENT". The guard used to ask only that, and every one of
 * these passed it and built a slide with nothing wired to anything: `hub.items`
 * with no groups, `hub` sent as an array, items sent as bare strings, `nodes`
 * or `connections` in place of `groups`, and a hub carrying only a title — a
 * lone navy circle under a confident headline, with no warning at all. The
 * question that matters is whether a node gets drawn, and a node is drawn from
 * a titled item in one of the first two groups (hubSides draws no more), so
 * that is what is counted.
 */
export function hubHasConnections(hub: any): boolean {
  if (!isObj(hub) || !Array.isArray(hub.groups)) return false;
  return hub.groups.filter(Boolean).slice(0, 2).some((g: any) =>
    isObj(g) && Array.isArray(g.items) &&
    g.items.some((it: any) => isObj(it) && String(it.title == null ? "" : it.title).trim() !== ""));
}

const looksLikeGroups = (a: any): boolean =>
  Array.isArray(a) && a.length > 0 && a.every((g: any) => isObj(g) && Array.isArray(g.items));
const looksLikeItems = (a: any): boolean =>
  Array.isArray(a) && a.length > 0 && a.every((it: any) => typeof it === "string" || isObj(it));

/**
 * A hub slide with its fields moved to where the builder reads them.
 *
 * THE INCIDENT, 2026-09-15. A new chat asked for a deck, and the model's first
 * call put the hub's `caption` and `groups` at the slide's TOP LEVEL, beside its
 * `title`, instead of inside `hub`. The call was refused as a blank slide, the
 * refusal was shown to the user, and the model re-streamed all fifteen slides
 * to fix one. The intent was not ambiguous — `groups` is not a field of any
 * other slide — so, like a misplaced `insertSlides`, it is folded in rather
 * than bounced back.
 *
 * WHAT IS LIFTED, and each lifted key is DELETED from where it was, so the
 * stored spec is clean and the next turn does not replay the mistake:
 *   - `hub` sent as an array of groups becomes `hub.groups`;
 *   - `hub.items` with no groups becomes the first group's items;
 *   - top-level `groups` becomes `hub.groups`;
 *   - top-level `items` on a hub-layout slide becomes the first group's items;
 *   - an item sent as a bare string becomes `{ title }`;
 *   - a top-level `caption` fills `hub.caption` when that is empty, and is
 *     dropped when it is byte-identical to it. A DIFFERENT caption is left
 *     where it is, so droppedContent reports it rather than this function
 *     choosing between two sentences.
 *
 * `hub.title` missing is filled with a COPY of the slide's title, braces
 * stripped, only when that is three words or fewer — "EngineAI" is a name and
 * belongs in the circle, "Everything TCE runs on, in one place" is a headline
 * and does not fit in it.
 *
 * NEVER LIFTED: `nodes`, `connections`, `systems` and the like. Those are
 * guesses at a name, and the guard refuses them with the shape spelled out;
 * reading a guess as an answer is how a slide draws the wrong thing silently.
 *
 * A SLIDE WITH NO LAYOUT THAT DRAWS CONNECTIONS IS A HUB, and this is the one
 * place that says so. The insert paths used to default the layout themselves
 * while the full `slides` route, the guard's scan and the builder defaulted it
 * to "content" — so the same slide appended through insertSlides drew eight
 * nodes, and sent in `slides` or rebuilt by the preview, PDF or publish route
 * drew a title and no diagram, while the visual audit counted it as visual.
 * Every reader normalises first, so every reader now gets the same layout. An
 * explicit layout is never overridden, and a layout-less slide whose hub draws
 * nothing is returned untouched, so a stray `hub` cannot turn prose into a
 * lone circle.
 *
 * Touches ONLY hub-shaped slides — layout "hub", top-level `groups` and no
 * `hub`, or no layout and a `hub` — and returns any other slide as it was
 * given. Pure (the input is never mutated) and idempotent, because it runs at
 * write time in the guard AND at read time in buildSlideRequests, so a stored
 * deck is normalised again every time it is drawn.
 */
export function normaliseSlide<T>(slide: T): T {
  const s: any = slide;
  if (!isObj(s)) return slide;
  const isHub = s.layout === "hub";
  const noLayout = s.layout == null || (typeof s.layout === "string" && !s.layout.trim());
  const bareHub = noLayout && (isObj(s.hub) || looksLikeGroups(s.hub));
  if (!isHub && !bareHub && !(looksLikeGroups(s.groups) && s.hub == null)) return slide;

  let hub: any = null;
  if (looksLikeGroups(s.hub)) hub = { groups: s.hub };
  else if (isObj(s.hub)) hub = { ...s.hub };
  // Something that is neither a hub nor a list of groups cannot be lifted INTO
  // without throwing it away. Left alone; the guard names the shape.
  else if (s.hub != null) return slide;

  const out: any = { ...s };
  const work: any = hub || {};
  let lifted = false;
  const hasGroups = () => Array.isArray(work.groups) && work.groups.length > 0;
  if (!hasGroups() && looksLikeItems(work.items)) {
    work.groups = [{ items: work.items }];
    delete work.items;
    lifted = true;
  }
  if (!hasGroups() && looksLikeGroups(out.groups)) {
    work.groups = out.groups;
    delete out.groups;
    lifted = true;
  }
  if (!hasGroups() && isHub && looksLikeItems(out.items)) {
    work.groups = [{ items: out.items }];
    delete out.items;
    lifted = true;
  }
  if (Array.isArray(work.groups)) {
    work.groups = work.groups.map((g: any) =>
      isObj(g) && Array.isArray(g.items) && g.items.some((it: any) => typeof it === "string")
        ? { ...g, items: g.items.map((it: any) => (typeof it === "string" ? { title: it } : it)) }
        : g);
  }
  if (typeof out.caption === "string") {
    const hasCaption = typeof work.caption === "string" && work.caption.trim() !== "";
    if (!hasCaption && out.caption.trim()) {
      work.caption = out.caption;
      delete out.caption;
      lifted = true;
    } else if (work.caption === out.caption) {
      delete out.caption;
    }
  }
  // Nothing to put a centre name ON: a hub is not invented from a title alone.
  if (!hub && !lifted) return out;
  if (noLayout) {
    // Only a hub that DRAWS claims a layout-less slide; anything else is left
    // exactly as it came, for the layout default and the audits to judge.
    if (!hubHasConnections(work)) return slide;
    out.layout = "hub";
  }
  if (!(typeof work.title === "string" && work.title.trim()) && typeof out.title === "string") {
    const bare = out.title.replace(/[{}]/g, "").trim();
    if (bare && bare.split(/\s+/).length <= 3) work.title = bare;
  }
  out.hub = work;
  return out;
}

/** Is the payload this layout is drawn from there, and does it draw? For every
 *  layout but the hub that is presence; for the hub it is a titled connection,
 *  read through the same normalisation the builder applies. */
function payloadDraws(layout: string, slide: any): boolean {
  const need = REQUIRED_PAYLOAD[layout];
  if (!need) return true;
  if (layout === "hub") return hubHasConnections(normaliseSlide({ ...(slide || {}), layout }).hub);
  return !isEmptyPayload(slide?.[need]);
}

/**
 * Every slide in a deck that would be drawn BLANK, whatever route it arrived by.
 *
 * WHY THIS IS NOT JUST THE INSERT GUARD. The insert path refuses a layout it
 * cannot fill, but the model does not only insert — it also resends the whole
 * deck through `slides`, and the deck it resends is the one it can SEE, which
 * is the stored spec replayed into its context. So once a blank slide is in the
 * deck it is copied forward verbatim on every subsequent turn, and an
 * insert-only guard never runs again. That is exactly what happened on
 * 2026-08-27: a `cards` slide with no `cards` array survived three further
 * generations byte-identical, because nothing validated the array as a whole.
 *
 * Returns human-readable faults, most useful first. Empty means the deck draws.
 */
export function unrenderableSlides(slides: any[]): string[] {
  return scanBlank(slides).map((b) => b.message);
}

/** The same faults as unrenderableSlides, for a person: which slide, and why in
 *  plain words. Carried on the guard's SlideCallRefusal so the end-of-turn
 *  notice can name the slide without reading the model's message. */
export function blankSlideFaults(slides: any[]): SlideFault[] {
  return scanBlank(slides).map((b) => b.fault);
}

/**
 * Every slide carrying a TABLE that its layout will never draw.
 *
 * ── WHY THIS REFUSES RATHER THAN DRAWS ─────────────────────────────────────
 *
 * `content` silently ignores a `table` payload — every row, every column
 * header, no note, no warning. That matters because `content` is the fallback
 * the model reaches for when it believes `table` is unavailable, which it did
 * for a fortnight: `table` was renderable and geometry-checked from 2026-08-31
 * and absent from the tool's own layout enum until 2026-09-15. On 2026-08-31 a
 * user asked twice, by name, for the table layout; the model read its enum,
 * correctly answered that there was no layout called "table", and shipped
 * `content` plus a table payload. Eleven rows and four column headers reached
 * a client deck as nothing at all.
 *
 * Both answers were open. DRAWING it means teaching the prose branch a second
 * table — its own width rules, its own size ladder, its own row-dropping
 * declaration — which is the layout we already have, written twice. PROMOTING
 * the slide to `table` reads well until the slide also carries a panel or a
 * picture rail, which `table` does not draw: one silent loss traded for
 * another. REFUSING costs a round trip and nothing else, and the round trip is
 * now worth taking, because the enum check landing beside this means the model
 * can finally see the layout it is being sent to. The message names the field
 * and the one-call fix, and that call is a layout change on a single slide —
 * so a deck already holding such a slide is not stuck: `editSlide:
 * { slideNumber: N, layout: "table" }` passes this guard on the next call
 * without resending anything.
 *
 * What is NOT defensible is what happens today, which is silence.
 */
export function undrawnTableSlides(slides: any[]): string[] {
  return scanUndrawnTables(slides).map((b) => b.message);
}

/** The same faults as undrawnTableSlides, for a person. */
export function undrawnTableFaults(slides: any[]): SlideFault[] {
  return scanUndrawnTables(slides).map((b) => b.fault);
}

function scanUndrawnTables(slides: any[]): { message: string; fault: SlideFault }[] {
  const out: { message: string; fault: SlideFault }[] = [];
  for (let i = 0; i < slides.length; i++) {
    const s = slides[i] || {};
    const n = i + 1;
    const layout = s.layout || (i === 0 ? "cover" : "content");
    // Only the `table` layout draws one. Read off REQUIRED_PAYLOAD rather than
    // written down again, so a second layout that learns to draw a table is
    // covered the day it is added to that table and not the day someone
    // remembers this one.
    if (REQUIRED_PAYLOAD[layout] === "table") continue;
    // Drawable, on the same terms the renderer uses: it needs both headings
    // and at least one row with something in it, and draws nothing at all
    // otherwise. A payload the `table` layout would itself draw as nothing is
    // not a loss, and refusing over one would be noise.
    const rows = (Array.isArray(s.table?.rows) ? s.table.rows : [])
      .filter((r: any) => Array.isArray(r) && r.some((c: any) => String(c ?? "").trim() !== "")).length;
    const cols = (Array.isArray(s.table?.columns) ? s.table.columns : []).length;
    if (!rows || !cols) continue;
    out.push({
      message: `slide ${n} ("${s.title || "untitled"}") is a "${layout}" slide carrying a \`table\` payload`
        + ` (${cols} column${cols === 1 ? "" : "s"}, ${rows} row${rows === 1 ? "" : "s"}), and "${layout}" never draws a table —`
        + ` every row and heading would be missing from the slide with nothing said about it.`
        + ` Set that slide's layout to "table", which draws the rows and sets commentary in \`body\` beneath them or in \`bodyRight\` beside them;`
        + ` or drop the \`table\` payload and write the figures into \`body\` as text.`,
      fault: { slide: n, title: plainTitle(s.title), layout, reason: `its table of ${rows} rows cannot be drawn on a "${layout}" slide` },
    });
  }
  return out;
}

/** A person's reason a slide of this layout came out blank. */
function blankReason(layout: string): string {
  return layout === "hub"
    ? "the diagram has nothing connected to its centre"
    : `it is a "${layout}" slide with nothing given to draw on it`;
}

function scanBlank(slides: any[]): { message: string; fault: SlideFault }[] {
  const out: { message: string; fault: SlideFault }[] = [];
  for (let i = 0; i < slides.length; i++) {
    const s = slides[i] || {};
    const n = i + 1;
    // The guard hands this scan a NORMALISED deck, so a layout-less hub
    // already says "hub" here; one that draws nothing is left layout-less by
    // normaliseSlide and is prose, not a blank hub.
    const layout = s.layout || (i === 0 ? "cover" : "content");
    const needs = REQUIRED_PAYLOAD[layout];
    if (needs && !payloadDraws(layout, s)) {
      out.push({
        message: layout === "hub"
          ? `slide ${n} ("${s.title || "untitled"}") is a "hub" slide with no connections to draw — it will be drawn as a title over a lone circle or empty space. The shape is ${HUB_SHAPE}. Either supply that, or change the layout to "content" and put the points in \`body\`, one per line.`
          : `slide ${n} ("${s.title || "untitled"}") is a "${layout}" slide with no \`${needs}\` — it will be drawn as a title over empty space. Either supply \`${needs}\`, or change the layout to "content" and put the points in \`body\`, one per line.`,
        fault: { slide: n, title: plainTitle(s.title), layout, reason: blankReason(layout) },
      });
    }
  }
  return out;
}

/** Apply a single-slide edit to the FULL deck, changing only the named slide
 *  and leaving every other slide — text, layout, resolved image — untouched.
 *  Or, with `insertAfter`, add one new slide and leave all the rest untouched.
 *
 *  THROWS when the edit cannot be applied. It used to return the deck unchanged,
 *  which was indistinguishable from success: the route saved the untouched deck
 *  and the model — already narrating — told the user about a slide it had not
 *  made. Every generate_slides call site catches and reports the message back to
 *  the model, so throwing is what stops it claiming a change that never
 *  happened. Found live in production 2026-08-27.
 *
 *  Every throw is a SlideCallRefusal: the messages name fields and tell the
 *  model what to send, so they are for the model only, and the class is what
 *  keeps them out of the user's toast (lib/slides/failure.ts). */
/** Layouts drawn from title/subtitle/body alone, so they need no payload. */
const TEXT_LAYOUTS = [
  "content", "section", "cover", "case-study", "dark-index",
  "image-split", "feature", "closing", "two-column", "statement",
  // `photo-rail` needs a picture the way `image-split` does, and is listed
  // here for the same reason that one is: an `image` is a brief, not a
  // payload, and a slide whose picture cannot be found still draws its words.
  "photo-rail", "three-column",
];

/**
 * The structured fields an edit may carry, which is every payload a layout is
 * drawn from.
 *
 * WHY THIS TOOL NOW CARRIES THEM. It used to accept only text layouts and
 * `cards`, and refused everything else on the honest grounds that a layout
 * whose payload it could not supply would render blank. The consequence turned
 * up building a 35-slide client deck: `generate_slides` REPLACES the deck, so
 * the only way to add a table slide was to resend all thirty-five at once —
 * which is the call that gets cut off. A deck with a chart or a table in it
 * could not be built up in pieces at all.
 *
 * Derived from REQUIRED_PAYLOAD rather than listed again, so a new layout
 * cannot be added to one and forgotten in the other.
 */
export const PAYLOAD_FIELDS: string[] = Object.keys(REQUIRED_PAYLOAD)
  .map((l) => REQUIRED_PAYLOAD[l])
  // `panel` is optional on the content family rather than required by any
  // layout, so deriving from REQUIRED_PAYLOAD alone would leave it the one
  // structured field an edit could not carry.
  // `columns` is the two-column layout's header pair. Left out, a two-column
  // slide inserted or patched through the single-slide fields lost its "Us" /
  // "Them" headers with no report at all — both are under droppedContent's
  // eleven-character floor — while the same slide sent in insertSlides kept
  // them, because a batch entry is copied whole.
  .concat(["panel", "strip", "tones", "note", "columns"])
  .filter((f, i, all) => all.indexOf(f) === i);

/** Plain-string fields a single-slide insert or patch carries beside the text
 *  ones: speaker notes and the parallel timeline's "today". Strings, not
 *  payloads — an empty one is still a deliberate value.
 *
 *  THE COLUMN FIELDS AND THE EYEBROW WERE MISSING, AND THEY FAILED SILENTLY.
 *  The patch branch applied `title`, `subtitle`, `body`, these extras and the
 *  payloads, and nothing else — so `{ slideNumber: 2, bodyRight: "..." }` was
 *  REFUSED as "no change was given", and `{ slideNumber: 2, body, bodyRight }`
 *  was ACCEPTED, changed `body`, and kept the old `bodyRight` with nothing
 *  said. The right-hand column of a two-column slide could not be edited at
 *  all through the route the tool's own description calls the way to change a
 *  slide; only resending the whole slide reached it. Found while wiring the
 *  three-column band, whose third column would have inherited the same hole —
 *  and `eyebrow` is the same one word, in the same array, so it is fixed
 *  beside them rather than left as the next person's surprise. */
export const TEXT_EXTRAS = ["notes", "today", "bodyRight", "bodyThird", "eyebrow"];

/** The text extras a CONTINUATION keeps. Everything else on the list above is
 *  cleared when the splitter cuts a slide in two, and the list is derived from
 *  one place for the reason the patch branch already reads `changesExtra` off
 *  TEXT_EXTRAS: written out by hand it was followed once. `bodyRight` was
 *  cleared and `bodyThird` was not, so the third column of a split
 *  three-column slide was repeated verbatim on every piece — and because it
 *  was still there, the continuation drew TWO columns and split the same copy
 *  across four slides where two-column needs three. */
export const CONTINUATION_KEEPS = ["today"];
export const CONTINUATION_CLEARS = TEXT_EXTRAS.filter((f) => CONTINUATION_KEEPS.indexOf(f) < 0);

/** Can this layout be inserted with the fields given? Exported because it is
 *  the whole rule, and a rule worth enforcing is worth being able to run. */
export function insertableLayout(layout: string, edit: any): { ok: boolean; needs?: string } {
  const need = REQUIRED_PAYLOAD[layout];
  if (!need) return { ok: TEXT_LAYOUTS.indexOf(layout) >= 0 };
  return { ok: payloadDraws(layout, edit), needs: need };
}

/* ─────────────── The deck's spine ─────────────── */

/**
 * WHERE EACH SLIDE SITS IN THE DECK'S OWN SPINE, derived from the deck's
 * structure and written onto every slide as `step`.
 *
 * DECK-LEVEL, STAMPED, NEVER THE MODEL'S. `generate.ts` deliberately drew no
 * page number for years on the grounds that a static number lies the moment
 * somebody merges two slides by hand, and a static "1 2 3 4 5 6 7" inherits
 * that objection exactly. A per-slide field the model fills in desynchronises
 * on the first insert and says nothing about it — the same class of defect as
 * the "(continued) (continued)" fossils. So it is derived from the deck, here,
 * and every route that changes a deck runs this again: `applyEditSlide` below,
 * and the two build entry points beside `stampFooter`.
 *
 * WHAT IT IS DERIVED FROM, in order:
 *
 *  1. THE SECTION DIVIDERS, when the deck has them. A divider is the author
 *     saying "a new chapter starts here" in the one way this schema has of
 *     saying it. Every slide from a divider up to the next one belongs to that
 *     divider's step. This is the only derivation that means anything on a
 *     34-slide client deck, and it is the one the plan names.
 *  2. THE BODY RUN, when it has none. The slides between the front matter (a
 *     cover, an opening statement) and the back matter (a closing) are the
 *     deck's things, one step each. That is the handover deck exactly: cover,
 *     pledge, seven things, closing — seven steps, and it has no dividers.
 *
 * A CONTINUATION IS NOT A NEW STEP. `splitOverflowingSlides` turns one slide
 * whose body overran into two, and the second carries `continuation: true`; it
 * is the same thing, continued, so it carries the same numeral. Stamping after
 * the split without this would turn seven things into eight the moment one of
 * them was a paragraph too long.
 *
 * NOTHING IS STAMPED at all when the derived count falls outside
 * STEPPER.minSteps..maxSteps — see there for why both ends exist. That is not a
 * failure: most decks are not a numbered series, and a rail is furniture that
 * has to earn its line.
 */
export interface SlideStep {
  /** 1-based, the step this slide is on. */
  n: number;
  /** How many steps the rail holds. */
  of: number;
}

/** Layouts that are the deck's covers rather than its contents. The stepper
 *  skips them for the same reason the footer does — and the footer's own rule
 *  is `layout !== "cover" && layout !== "closing"`, which is where this list
 *  starts. `statement` joins them at the HEAD only: an opening pledge is front
 *  matter, and the same layout used in the middle of a deck is a slide. */
const SPINE_SKIP_HEAD = ["cover", "statement", "section"];

/** A section divider announces its own chapter and draws a 64pt index numeral
 *  in the top-left slot instead of the rail, exactly as it takes none of the
 *  frame's hairlines. It still sits ON a step — that numeral is stamped from
 *  it — so it is skipped by the drawing, not by the derivation. */
function isDivider(layout: string): boolean { return layout === "section"; }

export function deckSteps(slides: any[], bounds: { min: number; max: number }): (SlideStep | undefined)[] {
  const n = slides.length;
  const out: (SlideStep | undefined)[] = new Array(n);
  if (!n) return out;
  const layoutAt = (i: number): string => {
    const raw = String((slides[i] || {}).layout || "").trim();
    return raw || (i === 0 ? "cover" : "content");
  };

  // 1. Dividers.
  //
  // A CHAPTER IS A DIVIDER WITH A PAGE IN IT, not a divider. Sizing the rail on
  // the dividers alone lets a chapter that opens and immediately closes — a
  // divider followed by another divider, or by nothing but the sign-off —
  // consume a numeral that no page in the deck ever lights, so the rail
  // advertises N things and the marked numeral visibly jumps 1 → 3. "How much
  // is left" is the question this device exists to answer; a numeral that is
  // never current is not an answer to it.
  const dividers: number[] = [];
  for (let i = 0; i < n; i++) if (isDivider(layoutAt(i))) dividers.push(i);
  if (dividers.length) {
    // The pages each divider opens, in order.
    const pages: number[][] = [];
    for (let d = 0; d < dividers.length; d++) {
      const from = dividers[d] + 1;
      const to = d + 1 < dividers.length ? dividers[d + 1] : n;
      const mine: number[] = [];
      for (let i = from; i < to; i++) {
        const layout = layoutAt(i);
        // A cover or a closing is not in a chapter by definition, and neither
        // is the front matter before the first divider — which is why this
        // walks forward from a divider rather than over the whole deck.
        if (layout === "cover" || layout === "closing") continue;
        mine.push(i);
      }
      pages.push(mine);
    }
    let chapters = 0;
    for (let d = 0; d < pages.length; d++) if (pages[d].length) chapters += 1;
    if (chapters < bounds.min || chapters > bounds.max) return out;
    let step = 0;
    for (let d = 0; d < pages.length; d++) {
      if (!pages[d].length) continue;
      step += 1;
      // THE DIVIDER ITSELF IS ON THE STEP IT OPENS. It draws no rail — see
      // layoutHoldsRail in generate.ts — but its own 64pt chapter numeral is
      // stamped from this, so the large number and the small ones cannot
      // disagree after an insert. That was the whole argument for deriving the
      // rail at all, and for one commit the ten-times-larger number beside it
      // was still the model's.
      out[dividers[d]] = { n: step, of: chapters };
      for (let k = 0; k < pages[d].length; k++) out[pages[d][k]] = { n: step, of: chapters };
    }
    return out;
  }

  // 2. The body run. Front matter is a LEADING run only — a statement in the
  //    middle of a deck is one of the things, not a preface to them.
  let first = 0;
  while (first < n && SPINE_SKIP_HEAD.indexOf(layoutAt(first)) >= 0) first += 1;
  let last = n - 1;
  while (last >= first && layoutAt(last) === "closing") last -= 1;
  if (last < first) return out;

  // Count the things first, so the bounds are judged on what the rail would
  // actually hold rather than on the number of slides.
  let total = 0;
  for (let i = first; i <= last; i++) if (!(slides[i] || {}).continuation) total += 1;
  if (total < bounds.min || total > bounds.max) return out;
  let step = 0;
  for (let i = first; i <= last; i++) {
    if (!(slides[i] || {}).continuation) step += 1;
    // A continuation before anything has been counted cannot happen — the
    // splitter always emits the first half — but a stored deck is replayed
    // through here and a `continuation` flag can arrive on its own.
    if (step) out[i] = { n: step, of: total };
  }
  return out;
}

/** The deck's spine, put onto every slide in it — the same shape as
 *  `stampFooter` and `stampDensity` in generate.ts, and for the same reason:
 *  the builder is handed one slide at a time, so a deck-wide decision has to
 *  travel on each of them.
 *
 *  It lives HERE rather than beside those two because generate.ts already
 *  imports this module and the reverse would be a cycle; generate.ts re-exports
 *  it, the way validate.ts re-exports inkBottom. One implementation.
 *
 *  ALWAYS CLEARS FIRST. A slide that was step 4 of a deck that has since lost
 *  its dividers must stop saying so, and a stale field is worse than none. */
export function stampSteps(slides: any[], bounds: { min: number; max: number }): any[] {
  if (!Array.isArray(slides)) return slides;
  const steps = deckSteps(slides, bounds);
  for (let i = 0; i < slides.length; i++) {
    const slide = slides[i];
    if (!slide) continue;
    const want = steps[i];
    const has = slide.step;
    // Nothing to do is the common case, and saying so here is what keeps this
    // idempotent: running it twice over the same deck must not produce a
    // second set of objects.
    if (want ? (has && has.n === want.n && has.of === want.of) : !has) continue;
    // COPY, NEVER WRITE THROUGH. `applyEditSlide` returns a fresh ARRAY whose
    // entries are the caller's own slide objects, and it is contract — checked
    // — that the deck handed in is not changed: a refused or partial edit must
    // leave what is on screen exactly as it was. stampFooter and stampDensity
    // write in place because they are handed the deck that is about to be
    // drawn; this one runs on an edit's result as well, so it copies.
    const next = { ...slide };
    if (want) next.step = want; else delete next.step;
    slides[i] = next;
  }
  return slides;
}

/** The bounds the product ships at. Taken as a parameter by the two functions
 *  above so a check can drive both ends of the range rather than assert that a
 *  constant exists — the seam GEOMETRY_SEVERITY established in Stage 1. */
export const STEP_BOUNDS = { min: STEPPER.minSteps, max: STEPPER.maxSteps };

/**
 * THE RE-STAMP. Every edit renumbers the whole spine before the deck comes
 * back.
 *
 * This is the wrapper rather than a line at each `return` because the function
 * below has nine of them, and the one that gets forgotten is the one that
 * matters: inserting a slide in the middle of a stepped deck is precisely the
 * case where a stale rail would show slide 5 marked as step 4 for the rest of
 * the deck, and nothing anywhere would say so.
 */
export function applyEditSlide(slides: any[], edit: Parameters<typeof applyEditSlideTo>[1]): any[] {
  return stampSteps(applyEditSlideTo(slides, edit), STEP_BOUNDS);
}

function applyEditSlideTo(
  slides: any[],
  edit: {
    slideNumber?: number;
    insertAfter?: number;
    layout?: string;
    imageQuery?: string;
    /** The whole `image` object — the route a CALLOUT has to travel, since
     *  imageQuery can only ever say "find me a photograph of". Replaces the
     *  slide's picture wholesale, exactly as imageQuery does. */
    image?: any;
    title?: string;
    subtitle?: string;
    body?: string;
    bodyRight?: string;
    eyebrow?: string;
    cards?: { marker?: string; icon?: string; title?: string; body?: string }[];
    /** Slide numbers to DELETE, 1-based. The tool could add and change but not
     *  remove, so taking two slides out of a 34-slide deck meant resending all
     *  34 — the call that gets cut off. Applied before any insert, so the
     *  numbers mean what they mean in the deck the user is looking at. */
    removeSlides?: number[];
    /** SEVERAL slides at once, in order, at `insertAfter`. One slide per call
     *  is arithmetically hopeless for a long deck: the tool is capped at three
     *  calls a turn, so thirty-five slides would take twelve turns of a user
     *  typing "continue". A dozen at a time makes it one. */
    insertSlides?: any[];
    /** Any structured payload a layout is drawn from — `table`, `chart`,
     *  `stats`, `swot`, `milestones` and the rest. Same shape as in `slides`. */
    [payload: string]: any;
  }
): any[] {
  // The edit's own text fields as text before anything reads them (textFaults):
  // `imageQuery: 5` threw "trim is not a function" beside a deck on screen,
  // and reached the user as an internal error.
  {
    const typed = textFaults(edit);
    if (typed.bad.length) {
      const scope: RefusalScope = Array.isArray(edit.removeSlides) && edit.removeSlides.length ? "remove"
        : edit.insertAfter != null || (edit.slideNumber == null && Array.isArray(edit.insertSlides)) ? "insert" : "edit";
      throw new SlideCallRefusal(
        `The edit's ${typed.bad.map((f) => `\`${f}\``).join(", ")} must be text (a string). Nothing has been changed.`,
        { scope, userReason: "part of the change was not in a form that can be drawn" }
      );
    }
    edit = typed.out;
  }

  // DELETE first, and against the deck the user can SEE. Doing it after an
  // insert would renumber everything under the user's feet: "remove 33 and 34"
  // means the slides that are 33 and 34 on screen right now.
  if (Array.isArray(edit.removeSlides) && edit.removeSlides.length) {
    const bad = edit.removeSlides.filter((n) => !Number.isInteger(n) || n < 1 || n > slides.length);
    if (bad.length) {
      throw new SlideCallRefusal(
        `Cannot remove slide${bad.length > 1 ? "s" : ""} ${bad.join(", ")}: the deck has ${slides.length} slides, so each number must be between 1 and ${slides.length}. Nothing has been removed.`,
        { scope: "remove", userReason: `the deck has ${slides.length} slides, so there is no slide ${bad.join(" or ")} to remove` }
      );
    }
    const drop = new Set(edit.removeSlides);
    const kept = slides.filter((_, i) => !drop.has(i + 1));
    if (!kept.length) {
      throw new SlideCallRefusal("That would remove every slide in the deck. Nothing has been removed.",
        { scope: "remove", userReason: "it would have removed every slide in the deck" });
    }
    // A removal on its own is the whole edit; anything else in the same call
    // would be applied to numbers that have just shifted.
    const alsoEditing = edit.slideNumber != null || edit.insertAfter != null;
    if (alsoEditing) {
      throw new SlideCallRefusal(
        `removeSlides cannot be combined with slideNumber or insertAfter in one call: the numbering shifts as soon as a slide is removed. Remove first, look at the result, then edit.`,
        { scope: "remove", userReason: "it tried to remove slides and change others in the same step" }
      );
    }
    return kept;
  }

  // ADD a slide. `insertAfter` is the slide number the new one goes after, so 0
  // puts it first and slides.length appends. Without this the tool could only
  // patch, so "add a slide after slide 5" was structurally impossible — and
  // because the patch path failed silently, it looked like it had worked.
  // `insertSlides` WITH NO TARGET MEANS APPEND. There is nothing else it can
  // mean: a batch of new slides and no slideNumber to replace and no
  // insertAfter to sit behind. It used to be an error telling the model to
  // pass insertAfter, and the model then did — a round later. On a turn with a
  // hard time limit that round is not free: the ITM regeneration spent one
  // here and was cut off by the platform ceiling while still appending, so a
  // recoverable malformed call cost part of the deliverable. Default it to the
  // end of the deck rather than bouncing it back.
  if (edit.insertAfter == null && edit.slideNumber == null && Array.isArray(edit.insertSlides) && edit.insertSlides.length) {
    edit = { ...edit, insertAfter: slides.length };
  }

  if (edit.insertAfter != null) {
    const at = edit.insertAfter;
    if (!Number.isInteger(at) || at < 0 || at > slides.length) {
      throw new SlideCallRefusal(
        `Cannot insert after slide ${at}: the deck has ${slides.length} slides, so insertAfter must be between 0 (before the first) and ${slides.length} (after the last).`,
        { scope: "insert", userReason: `the deck has ${slides.length} slides, so there is no slide ${at} to add them after` }
      );
    }
    // SEVERAL AT ONCE. Each is validated exactly as a single insert is, so a
    // batch cannot smuggle in a blank slide that one at a time would refuse.
    const batch = Array.isArray(edit.insertSlides) ? edit.insertSlides : null;
    if (batch) {
      if (!batch.length) {
        throw new SlideCallRefusal("insertSlides was empty: pass at least one slide, or use the single-slide fields.",
          { scope: "insert", userReason: "the request contained no slides" });
      }
      const faults: string[] = [];
      // The same faults for a person, numbered as the slides would have been
      // in the deck rather than in the batch the user never saw.
      const people: SlideFault[] = [];
      const built = batch.map((raw: any, i: number) => {
        // Repaired before it is judged, exactly as a slide in a full deck is:
        // text fields as text, and a hub whose `groups` landed beside its
        // title is not a blank slide.
        const typed = textFaults({ ...(raw || {}) });
        const one: any = normaliseSlide(typed.out);
        // A slide carrying connections and no layout is a hub, the way one
        // carrying cards is a cards slide.
        const lay = one.layout || (Array.isArray(one.cards) && one.cards.length ? "cards" : hubHasConnections(one.hub) ? "hub" : "content");
        if (typed.bad.length) {
          faults.push(`slide ${i + 1} of the batch has ${typed.bad.map((f) => `\`${f}\``).join(", ")} that is not text`);
          people.push({ slide: at + i + 1, title: plainTitle(one.title), layout: lay, reason: PERSON_TEXT_REASON });
          return one;
        }
        if (typeof one.title !== "string" && typeof one.body !== "string" && typeof one.subtitle !== "string") {
          faults.push(`slide ${i + 1} of the batch has no title or body`);
          people.push({ slide: at + i + 1, title: "", layout: lay, reason: "it has no title or text" });
          return one;
        }
        const ok = insertableLayout(lay, one);
        if (!ok.ok) {
          faults.push(ok.needs
            ? `slide ${i + 1} of the batch is "${lay}" but carries no \`${ok.needs}\`${lay === "hub" ? ` it can draw (${HUB_SHAPE})` : ""}, so it would be blank`
            : `slide ${i + 1} of the batch names an unknown layout "${lay}"`);
          people.push({
            slide: at + i + 1, title: plainTitle(one.title), layout: lay,
            reason: ok.needs ? blankReason(lay) : `"${lay}" is not a slide layout that exists`,
          });
        }
        one.layout = lay;
        if (one.imageQuery && String(one.imageQuery).trim()) {
          one.image = { query: String(one.imageQuery).trim() };
          delete one.imageQuery;
        }
        return one;
      });
      if (faults.length) {
        throw new SlideCallRefusal(`Cannot insert these slides: ${faults.join("; ")}.`, { scope: "insert", faults: people });
      }
      return slides.slice(0, at).concat(built, slides.slice(at));
    }

    // The same repair for a single insert, so `groups`, `items` or `caption`
    // sent beside the new slide's title reach `hub` — which is what the
    // payload copy below carries onto the slide.
    edit = normaliseSlide(edit);

    if (
      typeof edit.title !== "string" &&
      typeof edit.body !== "string" &&
      typeof edit.subtitle !== "string"
    ) {
      throw new SlideCallRefusal(
        "Cannot insert an empty slide: give the new slide at least a title or a body.",
        { scope: "insert", faults: [{ slide: at + 1, title: "", layout: edit.layout || "content", reason: "it has no title or text" }] }
      );
    }

    const cards = Array.isArray(edit.cards) ? edit.cards.filter((c) => c && (c.title || c.body)) : [];
    const layout = edit.layout || (cards.length ? "cards" : hubHasConnections(edit.hub) ? "hub" : "content");
    const newFault = (reason: string): SlideFault[] => [{ slide: at + 1, title: plainTitle(edit.title), layout, reason }];

    // A layout is allowed if this tool can actually FILL it — either it needs
    // no payload, or the payload was supplied. The check is the same one
    // `unrenderableSlides` applies to a whole deck, so an inserted slide cannot
    // pass here and be reported blank there.
    const can = insertableLayout(layout, edit);
    if (!can.ok) {
      throw new SlideCallRefusal(
        can.needs
          ? `Cannot insert a "${layout}" slide without \`${can.needs}\`: that is what the layout is drawn from, so the slide would come out blank — a correct title with nothing under it. Pass \`${can.needs}\` alongside the title.${layout === "hub" ? ` The shape is ${HUB_SHAPE}.` : ""}`
          : `Cannot insert a "${layout}" slide: there is no such layout. Text layouts are ${TEXT_LAYOUTS.join(", ")}; every other layout needs its own payload (${PAYLOAD_FIELDS.join(", ")}).`,
        { scope: "insert", faults: newFault(can.needs ? blankReason(layout) : `"${layout}" is not a slide layout that exists`) }
      );
    }
    if (layout === "cards" && cards.length < 2) {
      throw new SlideCallRefusal(
        `A "cards" slide needs at least two cards, each with a title or a body — otherwise it is drawn empty. Pass \`cards\`, or use layout "content" with one bullet per line in \`body\`.`,
        { scope: "insert", faults: newFault("a card slide needs at least two cards") }
      );
    }

    const fresh: any = { layout };
    if (typeof edit.title === "string") fresh.title = edit.title;
    if (typeof edit.subtitle === "string") fresh.subtitle = edit.subtitle;
    if (typeof edit.body === "string") fresh.body = edit.body;
    if (typeof edit.bodyRight === "string") fresh.bodyRight = edit.bodyRight;
    if (typeof edit.eyebrow === "string") fresh.eyebrow = edit.eyebrow;
    for (const f of TEXT_EXTRAS) if (typeof edit[f] === "string") fresh[f] = edit[f];
    if (cards.length) fresh.cards = cards;
    for (const f of PAYLOAD_FIELDS) {
      if (f !== "cards" && !isEmptyPayload(edit[f])) fresh[f] = edit[f];
    }
    if (isObj(edit.image)) fresh.image = edit.image;
    else if (edit.imageQuery?.trim()) fresh.image = { query: edit.imageQuery.trim() };
    return slides.slice(0, at).concat([fresh], slides.slice(at));
  }

  const idx = (edit.slideNumber ?? 0) - 1;
  if (idx < 0 || idx >= slides.length) {
    throw new SlideCallRefusal(
      edit.slideNumber == null
        ? `No slide was named. The deck has ${slides.length} slides. To ADD slides pass insertAfter (the number to add them after) with insertSlides; to CHANGE one, pass slideNumber between 1 and ${slides.length}. The deck has not been changed.`
        : `Cannot edit slide ${edit.slideNumber}: the deck has ${slides.length} slides. To ADD a slide pass insertAfter; to change one, pass a slideNumber between 1 and ${slides.length}.`,
      {
        scope: "edit",
        userReason: edit.slideNumber == null
          ? "it did not say which slide to change"
          : `the deck has ${slides.length} slides, so there is no slide ${edit.slideNumber} to change`,
      }
    );
  }
  // A PATCH TO A HUB with its fields beside the slide number rather than in
  // `hub`. Read against the layout the slide will HAVE — the edit's, else the
  // stored one — so "change the caption on slide 4" reaches `hub.caption` on a
  // hub slide, and still changes nothing (and is refused as such) on a content
  // slide. Only a hub slide lifts: `groups` sent to a content slide would be
  // stored and never drawn, which is the silent no-op this function exists to
  // refuse. What is lifted is MERGED over the stored hub, so new `groups` keep
  // the centre name and caption already there. The slide's title is left out
  // of the lift on purpose: a copied title must never overwrite a stored name.
  //
  // AN EXPLICIT `hub` IS MERGED THE SAME WAY. It used to replace the whole hub,
  // as every other payload does, and that punished the shape the schema asks
  // for while rewarding the misplaced one: `{ slideNumber, caption }` kept the
  // stored name and connections, but `{ slideNumber, hub: { caption } }` was
  // stored as a hub with no connections and refused — silently, and at the cost
  // of a call — and `hub: { groups }` was ACCEPTED with the centre name and
  // caption quietly gone. A hub patch now means "these fields of the hub";
  // `groups`, when sent, replaces the groups, and an empty caption clears it.
  const target: any = slides[idx] || {};
  if ((edit.layout || normaliseSlide(target).layout) === "hub" && (edit.hub == null || isObj(edit.hub) || looksLikeGroups(edit.hub))) {
    const given: any = normaliseSlide({ layout: "hub", hub: edit.hub == null ? undefined : edit.hub, groups: edit.groups, items: edit.items, caption: edit.caption });
    if (isObj(given.hub) && Object.keys(given.hub).length) {
      const stored: any = normaliseSlide({ ...target, layout: "hub" }).hub;
      edit = { ...edit, hub: isObj(stored) ? { ...stored, ...given.hub } : given.hub };
    }
  }
  const changesPayload = PAYLOAD_FIELDS.some((f) => !isEmptyPayload(edit[f]));
  // WHAT THIS BRANCH APPLIES IS WHAT IT ACCEPTS. `notes` used to be named here
  // by hand while the other extras were not, so a patch carrying only
  // `bodyRight` was refused as an empty request — an honest refusal of a field
  // the code a dozen lines below would have applied perfectly well. Read off
  // TEXT_EXTRAS so the two cannot disagree again.
  const changesExtra = TEXT_EXTRAS.some((f) => typeof edit[f] === "string");
  // A LAYOUT ON ITS OWN IS A CHANGE. The branch below applies `edit.layout`
  // perfectly well, and the guard did not count it — so "make slide 3 a
  // photo-rail" was refused as an empty request, on every layout in the enum
  // this route offers. The same shape as the `bodyRight` hole one function
  // above, and it matters more now: the tool's own guidance steers the model
  // towards converting a `content` slide to a photo rail, and the one-call way
  // to say it did not work.
  const changesLayout = typeof edit.layout === "string" && !!edit.layout.trim();
  if (
    !edit.imageQuery?.trim() &&
    !isObj(edit.image) &&
    typeof edit.title !== "string" &&
    typeof edit.subtitle !== "string" &&
    typeof edit.body !== "string" &&
    !changesExtra &&
    !changesLayout &&
    !changesPayload
  ) {
    throw new SlideCallRefusal(
      `No change was given for slide ${edit.slideNumber}: pass at least one of title, subtitle, body, image, or a payload such as ${PAYLOAD_FIELDS.slice(0, 3).join(", ")}.`,
      // A reason, not a fault: nothing about slide N fails to DRAW, and a notice
      // saying it "could not be drawn" would send the user looking for a
      // problem with the slide rather than with the request.
      {
        scope: "edit",
        userReason: `it did not say what to change on slide ${idx + 1}${plainTitle(target.title) ? ` ("${plainTitle(target.title)}")` : ""}`,
      }
    );
  }
  return slides.map((sl, i) => {
    if (i !== idx) return sl;                       // every other slide byte-for-byte
    const next: any = { ...sl };
    if (isObj(edit.image) || edit.imageQuery?.trim()) {
      // New picture: set the brief and drop the resolved image so a fresh one is
      // fetched. imageUnavailable is cleared so resolution runs again. `image`
      // wins over `imageQuery`, because it is the only one of the two that can
      // carry an attachment, a region or a callout — a patch adding callouts to
      // a screenshot had no route here at all, so the model had to resend the
      // whole slide through insertSlides to add one.
      next.image = isObj(edit.image) ? edit.image : { query: String(edit.imageQuery).trim() };
      delete next.resolvedImage;
      delete next.imageUnavailable;
      delete next.imageError;
    }
    if (typeof edit.title === "string") next.title = edit.title;
    if (typeof edit.subtitle === "string") next.subtitle = edit.subtitle;
    if (typeof edit.body === "string") next.body = edit.body;
    for (const f of TEXT_EXTRAS) if (typeof edit[f] === "string") next[f] = edit[f];
    // A payload change carries its layout with it: replacing a slide's `table`
    // without moving it off `content` leaves the table stored and undrawn.
    if (changesLayout) {
      const wanted = String(edit.layout).trim();
      // A PICTURE IS BAKED TO THE BOX THE OLD LAYOUT DREW IT IN. Resolution
      // crops to `pictureShape(layout)`, so a slide converted from `content`
      // to `photo-rail` — which is exactly the conversion this tool now steers
      // the model towards — keeps a 0.79 landscape crop inside a 0.736
      // portrait box. The three output paths then disagree about what to do
      // with the mismatch: Slides stretches it, the PDF crops it and the chat
      // preview letterboxes it, so one deck shows three different pictures.
      // Cleared here so resolution re-bakes to the new box, exactly as a new
      // `image` brief does above — and ONLY while there is still a brief to
      // re-resolve from, because a slide carrying a resolved picture and no
      // brief has nothing to fetch again and clearing it would lose the
      // photograph rather than re-crop it.
      if (wanted !== next.layout && (isObj(next.image) || typeof next.image === "string")) {
        delete next.resolvedImage;
        delete next.imageUnavailable;
        delete next.imageError;
      }
      next.layout = wanted;
    }
    for (const f of PAYLOAD_FIELDS) {
      if (!isEmptyPayload(edit[f])) next[f] = edit[f];
    }
    return next;
  });
}
