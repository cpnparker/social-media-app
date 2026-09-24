/**
 * Stage 5, Tier 1, on the stored decks: every stored slide on a layout that
 * takes a composition, given one, drawn through the real build path and
 * compared slide by slide with the same slide drawn as its archetype.
 *
 *   npx tsx scripts/verify-compose-corpus.ts --pull   # fetch the snapshot, then check
 *   npx tsx scripts/verify-compose-corpus.ts          # check the snapshot already pulled
 *
 * WHY THIS IS A SCRIPT OF ITS OWN. Check 57 of verify-slide-layouts.ts proves
 * the composition on generated decks and on one committed fixture; the design
 * challenge's third fatal finding — a grammar that dropped 131 strings on 106
 * of the 212 prose slides it was tried on — was found on the STORED decks, and
 * its arbiter, "no composed slide may drop a string the archetype drew", has to
 * be held there, slide by slide, over all of them. The stored decks are client
 * work, so they are never committed: the snapshot lives outside the repository
 * (SLIDES_CORPUS, or the system's temp directory), is pulled READ-ONLY from
 * intelligence.ai_messages.slides_draft, and without one this script says it
 * measured nothing and exits 2 rather than passing — a check that silently
 * tests nothing is the failure this repo has already paid for.
 *
 * THE ARBITER IS THE ARCHETYPE OF THE SAME FIELDS. Most stored prose slides
 * carry one `body`, and one column is the archetype itself, so the variants
 * that matter RE-CUT that body into two or three columns — which is what a
 * model writing a composition does — and compare against the same re-cut
 * slide with no composition. For each composed slide: no fault on a subject
 * the archetype does not fault; no paragraph the archetype drew left undrawn;
 * no fault on a column, and no ink off the page. A composition set aside, or
 * one that restates its layout, must draw the archetype's request stream to
 * the byte — and so must one DECLINED (composeDecision: it will not fit one
 * slide, fits only under the deck's size, breaks one-line points, or spends
 * units on nothing), against the archetype over ITS words: the columns as
 * one list in their order, which on a re-cut slide is the stored slide
 * itself. Cut onto a second slide, a declined list is cut between its
 * columns, which the archetype has no reason to choose, so there it is held
 * to the archetype's fault subjects and paragraphs instead.
 *
 * LAST RESULT (2026-09-24, 107 drafts, 1,404 slides, 408 on a composing
 * layout): every assertion held at both densities. Re-cut into columns, 79-104
 * slides per variant were drawn as compositions and 20-42 declined to the
 * archetype over their words (byte for byte, column boxes by position);
 * 5-13 per variant were refused by the guard at `present` and none at
 * `read`; 0 new fault subjects, 0 paragraphs lost, 0 column faults.
 *
 * MUTATION LOG (2026-09-24; a copy of the worktree, never the shared tree):
 *  - KILLED, 1,380 failures: composeNotUsedBecause returning null (the
 *    set-aside guard removed) — two-column heads, credits and panels drawn
 *    nowhere by the slides that carried them.
 *  - KILLED, 166 failures: bulletBlock replaced by a paragraph walker that
 *    stops at the band's foot (the prototype's emitter) — paragraphs the
 *    archetype drew, drawn nowhere, the last of a long list first.
 *  - KILLED, 227 failures: the builder drawing the plain archetype for a
 *    declined composition — its columns' join not applied, so `bodyRight`
 *    and `bodyThird` were drawn nowhere on a slide said to hold them.
 */
