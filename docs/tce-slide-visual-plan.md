# Making generated decks visual

Plan, 2026-08-18. Companion to `docs/tce-slide-brand.md`, which fixes the brand;
this fixes what we do with it.

## 1. What the shared deck actually does — measured

Image area per slide in the Galderma deck, as a percentage of the canvas:

| Slide | Role | Image area | Composition |
|---|---|---|---|
| 1 | Cover | **106%** | full-bleed photo, logo + title over it |
| 5 | Process | **100%** | full-bleed diagram |
| 10, 11 | Divider | **88%** | full-bleed photo on blue |
| 16 | Format gallery | 57% | image grid |
| 14, 15 | Format gallery | 52% | image grid, 10–11 thumbnails |
| 17 | Reports | 50% | image grid |
| 2 | WEF growth | 49% | chart image + supporting shots |
| 8, 9 | Case study | ~30% | one hero image + logos |
| 3 | Topic expertise | 31% | **36-thumbnail** grid over a photo background |
| 6 | Content Units | 31% | 11 product thumbnails |
| 4 | Three pillars | 3.6% | icons only — the least visual slide in the deck |

Two findings that should drive everything below.

**Their decks are pictures with captions, not text with decoration.** Eleven of
eighteen slides are over 30% image; four are essentially all image. Our generator
supports **no images at all** — the photo-led cover and closing layouts fall back
to solid navy.

**There is not one native chart or table in the deck.** Every "graph" — the WEF
growth curve, the Holcim follower chart — is a **pasted screenshot**. So the
visual bar to clear is low, but the correctness bar is on the floor: a pasted
chart cannot be re-coloured, re-labelled, corrected, or read by a screen reader.

## 2. What we generate today

Seven text layouts plus two drawn timelines. Measured against the same yardstick,
a generated content slide is roughly **0% image, 100% text**, and — as the earlier
renders showed — routinely leaves the bottom third to half of the slide empty.

The timeline work already proves the technique that everything here needs: real
shapes, positioned from tokens, drawn through `batchUpdate`. Charts are the same
problem with different geometry.

## 3. Principles this is anchored to

Not taste — named, checkable rules.

- **Assertion–evidence** (Michael Alley). A slide title is a *sentence stating the
  point*, and the body is visual evidence for it. "Follower growth tripled after
  daily publishing" over a chart, not "LinkedIn Performance" over bullets. This
  single rule forces visuals: an assertion needs evidence, and evidence is rarely
  a bulleted list.
- **The Glance Test** (Nancy Duarte, *slide:ology*). Every element either amplifies
  the signal or adds noise; an audience cannot read dense text and listen at the
  same time. Three to five colours, one or two typefaces, one idea per slide.
- **Data-ink ratio and chartjunk** (Edward Tufte). Ink belongs to data. No 3-D
  bars, no gradients-for-decoration, no heavy gridlines, no redundant legends.
- **The form follows the job** (`dataviz` skill; Knaflic). Magnitude, identity,
  polarity, change-over-time, or a single headline each pick a different form —
  and the honest answer is often **not a chart** but one large number.

## 4. The chart palette, computed rather than chosen

The brand accents **fail** as a categorical chart palette. Run for yourself:

```bash
node scripts/validate_palette.js "#3950FF,#01EAC8,#C0FF7E,#FF6255,#8488FD,#114535" --mode light
```

> FAIL lightness band (#01EAC8, #C0FF7E, #114535) · FAIL chroma floor (#114535
> reads grey) · WARN contrast: #C0FF7E is **1.15:1** against a light slide

That is expected and not a brand problem: lime and mint are display accents meant
for large shapes on blue, not 2px lines on off-white.

Two derived sets that pass all six checks, keeping the brand's blue as series one:

