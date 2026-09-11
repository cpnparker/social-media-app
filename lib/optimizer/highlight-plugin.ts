/**
 * Inline highlights for judge findings.
 *
 * DECORATIONS, NOT MARKS — four reasons, in order of force for this codebase:
 *
 *  1. The editor persists `getHTML()` on a debounce. Marks serialize, so every
 *     saved draft would carry <span class="ai-issue"> wrappers and the
 *     content-prop round-trip would thrash on the difference forever.
 *  2. Marks pollute undo history. Loading twelve findings would push twelve
 *     steps onto the stack, and undo after dismissing one would resurrect it.
 *  3. Findings are SERVER state. A decoration is exactly a projection of
 *     external state onto a document; a mark would be a second copy of it
 *     inside the document, free to disagree.
 *  4. Two findings overlapping is trivial as decorations and ugly as
 *     same-typed marks.
 *
 * The one thing marks give free — position tracking through edits — is the
 * `apply` reducer below, which maps every range through `tr.mapping` and
 * orphans anything whose range collapses. That reducer is the entire reason
 * highlights survive typing, and it is about fifteen lines.
 */

import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import type { EditorState, Transaction } from "@tiptap/pm/state";
import type { Node as PMNode } from "@tiptap/pm/model";
import { buildDocIndex, textRangeToPos } from "./doc-index";
import { findAnchor } from "./anchors";

export interface HighlightFinding {
  id: string;
  criterion: string;
  severity: "high" | "medium" | "low";
  quote: string;
  prefix?: string;
  suffix?: string;
  explanation: string;
  /**
   * WHY it matters, for a reader who asks for it.
   *
   * Separate from `explanation` because they are read at different moments.
   * The finding and the action are scanned; the reasoning is consulted. Running
   * them together made every card four lines and turned a list of fifteen into
   * something nobody reads.
   */
  why?: string;
  suggestedEdit: string | null;
}

export type IssueStatus = "active" | "orphaned" | "resolved" | "dismissed";

export interface Issue {
  finding: HighlightFinding;
  from: number;
  to: number;
  status: IssueStatus;
}

/**
 * A place in the draft the CONVERSATION had something to say about.
 *
 * Deliberately not an Issue, and this is the whole design of Ship 3.
 * anchorFindings resolves range collisions by ORPHANING the loser, longest
 * quote first — so a conversation anchor (typically a whole sentence) and a
 * "sentence runs long" mark over that same sentence would fight, and one would
 * silently disappear with nothing on screen saying which or why. Feeding these
 * through the same list would delete rubric marks at random.
 *
 * So a note claims no inline range at all. It is drawn as a WIDGET in the
 * margin, which is a different visual channel and cannot collide — and which
 * also happens to be the honest rendering: an opinion about a paragraph is not
 * a defect in it, and underlining the prose would say it was.
 */
export interface NoteMark {
  /** talk:<turn>:<n> — stable per reply, so dismissal and identity survive. */
  id: string;
  /** Verbatim passage, resolved the same way every other anchor is. */
  quote: string;
  /** Which reply it came from, so a click can scroll to that point. */
  turn: number;
}

export interface ResolvedNote {
  id: string;
  turn: number;
  /** Start of the block the passage lives in. Mapped through every edit. */
  pos: number;
  status: "active" | "orphaned";
}

export interface HighlightState {
  issues: Issue[];
  notes: ResolvedNote[];
  /**
   * What was just replaced from the conversation.
   *
   * A substitution in the middle of a long document is a change you would
   * otherwise have to go hunting for — the writer clicked a button in a panel
   * and something moved several paragraphs away. Mapped through edits like
   * everything else, and cleared the moment the writer types, because by then
   * they have found it.
   */
  flash: { from: number; to: number } | null;
  decorations: DecorationSet;
  selectedId: string | null;
}

export const optimizerHighlightKey = new PluginKey<HighlightState>("optimizerHighlight");

export type HighlightAction =
  | { type: "set"; findings: HighlightFinding[] }
  | { type: "notes"; notes: NoteMark[] }
  | { type: "flash"; from: number; to: number }
  | { type: "resolve"; ids: string[] }
  | { type: "dismiss"; ids: string[] }
  | { type: "select"; id: string | null }
  | { type: "clear" };

/** Whitespace-normalised, matching how the parser collapses runs. Used only to
 *  compare what is under a range with what the judge quoted. */