import { readFileSync, writeFileSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { createHash } from "crypto";
import {
  buildSlideRequests, splitOverflowingSlides, stampDeckChrome, stampDensity, droppedContent, stripImageMarkdown,
  compositionOf, composeDecision, composeNotUsedBecause, composedColumnsThatCannotFit, COMPOSE_LAYOUTS, type SlideInput,
} from "../lib/slides/generate";
import { offCanvasFaults, overlapFaults, overrunFaults, offPageFaults, wideWordFaults } from "../lib/slides/validate";
import { previewSlideFrom } from "../lib/slides/preview-model";
import { normaliseSlide } from "../lib/slides/edit";
import { layoutOf, type Density } from "../lib/slides/brand";

const SNAPSHOT = process.env.SLIDES_CORPUS || join(tmpdir(), "engineai-slides-corpus.json");

/** Pull every stored draft, READ-ONLY: a GET against PostgREST with the
 *  service key from .env.local, which is never printed. */
async function pull(): Promise<void> {
  const env: { [k: string]: string } = {};
  const raw = readFileSync(join(process.cwd(), ".env.local"), "utf8").split("\n");
  for (let i = 0; i < raw.length; i++) {
    const line = raw[i];
    const at = line.indexOf("=");
    if (at < 0 || line.trim().startsWith("#")) continue;
    env[line.slice(0, at).trim()] = line.slice(at + 1).trim().replace(/^["']|["']$/g, "");
  }
  const url = env.NEXT_PUBLIC_SUPABASE_URL, key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) { console.log("  .env.local carries no Supabase URL and key — cannot pull."); process.exit(2); }
  const rows: any[] = [];
  for (let off = 0; ; off += 20) {
    const r = await fetch(`${url}/rest/v1/ai_messages?slides_draft=not.is.null&select=id_message,slides_draft&order=date_created.asc&limit=20&offset=${off}`,
      { headers: { apikey: key, Authorization: `Bearer ${key}`, "Accept-Profile": "intelligence" } });
    const page = await r.json();
    if (!Array.isArray(page)) { console.log(`  the pull failed: ${JSON.stringify(page).slice(0, 200)}`); process.exit(2); }
    for (let i = 0; i < page.length; i++) rows.push(page[i]);
    if (page.length < 20) break;
  }
  writeFileSync(SNAPSHOT, JSON.stringify(rows));
  console.log(`  pulled ${rows.length} drafts into ${SNAPSHOT}`);
}

const key = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const probe = (p: string) => key(stripImageMarkdown(p)).split(" ").slice(0, 5).join(" ");
const paras = (s: any) => String(s || "").split("\n").map((x) => x.trim()).filter(Boolean);
const COLS = ["body", "bodyRight", "bodyThird"];
const carried = (s: any) => COLS.filter((k) => typeof s[k] === "string" && s[k].trim());
const NON_CONTENT = ["layout", "layoutAsked", "tone", "tones", "style", "color", "colour", "url", "src", "query", "icon", "resolvedUrl",
  "resolvedIcon", "imageError", "imageQuery", "bakedFor", "iconsMissing", "notes", "footer", "presentationId", "fidelity", "align", "id",
  "font", "__src", "compose"];

/** Re-cut `body` into n columns, as a model writing a composition would. */
function recut(s: any, n: number, cols: number[]): any | null {
  if (carried(s).join(",") !== "body") return null;
  const p = paras(s.body);
  if (p.length < n) return null;
  const per = Math.ceil(p.length / n);
  const out: any = { ...s };
  const fields: string[] = [];
  for (let i = 0; i < n; i++) {
    const part = p.slice(i * per, (i + 1) * per).join("\n");
    out[COLS[i]] = part || undefined;
    if (part) fields.push(COLS[i]);
  }
  out.compose = { columns: cols, fields };
  return out;
}
const VARIANTS: { [k: string]: (s: any) => any | null } = {
  natural: (s) => { const f = carried(s); return { ...s, compose: { columns: f.length === 3 ? [4, 4, 4] : f.length === 2 ? [6, 6] : [12], fields: f.length ? f : ["body"] } }; },
  narrow: (s) => { const f = carried(s); return { ...s, compose: { columns: f.length === 3 ? [4, 4, 4] : f.length === 2 ? [4, 8] : [8, 4], fields: f.length ? f : ["body"] } }; },
  wrong: (s) => { const f = carried(s); return { ...s, compose: { columns: f.length >= 2 ? [5, 5] : [3, 9], fields: f.length ? f.slice(0, 1) : ["body"] } }; },
  halves: (s) => recut(s, 2, [6, 6]),
  lopsided: (s) => recut(s, 2, [8, 4]),
  thirds: (s) => recut(s, 3, [4, 4, 4]),
  str: (s) => ({ ...s, compose: "three equal columns" }),
};
const RECUT = ["halves", "lopsided", "thirds"];

function build(slides: any[], at: Density, title: string): SlideInput[] {
  let s: any[] = slides.map((x: any, i: number) => ({ ...JSON.parse(JSON.stringify(x)), __src: i }));
  stampDensity(s, at);
  s = splitOverflowingSlides(s);
  stampDeckChrome(s, title);
  return s;
}

function measure(deck: SlideInput[], src: number) {
  const subjects: string[] = [], columnFaults: string[] = [], dropped: string[] = [], streams: string[] = [];
  let drawn = "";
  for (let j = 0; j < deck.length; j++) {
    const piece: any = deck[j];
    if (piece.__src !== src) continue;
    const reqs = buildSlideRequests(piece, j, "c") as any[];
    // Column boxes by position, not by field: a composition drawn as its
    // archetype keeps each paragraph's own field name on its box, by design.
    streams.push(createHash("sha1").update(JSON.stringify(reqs).replace(/c_s\d+/g, "c_s#").replace(/"insertionIndex":\d+/g, "")
      .replace(/_(?:body|bodyRight|bodyThird)\d*(dot\d*)?"/g, (_m: string, d: string) => `_col${d ? "dot" : ""}"`)).digest("hex"));
    drawn += " " + key(reqs.filter((r) => r.insertText && r.insertText.text).map((r) => String(r.insertText.text)).join(" · "));
    const page = previewSlideFrom(piece, reqs);
    const faults = offCanvasFaults(reqs, piece, j).faults.concat(overlapFaults(page, piece, j).faults, overrunFaults(page, piece, j).faults,
      offPageFaults(page, piece, j).faults, wideWordFaults(page, piece, j).faults);
    const n = normaliseSlide(piece);
    const comp = compositionOf(n, layoutOf(n.layout, j));
    for (let f = 0; f < faults.length; f++) {
      const subject = (String(faults[f].note).match(/`[^`]+`/) || [`?${faults[f].kind}`])[0];
      // A continuation's title is the splitter's " (continued)", not the composition's.
      if (!(piece.continuation && subject === "`title`") && subjects.indexOf(subject) < 0) subjects.push(subject);
      if (comp && comp.written && (/^`(body|bodyRight|bodyThird)`$/.test(subject) || faults[f].kind === "off-page")) columnFaults.push(faults[f].note.slice(0, 140));
    }
    const d = droppedContent(piece, j);
    for (let i = 0; i < d.length; i++) dropped.push(d[i]);
  }
  return { subjects, columnFaults, dropped, drawn, streams: streams.join("+") };
}

async function main(): Promise<void> {
  if (process.argv.indexOf("--pull") >= 0) await pull();
  if (!existsSync(SNAPSHOT)) {
    console.log(`\n  NOT MEASURED: no snapshot at ${SNAPSHOT}. Run with --pull (reads .env.local, read-only), or point SLIDES_CORPUS at one.\n`);
    process.exit(2);
  }
  const corpus: any[] = JSON.parse(readFileSync(SNAPSHOT, "utf8"));
  let failures = 0;
  const fail = (m: string) => { failures++; console.log(`  FAIL  ${m}`); };
  let slides = 0;
  for (let d = 0; d < corpus.length; d++) {
    const sd = corpus[d].slides_draft;
    slides += (Array.isArray(sd) ? sd : (sd && sd.slides) || []).length;
  }
  console.log(`\nThe composition on the stored decks: ${corpus.length} drafts, ${slides} slides (${SNAPSHOT})`);
  if (corpus.length < 20 || slides < 300) fail(`precondition: the snapshot holds ${corpus.length} drafts and ${slides} slides — too few to stand for the stored decks`);
  const names = Object.keys(VARIANTS);
  for (const at of ["read", "present"] as Density[]) {
    for (let v = 0; v < names.length; v++) {
      const name = names[v];
      const t = { eligible: 0, composed: 0, restated: 0, declined: 0, declinedCut: 0, aside: 0, refused: 0, recovered: 0 };
      const said: string[] = [];
      const bad = (m: string) => { if (said.length < 5) said.push(m); };
      const before = failures;
      for (let d = 0; d < corpus.length; d++) {
        const sd = corpus[d].slides_draft;
        const src: any[] = Array.isArray(sd) ? sd : (sd && sd.slides) || [];
        const title = String((sd && sd.title) || "Deck");
        const mutated: any[] = src.map((x) => JSON.parse(JSON.stringify(x)));
        const plan: { [i: number]: string } = {};
        const joinedAt: { [i: number]: any } = {};
        for (let i = 0; i < src.length; i++) {
          const n: any = normaliseSlide(src[i]);
          const lay = layoutOf(n.layout, i);
          if (COMPOSE_LAYOUTS.indexOf(lay) < 0) continue;
          const m = VARIANTS[name](JSON.parse(JSON.stringify(src[i])));
          if (!m) continue;
          t.eligible++;
          const guarded = src.map((x, k) => (k === i ? m : x));
          if (composedColumnsThatCannotFit(guarded, at).some((c) => c.slide === i + 1)) { t.refused++; continue; }
          mutated[i] = m;
          const nm: any = normaliseSlide({ ...m, density: at });
          const dec = composeDecision(nm, lay, i);
          plan[i] = typeof m.compose !== "object" || composeNotUsedBecause(nm, lay) ? "aside" : dec.comp && dec.comp.written ? "composed"
            : dec.joined || dec.measured ? "declined" : "restated";
          if (plan[i] === "declined") { const j: any = dec.joined ? { ...dec.joined } : { ...nm }; delete j.compose; delete j.density; joinedAt[i] = j; }
        }
        const archetype = RECUT.indexOf(name) >= 0
          ? mutated.map((x) => { const y = JSON.parse(JSON.stringify(x)); delete y.compose; return y; }) : src;
        const A = build(archetype, at, title), B = build(mutated, at, title);
        // The archetype over each declined slide's own words.
        const W = Object.keys(joinedAt).length ? build(archetype.map((x, k) => (joinedAt[k] ? joinedAt[k] : x)), at, title) : A;
        for (let i = 0; i < src.length; i++) {
          const p = plan[i];
          if (!p) continue;
          const x = p === "declined" ? measure(W, i) : measure(A, i), y = measure(B, i);
          const where = `${at} ${name} draft ${d + 1} slide ${i + 1}`;
          if (p === "aside") { t.aside++; if (x.streams !== y.streams) { fail(`${where}: a composition set aside is not drawn as its archetype`); bad(where); } continue; }
          if (p === "restated") { t.restated++; if (x.streams !== y.streams) { fail(`${where}: a composition that restates its layout is not drawn as it`); bad(where); } continue; }
          if (p === "declined") {
            t.declined++;
            const cut = y.streams.indexOf("+") >= 0;
            if (!cut && x.streams !== y.streams) { fail(`${where}: a declined composition is not drawn as the archetype over its words`); bad(where); }
            if (cut) {
              t.declinedCut++;
              // Its boxes keep their own fields' names; the archetype's are all `body`.
              const subj = (v: string) => v.replace(/^`(bodyRight|bodyThird)`$/, "`body`");
              for (let k = 0; k < y.subjects.length; k++) if (x.subjects.map(subj).indexOf(subj(y.subjects[k])) < 0) { fail(`${where}: a declined list, cut, faults ${y.subjects[k]}, which its archetype does not`); bad(where); }
              const ws = paras(joinedAt[i].body);
              for (let q = 0; q < ws.length; q++) { const pr = probe(ws[q]); if (pr.length > 10 && y.drawn.indexOf(pr) < 0) { fail(`${where}: a declined list, cut, draws no "${ws[q].slice(0, 40)}"`); bad(where); } }
            }
            continue;
          }
          t.composed++;
          for (let k = 0; k < y.subjects.length; k++) {
            if (x.subjects.indexOf(y.subjects[k]) < 0) { fail(`${where}: a fault on ${y.subjects[k]} its archetype does not have`); bad(where); }
          }
          for (let k = 0; k < y.columnFaults.length; k++) { fail(`${where}: ${y.columnFaults[k]}`); bad(where); }
          const orig: any = normaliseSlide(archetype[i]);
          const keys = Object.keys(orig);
          for (let k = 0; k < keys.length; k++) {
            if (NON_CONTENT.indexOf(keys[k]) >= 0) continue;
            const walk = (val: any, field: string) => {
              if (typeof val === "string") {
                if (NON_CONTENT.indexOf(field) >= 0) return;
                const ps = paras(val);
                for (let q = 0; q < ps.length; q++) {
                  const pr = probe(ps[q]);
                  if (pr.length > 10 && x.drawn.indexOf(pr) >= 0 && y.drawn.indexOf(pr) < 0) { fail(`${where}: \`${field}\` paragraph "${ps[q].slice(0, 40)}" drawn by the archetype and not by the composition`); bad(where); }
                }
                return;
              }
              if (Array.isArray(val)) { for (let z = 0; z < val.length; z++) walk(val[z], field); return; }
              if (val && typeof val === "object") { const kk = Object.keys(val); for (let z = 0; z < kk.length; z++) walk(val[kk[z]], kk[z]); }
            };
            walk(orig[keys[k]], keys[k]);
          }
          if (RECUT.indexOf(name) < 0) {
            for (let k = 0; k < y.dropped.length; k++) if (x.dropped.indexOf(y.dropped[k]) < 0) { fail(`${where}: drops "${y.dropped[k].slice(0, 40)}", which its archetype drew`); bad(where); }
          }
          for (let k = 0; k < x.dropped.length; k++) if (y.dropped.indexOf(x.dropped[k]) < 0) t.recovered++;
        }
      }
      // NOT VACUOUS: enough of each re-cut is drawn as columns, and enough
      // is handed back, to stand for what a model writing columns gets.
      if (RECUT.indexOf(name) >= 0 && (t.composed < 50 || t.declined < 15)) fail(`${at} ${name}: precondition — only ${t.composed} slides were drawn as compositions and ${t.declined} declined`);
      console.log(`  ${failures === before ? "ok  " : "FAIL"}  ${at} ${name}: ${JSON.stringify(t)}${said.length ? ` — ${said.join("; ")}` : ""}`);
    }
  }
  console.log(failures ? `\n${failures} FAILURE(S)\n` : `\nAll checks passed.\n`);
  process.exit(failures ? 1 : 0);
}

main().catch((e) => { console.log(`\n  ERROR: ${e && e.stack ? e.stack : e}\n`); process.exit(2); });