**Light slides (#F8F8F8 / white)** — `ALL CHECKS PASS`
```
#3950FF  #B36B00  #00998A  #8E44AD  #D6342A
```

**Navy slides (#023250)** — `ALL CHECKS PASS`
```
#6B7BFF  #B87C1C  #1CA48F  #9A70C6  #E8604F
```

Order matters and is not decorative: the two warm hues are deliberately kept
non-adjacent, because red beside orange failed CVD separation at ΔE 1.8 while the
same five reordered pass at 13.8.

Rules that come with the palette, and should be enforced in code rather than
suggested in a prompt: hues assigned in fixed order and never cycled; a sixth
series folds into "Other" or becomes small multiples; **never a dual axis**;
sequential = one hue light→dark; diverging = two hues with a grey midpoint.

## 5. The plan

### Phase 1 — Images (biggest gap, largest gain)

1. **`image` on a slide**, plus the layouts that use one:
   - `photo-cover` / `photo-closing` — full-bleed image, scrim, text over it
   - `image-split` — image one side, text the other (the 50/50 the deck uses most)
   - `image-grid` — 2×2 up to 4×3 thumbnails, for format galleries and examples
   - `feature` — full-bleed image with a single overlaid assertion
2. **A scrim is mandatory, not stylistic.** Text over photography gets a gradient
   overlay, and the rule is measurable: body text ≥ 4.5:1 against the underlying
   image's mean luminance in that region. Sample the image server-side and pick
   the scrim strength; do not guess.
3. **Where images come from** — this needs Chris's decision, see §6.
4. **`preview-model.ts` already handles images**, so the in-chat preview gets this
   free. `createImage` is already proven by the logo.

### Phase 2 — Charts drawn natively

Same mechanism as the timeline: shapes positioned from tokens.

| Job | Form | Notes |
|---|---|---|
| Single headline | **stat tile** — one very large number, Poppins, plus a caption | Often the right answer; no plot at all |
| Magnitude / ranking | **horizontal bar** | Sorted, direct value labels, no x-gridlines |
| Change over time | **line** | 2px, ≤4 series, direct end-labels rather than a legend |
| Composition | **stacked bar**, single row | 2px surface gap between segments |
| Comparison across items | **small multiples** | The answer whenever a second axis is tempting |

Deliberately **not** offered: pie beyond two slices, doughnuts, 3-D anything,
dual-axis. Refusing to draw them is the feature — the model cannot chartjunk what
the tool will not render.

Complex or one-off charts fall back to `generate_chart` as an image, and that
fallback must be reported, not silent.

### Phase 3 — Layout intelligence

1. **Assertion titles.** Prompt for a sentence that states the point; a noun-phrase
   title on an evidence slide is a smell.
2. **Vertical composition.** Blocks size to content and the group centres in the
   canvas, so a three-bullet slide stops leaving half the slide empty.
3. **Overflow splits the slide** rather than shrinking type. More than six bullets
   or ~320 characters of body becomes two slides.
4. **A deck-level check** in the tool result: what proportion of slides carry a
   visual? A ten-slide deck of pure text should come back with that noted, so the
   model offers to fix it rather than shipping it.

## 6. Decisions needed

1. **Where do photographs come from?** Three options, and it decides Phase 1's shape:
   - *Generate* via the existing gpt-image-1 path — always on-brief, no licensing
     question, costs a few seconds per slide, and can look synthetic.
   - *Artlist* — already integrated (`lib/integrations/artlist.ts`), licensed, real
     photography, needs a search-and-pick step.
   - *A curated TCE library in Blob* — fastest and most on-brand, needs someone to
     curate it once.
   My recommendation: curated library first, generation as the fallback when
   nothing matches. Artlist is the best long-term answer but adds a picking step
   to a flow whose whole appeal is that it is one message.
2. **Client-brand decks?** `ai_client_context.visual_identity` already models
   per-client palettes. Every palette would need re-validating — the brand's own
   accents failed, and a client's will too.
3. **How far to push assertion titles?** They make decks better and read as less
   "corporate agency". Worth confirming that is the house voice before enforcing.
