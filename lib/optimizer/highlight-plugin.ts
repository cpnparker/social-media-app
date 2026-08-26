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
  suggestedEdit: string | null;
}

export type IssueStatus = "active" | "orphaned" | "resolved" | "dismissed";

export interface Issue {
  finding: HighlightFinding;
  from: number;
  to: number;
  status: IssueStatus;
}

export interface HighlightState {
  issues: Issue[];
  decorations: DecorationSet;
  selectedId: string | null;
}

export const optimizerHighlightKey = new PluginKey<HighlightState>("optimizerHighlight");

export type HighlightAction =
  | { type: "set"; findings: HighlightFinding[] }
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

function decorationsFor(doc: PMNode, issues: Issue[], selectedId: string | null): DecorationSet {
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
export function anchorFindings(doc: PMNode, findings: HighlightFinding[]): Issue[] {
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
    let overlaps = false;
    for (let c = 0; c < claimed.length; c++) {
      if (range.from < claimed[c].to && claimed[c].from < range.to) { overlaps = true; break; }
    }
    if (overlaps) {
      out[i] = { finding: f, from: 0, to: 0, status: "orphaned" };
      continue;
    }
    claimed.push(range);
    out[i] = { finding: f, from: range.from, to: range.to, status: "active" };
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
            return { issues: [], decorations: DecorationSet.empty, selectedId: null };
          },

          apply(tr: Transaction, prev: HighlightState, _old: EditorState, next: EditorState): HighlightState {
            const action = tr.getMeta(optimizerHighlightKey) as HighlightAction | undefined;

            if (action && action.type === "set") {
              const issues = anchorFindings(next.doc, action.findings);
              return { issues, decorations: decorationsFor(next.doc, issues, prev.selectedId), selectedId: prev.selectedId };
            }
            if (action && action.type === "clear") {
              return { issues: [], decorations: DecorationSet.empty, selectedId: null };
            }

            let issues = prev.issues;
            let selectedId = prev.selectedId;

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
            }

            if (issues === prev.issues && selectedId === prev.selectedId && !tr.docChanged) {
              return prev;
            }
            return { issues, decorations: decorationsFor(next.doc, issues, selectedId), selectedId };
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
