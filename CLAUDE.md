# Project Memory

## Key Architecture Notes

- EngineAI uses multi-provider AI (Claude/Grok/GPT/Gemini) with streaming SSE
- Image generation: gpt-image-1 (DALL-E 3 fallback) for Claude/GPT/Gemini, native `grok-imagine-image` for Grok; image-to-image (attached reference images: logos, likeness portraits) always via gpt-image-1 edits regardless of chat model
- Images stored in Vercel Blob for permanent URLs
- Markdown → HTML pipeline: `parseSourcesFromContent()` → `formatMarkdown()` → `DOMPurify.sanitize()` → `dangerouslySetInnerHTML`
- AI response CSS classes all prefixed with `.ai-` in `globals.css`

## Slide generation checks

Two scripts guard `lib/slides/`. Run both before shipping anything that touches
a layout, the preview model, or the tool wiring:

```
npx tsx scripts/verify-slide-layouts.ts      # geometry, collisions, logo contrast, preview parity
npx tsx scripts/verify-post-taint-policy.ts  # every registered tool is classified
npx tsx scripts/verify-safe-fetch.ts         # the SSRF guard blocks internal hosts in every notation
```

## Voice checks

```
npx tsx scripts/verify-voice-config.ts --self-test
```

The speech-to-speech model renders its voice FRESH PER RESPONSE, and xAI has no
per-response voice field — voice is session-level only (docs.x.ai, checked
2026-08-24). So one reply must be one response, and a tool turn is structurally
two: the function call ends the first, the answer speaks in the second. If the
model ALSO speaks before the call, both responses carry audio, both are
rendered, and the second can come back as a different speaker. VoiceDock queues
audio from every response onto one cursor back to back, so the change lands
seamlessly — which is why it is reported as the voice changing MID-SENTENCE
rather than as two speakers.

Serializing the responses (ae563a4) stopped them OVERLAPPING. It did not stop
there being two renders. Do not trust the comment at `response.done` claiming
the reply "stays ONE voice, back to back" — serializing made the seam seamless,
not single-voiced.

