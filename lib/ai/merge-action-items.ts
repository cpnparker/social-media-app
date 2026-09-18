/**
 * Deterministic, LOSSLESS backstop for near-duplicate digest action items.
 *
 * The Live digest prompt asks the model to consolidate same-workstream items,
 * but eval shows small models either merge-and-drop a step or keep the split
 * (the 2026-07-30 session shipped "Ping Gary regarding salary details…" and
 * "Share the document with Gary and confirm the redundancy withdrawal…" as two
 * tasks). This pass merges what the model still split, by concatenation — the
 * one operation that cannot lose a commitment.
 *
 * Merge condition: same owner AND the items share enough content words
 * (overlap coefficient ≥ 0.5 with at least 3 shared stems). Both texts are
 * kept in full, joined by "; ".
 */

export interface DigestActionItem {
  owner?: string | null;
  item?: string | null;
  due?: string | null;
}

const STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'to', 'of', 'in', 'on', 'for', 'with', 'about',
  'at', 'by', 'from', 'into', 'over', 'after', 'before', 'once', 'when', 'then',
  'is', 'are', 'was', 'be', 'been', 'will', 'would', 'should', 'need', 'needs',
  'it', 'its', 'this', 'that', 'them', 'him', 'her', 'his', 'their', 'our', 'us',
  'up', 'out', 'how', 'what', 'regarding', 're',
]);

/** Lowercased content words, lightly stemmed so withdrawing/withdrawal agree. */
function contentStems(text: string): Set<string> {
  const out = new Set<string>();
  for (const raw of String(text || '').toLowerCase().split(/[^a-z0-9]+/)) {
    if (!raw || raw.length < 3 || STOPWORDS.has(raw)) continue;
    out.add(raw.replace(/(?:ing|ed|al|s)$/, ''));
  }
  return out;
}

const MIN_SHARED_STEMS = 3;
const MIN_OVERLAP_COEFFICIENT = 0.5;

/** Owner labels the digest uses for unnamed people — never merge inside them. */
const COARSE_OWNERS = new Set(['us', 'client', 'we', 'team']);

function sameWorkstream(a: Set<string>, b: Set<string>): boolean {
  if (a.size === 0 || b.size === 0) return false;
  let shared = 0;
  a.forEach((w) => { if (b.has(w)) shared++; });
  return shared >= MIN_SHARED_STEMS && shared / Math.min(a.size, b.size) >= MIN_OVERLAP_COEFFICIENT;
}

/** Earliest parseable due wins; free-text dues fall back to the first stated. */
function earliestDue(a?: string | null, b?: string | null): string | null {
  if (!a) return b || null;
  if (!b) return a;
  const ta = Date.parse(a);
  const tb = Date.parse(b);
  if (Number.isFinite(ta) && Number.isFinite(tb)) return ta <= tb ? a : b;
  return a;
}

export function mergeSameWorkstreamItems(items: DigestActionItem[]): DigestActionItem[] {
  const work = items
    .filter((i) => i && String(i.item || '').trim())
    .map((i) => ({
      owner: i.owner ?? null,
      item: String(i.item).trim(),
      due: i.due ?? null,
      stems: contentStems(String(i.item)),
      ownerKey: String(i.owner || '').trim().toLowerCase(),
    }));

  // Fixpoint: a merged item may in turn overlap a third.
  let merged = true;
  while (merged) {
    merged = false;
    outer: for (let i = 0; i < work.length; i++) {
      for (let j = i + 1; j < work.length; j++) {
        const a = work[i];
        const b = work[j];
        // Ownerless and coarse-bucket items never merge — "us"/"client" can be
        // different people, and a wrong merge muddles two commitments.
        if (!a.ownerKey || COARSE_OWNERS.has(a.ownerKey) || a.ownerKey !== b.ownerKey) continue;
        if (!sameWorkstream(a.stems, b.stems)) continue;
        a.item = `${a.item}; ${b.item}`;
        a.due = earliestDue(a.due, b.due);
        b.stems.forEach((w) => a.stems.add(w));
        work.splice(j, 1);
        merged = true;
        break outer;
      }
    }
  }

  return work.map(({ owner, item, due }) => ({ owner, item, due }));
}
