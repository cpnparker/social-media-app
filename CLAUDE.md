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

## Content Optimizer checks

Ten scripts guard `lib/optimizer/` and the import/export paths. Run all of them
before shipping anything that touches the rubric, the judge, anchoring or how
content gets in:

```
for f in rubric anchors judge gate doc-index highlight import export import-html live; do npx tsx scripts/verify-optimizer-$f.ts || break; done
```

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