The check asserts that nothing tells the model to speak before a tool call — in
the assembled prompt for all five gate combinations, AND in every tool
description, because a tool description is prompt text too. On its first run it
caught a live instruction saying the exact opposite ("Before any tool call, say
a SHORT acknowledgment first"), which had been competing with the new rule
rather than replaced by it. A new rule beside a contradicting old one changes
nothing; that is why the check reads the ASSEMBLED prompt rather than diffing
the edit.

Never instruct an ACCENT (c03d4fc): it destabilises the render and produces the
same symptom. British spelling in TEXT is fine; a British accent must come from
the VOICE — and xAI has no British female, `leo` is British male.

## Model and pricing checks


Two scripts guard which model runs and what it is billed at. Run both before
shipping anything that adds a model id, changes a route's model, or touches
the rate table:

```
npx tsx scripts/verify-model-ids.ts --self-test   # registry, rates and labels agree
npx tsx scripts/verify-model-params.ts            # sampling vs thinking per model
```

`verify-model-ids` exists because BOTH lookups fail soft. `getModelInfo`
answers an unknown id with claude-sonnet-5; `calculateCostTenths` prices an
unknown id at the claude-sonnet-4-6 fallback. Neither throws. So a half-added
model routes somewhere else at a different price and reports nothing — the
plan's own `gpt-5-6-luna` was an id that existed in no table, and writing it
into a routing constant would have sent the cheap tier to Sonnet 5 at fifteen
times the intended price while the ledger looked perfectly healthy.

Adding a model id touches five files and four of them fail silently. The check
asserts they agree, and it queries the tables through the same functions the
app calls rather than grepping for lines — a regex proving a line EXISTS once
reported a live security hole here as closed.

`RATE_EXPIRIES` in `lib/ai/model-costs.ts` holds rates with a known end date,
and check 6 fails once one is past it. A promotional rate is a correct rate
that becomes wrong on a schedule, and nothing in a running system notices the
day it turns; the reminder has to be the build, not somebody's memory. The one
live entry is gemini-3-flash: $0.75/$3.75 doubles on 2027-01-01.

Verify a rate against the PROVIDER's own page before adding an expiry for it.
Sonnet 5's $2/$10 was introductory and a cached June pricing table still says
it reverts to $3/$15 on 1 September — but Anthropic made it permanent on
2026-08-10. An expiry added on the strength of the stale table would have
fired in a week on a day nothing happened, and a check that cries wolf is
worse than no check at all.

`--self-test` drives every detector against synthetic bad input and refuses to
report anything if one fails to fire. Use it rather than break-test-restore:
this working tree is shared with other sessions and also deploys, and a
deliberate break has already reached production from here once. It earns its
keep — it caught two live faults (deepseek-chat still selectable a month after
DeepSeek retired the alias; grok-4.3 and grok-4.6 billing at the $3/$15
fallback) and one wrong assertion of my own.

## Expired-CU write-off checks

One script guards `lib/expired-cus.ts`, which decides what the operations
dashboards' "Hide expired CUs" toggle removes from the totals. Run it before
shipping anything that touches the predicate, the toggle, or the client export:

```
npx tsx scripts/verify-expired-cus.ts --self-test
```

When a contract ends with an unused balance, that balance is booked as a
content item so the contract burns down to zero. Those entries are accounting
adjustments, not produced work, and they are large and lumpy: July 2026 was
109.84 CU commissioned of which 40.74 — 37% — was write-offs, while most
months are 0.

There is NO structured marker for them. They are ordinary `Service` content
identified only by a hand-typed name, in 20 variants across 30 items, so the
predicate is a text heuristic and the check exists to keep it honest in BOTH
directions. Positive fixtures are every real write-off name; negative fixtures
are real content plus deliberately synthetic expiry-worded items that pin the
`Service` type gate. The two failure modes are not symmetric — a missed
write-off leaves an obviously large number on screen, a wrongly-hidden real
item silently under-reports delivered work — which is why the type gate is
exact (`Service Analytics Report` carries real quarterly work) and why new
name patterns should be confirmed per item rather than guessed.

The pattern already missed one: CPI's "RETIRED CONTENT UNITS" (29.68 CU, the
second-largest on record) said nothing about expiry, and its sibling
"Retiring Units — Contract Expiration" was caught only because someone
appended a word. Hence `/expir|retir/i`.

`checkWiring()` asserts the predicate is USED, not merely present — that both
pages apply it and that their `totals` memo reads the filtered list. Pointing
`totals` at the pre-filter list silently restores the inflated number while
tsc, eslint and every fixture assertion stay green; this repo has already
closed a live hole on the strength of a line merely EXISTING.

