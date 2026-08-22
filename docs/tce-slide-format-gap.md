# What their deck does that ours cannot

Assessment of `The Content Engine introduction for Galderma - June 2026.pptx`,
measured rather than described. Companion to `tce-slide-brand.md` (the brand)
and `tce-slide-visual-plan.md` (the visual plan, phase 1 of which shipped).

## 1. How the deck is actually built

The whole eighteen-slide deck uses five geometric primitives:

| Primitive | Count |
|---|---|
| `rect` | 278 |
| `straightConnector1` | 18 |
| `triangle` | 8 |
| `roundRect` | 6 |
| `ellipse` | 3 |

**No tables. No charts. No exotic shapes.** 194 shapes and 106 images across
eighteen slides. The sophistication is entirely in *composition* — what the
rectangles are arranged into — not in the drawing primitives, every one of
which our generator already emits.

That is the encouraging finding: nothing here needs a capability we lack at the
drawing level. What we lack is the vocabulary of arrangements.

## 2. The devices, and where they appear

| Device | Slides | What it is |
|---|---|---|
| **Card grid** | 4, 6, 12 | Repeated blocks: a coloured label chip over body text, or a thumbnail over a caption. The single most-used device in the deck. |
| **Numbered items** | 12 | `01 / 02 / 03` markers beside short descriptions, with a full-height image down the left. |
| **Process / flow** | 5 | Named stages joined by connectors — IDEATION → COMMISSIONING → PRODUCTION → DISTRIBUTION → ANALYTICS. |
| **CTA button** | 6 | A `roundRect` in brand blue reading "VIEW PORTFOLIO", hyperlinked. |
| **Portfolio gallery** | 14–17 | Thumbnail grids where every tile links to live work. |
| **Annotated chart** | 2, 7 | A chart *image* with callout labels and stat blocks placed over it. |
| **Case study** | 7, 8, 9 | Hero image, client logo, named person with job title, supporting stat. |
| **Topic grid** | 3 | 36 thumbnails grouped under category headings over a photo background. |

### The one that matters most: hyperlinks

**45 hyperlinks across eight slides.** Slides 13–17 are a portfolio whose entire
function is linking to work — "Content Examples (hyperlinked)", "Written,
ghost-written formats (hyperlinked)". A gallery deck without links is a
contact sheet.

We support none. This is the largest functional gap in the assessment, and it is
not a layout — it is a property that belongs on text and thumbnails everywhere.

## 3. What we have, and what is missing

**Shipped:** cover · section · content · two-column · case-study · dark-index ·
timeline · timeline-parallel · image-split · image-grid · feature · stat ·
bar-chart · stacked-bar · closing.

**Missing, in the order I would build them:**

1. **`card-grid`** — 2–6 cards, each a label chip plus body, or an icon plus
   heading plus body. Covers slides 4, 6 and 12, which is three of the deck's
   most substantial slides with one layout.
2. **Hyperlinks** — on body lines, grid captions and thumbnails. Not a layout;
   a field on existing ones.
3. **`numbered-list`** — `01/02/03` with an optional image column. Currently
   approximated by bullets, which loses the deliberate sequencing.
4. **`process`** — stages joined by connectors, linear or cyclical. We draw
   connectors already in the timelines, so this is arrangement, not capability.
5. **`quote`** — pull quote, attribution, role, optional headshot. The deck
   names people (a Chief Sustainability Officer, a former CEO) and we have
   nowhere to put them.
6. **`logo-wall`** — client logos on a neutral ground, the standard credibility
   slide, and absent from our set entirely.

Deliberately NOT recommended: tables (the deck has none), and any chart type
beyond what shipped — their charts are pasted screenshots, so we are already
ahead there.

## 4. Creative functionality, beyond layouts

- **Hyperlinks.** Confirmed supported via `updateTextStyle` with `link`. One
  trap: setting a link forces the theme hyperlink colour and an underline, so
  the brand colour must be re-applied in the same request's `fields` or every
  link turns blue-and-underlined and the deck stops looking like theirs.
- **Icons.** Their cards carry small pictograms. We have no icon source. A
  curated set in Blob, addressed by name, is the cheap version; generating them
  is not — icons must be consistent across a deck and generation is not.
- **Connectors.** Already drawn for timelines; a `process` layout mostly reuses
  that code.
- **Element-level links** (a link on a thumbnail rather than on text) — I could
  not confirm API support and have not assumed it. Worth checking before
  designing the gallery around it; text links are certain.

## 5. What this changes about "best in class"

Their deck is not better than ours because of any single slide. It is better
because it has **a wider vocabulary of arrangements** and because its portfolio
slides *do something* — they link.

Two layouts (`card-grid`, `numbered-list`) plus hyperlinks would cover the
majority of what the Galderma deck does and we cannot. `process`, `quote` and
`logo-wall` close the rest.

Where we are already ahead, and should stay: every chart in their deck is a
screenshot that cannot be relabelled, recoloured or read aloud. Ours are drawn
from data, on a palette validated for colour-blindness.