export function normaliseQuote(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

/** The text a range actually covers, normalised the same way. */
export function textAt(doc: PMNode, from: number, to: number): string {
  return normaliseQuote(doc.textBetween(from, to, "\n\n", " "));
}

const SEVERITY_CLASS: { [k: string]: string } = {
  high: "ai-issue-high",
  medium: "ai-issue-medium",
  low: "ai-issue-low",
};

/**
 * Resolve conversation notes to the block each passage sits in.
 *
 * Same resolver as everything else — findAnchor against the doc index — so a
 * quote that resolves in the panel resolves here, and one that does not orphans
 * in both places rather than appearing in one and not the other.
 */
export function resolveNotes(doc: PMNode, notes: NoteMark[]): ResolvedNote[] {
  const index = buildDocIndex(doc);
  const out: ResolvedNote[] = [];
  for (let i = 0; i < notes.length; i++) {
    const n = notes[i];
    const match = findAnchor(index.text, { quote: n.quote });
    if (!match.ok) {
      out.push({ id: n.id, turn: n.turn, pos: 0, status: "orphaned" });
      continue;
    }
    const range = textRangeToPos(index, match.start, match.end);
    if (!range) {
      out.push({ id: n.id, turn: n.turn, pos: 0, status: "orphaned" });
      continue;
    }
    try {
      const $p = doc.resolve(range.from);
      out.push({ id: n.id, turn: n.turn, pos: $p.start($p.depth), status: "active" });
    } catch {
      out.push({ id: n.id, turn: n.turn, pos: 0, status: "orphaned" });
    }
  }
  return out;
}

/**
 * Which notes actually get a marker drawn.
 *
 * ONE per block, however many points the conversation made about it: three dots
 * stacked on one paragraph is clutter, and the click goes to the conversation
 * anyway, where all of them are visible in order. The FIRST note on a block
 * wins, so the marker leads to the earliest thing said about it rather than the
 * most recent — which is the order a reader of the thread expects.
 *
 * Orphans draw nothing. A passage the writer has rewritten no longer exists to
 * point at, and a marker parked at position 0 would sit on the first paragraph
 * pointing at a comment about a different one.
 *
 * Pure, and separate from decorationsFor, so this is assertable without
 * constructing a ProseMirror document.
 */
export function markersFor(notes: ResolvedNote[]): ResolvedNote[] {
  const out: ResolvedNote[] = [];
  const seen: { [pos: number]: true } = {};
  for (let i = 0; i < notes.length; i++) {
    const n = notes[i];
    if (n.status !== "active" || n.pos <= 0 || seen[n.pos]) continue;
    seen[n.pos] = true;
    out.push(n);
  }
  return out;
}

function decorationsFor(
  doc: PMNode,
  issues: Issue[],
  selectedId: string | null,
  notes: ResolvedNote[],
  flash?: { from: number; to: number } | null
): DecorationSet {
  const decos: Decoration[] = [];
  for (let i = 0; i < issues.length; i++) {
    const issue = issues[i];
    if (issue.status !== "active") continue;
    if (issue.to <= issue.from) continue;
    const cls =
      "ai-issue " + (SEVERITY_CLASS[issue.finding.severity] || SEVERITY_CLASS.medium) +
      (selectedId === issue.finding.id ? " ai-issue-selected" : "");
    decos.push(
      Decoration.inline(issue.from, issue.to, {
        class: cls,
        "data-issue-id": issue.finding.id,
      })
    );
  }
  // ── Margin markers ────────────────────────────────────────────────────
  const markers = markersFor(notes);
  for (let i = 0; i < markers.length; i++) {
    const n = markers[i];
    const turn = n.turn;
    decos.push(
      Decoration.widget(
        n.pos,
        () => {
          const el = document.createElement("button");
          el.type = "button";
          el.className = "ai-note-marker";
          el.setAttribute("data-note-turn", String(turn));
          el.setAttribute("aria-label", "Engine AI commented on this passage");
          el.title = "Engine AI commented on this passage";
          return el;
        },
        // side -1 keeps it before the block's first character, so typing at the
        // start of the paragraph does not land inside the widget. `key` stops
        // ProseMirror rebuilding the DOM node on every unrelated redraw, which
        // would drop a click mid-press.
        { side: -1, key: `note-${n.id}`, ignoreSelection: true }
      )
    );
  }

  if (flash && flash.to > flash.from) {
    decos.push(Decoration.inline(flash.from, flash.to, { class: "ai-just-changed" }));
  }

  return DecorationSet.create(doc, decos);
}

/**
 * Anchor a batch of findings against the current document.
 *
 * Goes through the same doc-index the verify script pins to ParsedDraft.text,
 * so a finding anchored server-side against the parser's text lands on the same
 * characters here. Anything unresolvable becomes an orphan — visible in the
 * panel, no highlight, no Apply. Never a guess.
 */
/**
 * Which statuses a re-anchor must carry forward, keyed by finding id.
 *
 * Split out as a pure function so it can be asserted without constructing a
 * ProseMirror document — the reason the behaviour it encodes went unverified
 * for as long as it did.
 *
 * DISMISSED and RESOLVED carry; ACTIVE and ORPHANED do not. That asymmetry is
 * the point: the first two are decisions a PERSON made about a finding, and
 * re-running a deterministic checker must not overturn them. The last two are
 * facts about the current text, and recomputing them is exactly what a repaint
 * is for — an orphan whose passage the writer restored should light up again.
 */
export function settledStatuses(previous?: Issue[]): { [id: string]: IssueStatus } {
  const out: { [id: string]: IssueStatus } = {};
  if (!previous) return out;
  for (let i = 0; i < previous.length; i++) {
    const st = previous[i].status;
    if (st === "dismissed" || st === "resolved") out[previous[i].finding.id] = st;
  }
  return out;
}

export function anchorFindings(
  doc: PMNode,
  findings: HighlightFinding[],
  previous?: Issue[]
): Issue[] {
  // ── DISMISSAL SURVIVES RE-ANCHORING ──────────────────────────────────────
  //
  // `set` fires on every repaint, and repaintLive fires on every edit, so this
  // function ran fresh on each keystroke and returned "active" for everything —
  // silently resurrecting anything the writer had dismissed one character
  // earlier. live-issues.ts states the opposite in a comment beside the id it
  // builds: "same criterion, same offsets, same id, SO A DISMISSED ISSUE STAYS
  // DISMISSED while the writer edits elsewhere". The id was designed to carry
  // exactly this, and nothing was carrying it: the promise was made in a
  // comment and kept nowhere.
  //
  // Carried by finding ID, which is what makes the design work. A live finding
  // whose text changed gets a NEW id and correctly comes back — the writer
  // changed the thing they dismissed. One whose offsets are untouched keeps its
  // id, and stays dismissed.
  const wasSettled = settledStatuses(previous);

  const index = buildDocIndex(doc);
  const issues: Issue[] = [];
  const claimed: { from: number; to: number }[] = [];

  // Longest first, so a short quote nested inside a longer one cannot claim the
  // region the longer finding is about.
  const order = findings
    .map((f, i) => ({ f, i }))
    .sort((a, b) => (b.f.quote || "").length - (a.f.quote || "").length);
  const out: (Issue | null)[] = new Array(findings.length).fill(null);

  for (let k = 0; k < order.length; k++) {
    const { f, i } = order[k];
    // A dismissed finding takes no range. It paints nothing, so holding one
    // would let a mark the writer has already waved away block a live mark over
    // the same sentence — the second mark orphaning for a reason invisible on
    // screen.
    if (wasSettled[f.id]) {
      out[i] = { finding: f, from: 0, to: 0, status: wasSettled[f.id] };
      continue;
    }
    const match = findAnchor(index.text, { quote: f.quote, prefix: f.prefix, suffix: f.suffix });
    if (!match.ok) {
      out[i] = { finding: f, from: 0, to: 0, status: "orphaned" };
      continue;
    }
    const range = textRangeToPos(index, match.start, match.end);
    if (!range) {
      out[i] = { finding: f, from: 0, to: 0, status: "orphaned" };
      continue;
    }
    // A CONTESTED RANGE IS NOT A VANISHED PASSAGE.
    //
    // This used to mark the loser "orphaned", which the rail renders as
    // "Couldn't find this passage any more — the text has changed since it was
    // assessed." For a range collision every word of that is false: the quote
    // matched, the passage is on screen, and nothing changed.
    //
    // It reached production. stat-source-adjacency and current-year-stats both
    // emit a span on the exact same "43%" token, so on a real document with
    // three figures repeated twice, SIX cards told the writer their text had
    // moved out from under six figures that were still sitting there. The
    // owner's reasonable reading was "what are these?".
    //
    // So the loser is DROPPED rather than mislabelled. Nothing is lost that the
    // reader needs: spans never affect the score, this function already shows
    // only "the worst few" per criterion by design, and the score panel keeps
    // reporting the true count — the criterion still says how many undated
    // figures there are, it just does not draw a second underline under a
    // figure that already has one.
    //
    // Orphaning stays for the case it was written for: a quote that genuinely
    // is not in the text any more. There the message is true.
    let overlaps = false;
    for (let c = 0; c < claimed.length; c++) {
      if (range.from < claimed[c].to && claimed[c].from < range.to) { overlaps = true; break; }
    }
    if (overlaps) continue;
    claimed.push(range);
    const settled = wasSettled[f.id];
    out[i] = {
      finding: f,
      from: range.from,
      to: range.to,
      status: settled ? settled : "active",
    };
  }

  for (let i = 0; i < out.length; i++) if (out[i]) issues.push(out[i] as Issue);
  return issues;
}

export const OptimizerHighlight = Extension.create({
  name: "optimizerHighlight",

  addProseMirrorPlugins() {
    return [
      new Plugin<HighlightState>({
        key: optimizerHighlightKey,

        state: {
          init(): HighlightState {
            return { issues: [], notes: [], flash: null, decorations: DecorationSet.empty, selectedId: null };
          },

          apply(tr: Transaction, prev: HighlightState, _old: EditorState, next: EditorState): HighlightState {
            const action = tr.getMeta(optimizerHighlightKey) as HighlightAction | undefined;

            if (action && action.type === "set") {
              // Notes are CARRIED, not rebuilt. `set` fires on every repaint;
              // dropping them here would make the margin markers flicker out on
              // every keystroke and only return when the writer asked another
              // question.
              const issues = anchorFindings(next.doc, action.findings, prev.issues);
              return {
                issues,
                notes: prev.notes,
                decorations: decorationsFor(next.doc, issues, prev.selectedId, prev.notes, prev.flash),
                selectedId: prev.selectedId,
                flash: prev.flash,
              };
            }
            if (action && action.type === "flash") {
              const flash = { from: action.from, to: action.to };
              return {
                issues: prev.issues,
                notes: prev.notes,
                decorations: decorationsFor(next.doc, prev.issues, prev.selectedId, prev.notes, flash),
                selectedId: prev.selectedId,
                flash,
              };
            }
            if (action && action.type === "notes") {
              const notes = resolveNotes(next.doc, action.notes);
              return {
                issues: prev.issues,
                notes,
                decorations: decorationsFor(next.doc, prev.issues, prev.selectedId, notes, prev.flash),
                selectedId: prev.selectedId,
                flash: prev.flash,
              };
            }
            if (action && action.type === "clear") {
              return { issues: [], notes: [], flash: null, decorations: DecorationSet.empty, selectedId: null };
            }

            let issues = prev.issues;
            let notes = prev.notes;
            let selectedId = prev.selectedId;
            // Cleared as soon as the writer types: by then they have found it,
            // and a highlight that outstays its welcome becomes a mark they
            // have to work out how to remove.
            const flash = tr.docChanged ? null : prev.flash;

            if (action && (action.type === "resolve" || action.type === "dismiss")) {
              const status: IssueStatus = action.type === "resolve" ? "resolved" : "dismissed";
              issues = issues.map((i) =>
                action.ids.indexOf(i.finding.id) >= 0 ? { ...i, status } : i
              );
              if (selectedId && action.ids.indexOf(selectedId) >= 0) selectedId = null;
            }
            if (action && action.type === "select") {
              selectedId = action.id;
            }

            // THE REDUCER THAT MAKES HIGHLIGHTS SURVIVE TYPING.
            //
            // Every active range is mapped through this transaction. A range
            // whose ends were deleted, or which has collapsed, becomes an
            // orphan rather than a highlight over whatever text moved into its
            // place — the difference between losing a highlight and pointing at
            // the wrong sentence.
            if (tr.docChanged) {
              issues = issues.map((issue) => {
                if (issue.status !== "active") return issue;
                const from = tr.mapping.mapResult(issue.from, 1);
                const to = tr.mapping.mapResult(issue.to, -1);
                if (from.deleted || to.deleted || to.pos <= from.pos) {
                  return { ...issue, from: 0, to: 0, status: "orphaned" as IssueStatus };
                }
                return { ...issue, from: from.pos, to: to.pos };
              });

              // Markers move with their paragraph. Mapped rather than
              // re-resolved, for the reason the issue reducer above documents:
              // a mapped position follows the text through the edit, while
              // re-resolving mid-keystroke would search a half-typed word and
              // orphan a marker whose paragraph never went anywhere.
              notes = notes.map((n) => {
                if (n.status !== "active") return n;
                const mapped = tr.mapping.mapResult(n.pos, -1);
                if (mapped.deleted) return { ...n, pos: 0, status: "orphaned" as const };
                return { ...n, pos: mapped.pos };
              });
            }

            if (issues === prev.issues && notes === prev.notes && flash === prev.flash && selectedId === prev.selectedId && !tr.docChanged) {
              return prev;
            }
            return { issues, notes, flash, decorations: decorationsFor(next.doc, issues, selectedId, notes, flash), selectedId };
          },
        },

        props: {
          decorations(state) {
            const s = optimizerHighlightKey.getState(state);
            return s ? s.decorations : DecorationSet.empty;
          },
          handleClick(view, pos) {
            const s = optimizerHighlightKey.getState(view.state);
            if (!s) return false;
            for (let i = 0; i < s.issues.length; i++) {
              const issue = s.issues[i];
              if (issue.status !== "active") continue;
              if (pos >= issue.from && pos <= issue.to) {
                view.dispatch(
                  view.state.tr.setMeta(optimizerHighlightKey, { type: "select", id: issue.finding.id })
                );
                return false; // let the caret land too — this is not a modal
              }
            }
            return false;
          },
        },
      }),
    ];
  },
});

export type ApplyResult =
  | { ok: true; from: number; to: number }
  | { ok: false; reason: "unknown" | "not-active" | "no-replacement" | "deleted" | "drifted" };

/**
 * Apply a finding's suggested rewrite.
 *
 * Three rules, each of which prevents a different way of damaging the writer's
 * text:
 *
 *  - The range comes from PLUGIN STATE, already mapped through every
 *    transaction since the assessment. The judge's original offsets are stale
 *    the moment anything is typed and must never be consulted here.
 *  - REVALIDATE before replacing. A range can map cleanly and still cover text
 *    the writer has since changed — mapping survival is not validity. If the
 *    text under the highlight is no longer what the judge quoted, orphan it and
 *    replace nothing.
 *  - ONE transaction carries both the text change and the resolution, so a
 *    single undo restores both. Two transactions would let undo resurrect the
 *    old text with no highlight, or the highlight with no text.
 */
export function applyFinding(
  editor: { state: EditorState; view: { dispatch: (tr: Transaction) => void } },
  id: string,
  /** An on-demand AI rewrite, generated after the finding was anchored. The
   *  plugin's stored finding cannot be mutated in place, so the caller passes
   *  the edit it obtained; everything else — drift check, resolve, dismissal
   *  of a deleted span — is identical to a baked-in suggestion. */
  overrideEdit?: string
): ApplyResult {
  const state = editor.state;
  const st = optimizerHighlightKey.getState(state);
  if (!st) return { ok: false, reason: "unknown" };

  const issue = st.issues.filter((i) => i.finding.id === id)[0];
  if (!issue) return { ok: false, reason: "unknown" };
  if (issue.status !== "active") return { ok: false, reason: "not-active" };

  const replacement = overrideEdit || issue.finding.suggestedEdit;
  if (!replacement) return { ok: false, reason: "no-replacement" };
  if (issue.to <= issue.from) {
    editor.view.dispatch(state.tr.setMeta(optimizerHighlightKey, { type: "dismiss", ids: [id] }));
    return { ok: false, reason: "deleted" };
  }

  if (textAt(state.doc, issue.from, issue.to) !== normaliseQuote(issue.finding.quote)) {
    editor.view.dispatch(state.tr.setMeta(optimizerHighlightKey, { type: "dismiss", ids: [id] }));
    return { ok: false, reason: "drifted" };
  }

  const tr = state.tr;
  tr.insertText(replacement, issue.from, issue.to);
  tr.setMeta(optimizerHighlightKey, { type: "resolve", ids: [id] });
  editor.view.dispatch(tr);

  return { ok: true, from: issue.from, to: issue.from + replacement.length };
}

/**
 * Which producer a finding came from, from its id.
 *
 * ONE function, because the same prefix test was written out in three places —
 * IssueList counted with it twice and IssuePopover labelled with it once — and
 * each copy said "live, or else judge". That binary was fine while there were
 * two producers. The moment a third exists, every copy silently files it as a
 * judge finding, and only the copy somebody remembered to update disagrees.
 *
 * `talk:` is the conversation's own findings. Nothing emits them yet; the
 * branch exists so the classification is total from the start rather than
 * being retrofitted into three call sites later.
 */
export function findingSource(id: string): "live" | "judge" | "talk" {
  if (id.indexOf("live:") === 0) return "live";
  if (id.indexOf("talk:") === 0) return "talk";
  return "judge";
}