Deliberately NOT covered, and needing per-item review before anyone widens the
pattern: contract-boundary ledger entries ("Contract adjustment", "Moving CUs
from old contract", ~44 CU over ~64 items — several relocate charges for work
that WAS produced) and the 2022 Engine-V1 migration backfill ("Content units
from V1", 859.50 CU, the single largest row in `app_content`).

## Content Optimizer checks

Fourteen scripts guard `lib/optimizer/` and the import/export paths. Run all of
them before shipping anything that touches the rubric, the judge, anchoring or
how content gets in:

```
for f in rubric anchors judge gate doc-index highlight import export import-html live url page-audit file-import coverage; do npx tsx scripts/verify-optimizer-$f.ts || break; done
```

Two checks in `verify-optimizer-rubric.ts` are about the SET rather than any
one criterion, and exist because nothing tied the engine to the register:
`anonymous-first-person-facts` was emitted from BOTH `pillar3()` and
`pillar4()` in byte-identical blocks, so a pillar renormalised over ten points
belonging to another pillar and read 61 where it should read 55. A duplicated
PASS is invisible in a total. The assertions are that the emitted key set
equals `CRITERIA` exactly, and — the one that pins the real defect — that every
criterion is emitted from the pillar the rubric assigns it. A SINGLE misplaced
copy satisfies every counting check while misreporting two pillars at once.

`verify-optimizer-coverage.ts` tests fan-out coverage and the novelty gap at
their PURE SEAMS, the way `judge.ts` is tested: prompt builders and parsers are
exported, only the route touches the network, and the interesting failures all
live in the response handling. A model asserting coverage it cannot quote is
demoted to uncovered rather than credited; a novelty claim quoting a sentence
that is not in the draft is dropped outright; both count what they discarded.
The parametric prompt must NEVER contain the draft — if it does, novelty is
measured against itself and everything reads as commodity — and the novelty
comparison runs on a DIFFERENT model from the one that produced the answer, so
nothing marks its own homework. That last assertion compares the model ids as
widened strings on purpose: as literal types TypeScript proves the comparison
can never be false, so the check would pass forever after someone pointed both
at the same model.

The live-page audit renders as well as fetches, and the two views answer
different questions. The SERVED HTML is authoritative — the crawlers behind AI
answers mostly do not run JavaScript — so every check reads that. The render
exists for the GAP: content that only appears after JavaScript is invisible to
those crawlers, and nothing in the page's own HTML says so. When the render
does not run, `js-dependency` reports INFO with the reason and never "no gap
found"; not looking and finding nothing are different claims.

Image and heading checks are scoped to the ARTICLE, and this was measured, not
assumed: the Amrize page carries 47 images of which 10 are the article's and 37
are the megamenu and footer. Nav images are template-generated and always
captioned, so unscoped they drag every image verdict toward pass. The same
measurement kills a tempting check — 33 of those 37 never load, because they
are hidden, so a naive "broken images" rule reported 33 failures on a page
whose 10 article images were all fine.

Uploaded `.docx` is the only mammoth caller here that uses `convertToHtml`
rather than `extractRawText`: every other caller feeds a model, which needs
words, while the optimiser scores STRUCTURE. Its check builds a real docx in
memory — content types, relationships, a styles part, a drawing referencing an
embedded PNG — because a mock of mammoth would only assert that the mock works.

Two things about blob storage that cost time to learn. The store is configured
PRIVATE, and `access: "public"` is rejected outright rather than downgraded, so
a public upload fails in production while looking fine in review. And the
`BLOB_READ_WRITE_TOKEN` in `.env.local` is a DIFFERENT, older token pointing at
a public store — image writes therefore fail locally and succeed in production.
Test blob paths with a token pulled from production (`vercel env pull` to a
scratch path, never over `.env.local`, which is shared with other sessions).

Each carries a MUTATION LOG in its header, and each log records survivors as
well as kills — a mutation that survived is a finding about the check, not an
omission to tidy away. Two are already recorded: deleting the BOM strip in
`lib/gdrive/doc-link.ts` changes nothing because `Response.text()` already
strips it, and bypassing `pillar1`'s empty-query branch changes nothing because
the code below skips again on "no usable terms". A third is subtler and worth
reading: in `verify-optimizer-export.ts`, the broad "every word survives"
property is BLIND to the nesting bug most likely to occur — losing a nested
list leaves every word in the output, just in the wrong place. The narrow
structural assertion is what catches it. A round-trip check is not a substitute
for saying what the output should look like.

The layout check builds every layout twice: once with two-line titles and long
labels, because every collision found so far was invisible with short ones, and
once deliberately overloaded — twelve bars, ten stacked categories, five tracks,
eight milestones, a negative value, a date that does not exist. It then asserts
that every Slides request kind the builder emits is read back by `preview-model`
(the preview silently dropping the scrim's alpha is how a correct deck showed a
wrong preview for a day), that the baked gradient clears 4.5:1 at every depth a
layout actually writes at, and that a slide which drops data SAYS SO — that last
one asserted on the string, because a note-free build passes every geometric
check there is.

When you add a check, prove it fails: reintroduce the bug, watch it go red,
then restore. A check asserting that code was WRITTEN rather than USED reported
the post-taint tool narrowing as closed while it was open.

`scripts/` is type-checked by `next build`, and tsconfig sets no `target`, so
ES2015 iteration helpers (`.entries()`, spreading a Set) fail there. Use indexed
loops and `Array.from`.
