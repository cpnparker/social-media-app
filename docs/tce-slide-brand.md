# The Content Engine — slide brand definition

Extracted 2026-08-18 from `The Content Engine introduction for Galderma - June 2026.pptx`
(a Google Slides export), cross-checked against the Dec 2025 generic EUR proposal deck
and the CHF membership proposal deck. Values that appear identically in all three are
marked **canonical**; values that appear in only one are drift and are called out.

## 1. Canvas

| | |
|---|---|
| Slide size | 9144000 × 5143500 EMU = **10 × 5.625 in** (960 × 540 pt), 16:9 |
| Notes size | 6858000 × 9144000 EMU (portrait) |

This is Google Slides' default page size, so a deck built through the Slides API needs no
page resize.

**Grid** (from the layout placeholders, all three decks agree):

| Element | Value |
|---|---|
| Left / right margin | **0.34 in** |
| Content column width | **9.32 in** |
| Title baseline (content slide) | y = 1.22 in, height 0.63 in |
| Body block (content slide) | y = 1.85 in, height 2.81 in |
| Title-slide title block | y = 0.81 in, height 2.24 in, centred |
| Title-slide subtitle block | y = 3.10 in, height 0.87 in, centred |
| Slide-number placeholder | 0.6 × 0.43 in, bottom-right (9.27, 5.10) or bottom-left (0.20, 5.18) |

## 2. Colour

Two paired themes ship in every TCE deck — a light one (`Simple Light`) and a dark one
(`Slate`). They are the same nine colours with the roles inverted, which is the actual
brand system.

### Canonical palette

| Token | Hex | Role |
|---|---|---|
| `navy` | **#023250** | Primary dark. Text on light backgrounds; dark slide backgrounds. Exact logo colour. |
| `blue` | **#3950FF** | Primary brand colour. Section/divider slide backgrounds, headings, emphasis. |
| `teal` | **#01EAC8** | Accent (light theme) |
| `teal-soft` | **#3FEFD7** | Accent (dark theme variant of the same role) |
| `periwinkle` | **#8488FD** | Accent |
| `lime` | **#C0FF7E** | Accent — the standout callout colour on blue backgrounds |
| `coral` | **#FF6255** | Accent |
| `forest` | **#114535** | Accent |
| `grey-light` | **#EBEBEB** | Light surface; body text *on* blue/navy backgrounds |
| `ink` | **#272727** (light theme) / **#292929** (dark theme) | Near-black text |
| `white` | **#FFFFFF** | |
| `off-white` | **#F8F8F8** | The actual background of most content slides |

### Theme role mapping

| OOXML slot | Light ("Simple Light") | Dark ("Slate") |
|---|---|---|
| dk1 (text) | #023250 | #FFFFFF |
| lt1 (bg) | #FFFFFF | #EBEBEB |
| dk2 | #EBEBEB | #3950FF |
| lt2 | #272727 | #023250 |
| accent1 | #3950FF | #C0FF7E |
| accent2 | #01EAC8 | #3FEFD7 |
| accent3 | #8488FD | #8488FD |
| accent4 | #C0FF7E | #FF6255 |
| accent5 | #FF6255 | #114535 |
| accent6 | #114535 | #292929 |
| hyperlink | #0097A7 | #FFD966 |

### Backgrounds actually used, by slide type

| Slide type | Background |
|---|---|
| Title / cover | Full-bleed photograph, no overlay tint |
| Section divider | **#3950FF** solid |
| Standard content | **#F8F8F8** solid |
| Dark content / index | **#023250** solid |
| Full-bleed feature | Photograph |
| Closing | Full-bleed photograph |

### Drift to ignore (do NOT copy into the token set)

- `#3B39FF` — appears 62× in the Galderma deck as a near-miss of #3950FF. Copy-paste drift.
- `#203659` — a second navy used for body text on some case-study slides. Not in any theme.
- `#158158 / #058DC7 / #50B432 / #ED561B / #EDEF00 / #24CBE5` and
  `#4285F4 / #FFAB40 / #0097A7` — Google's stock chart and "Simple Light" default palettes,
  carried in on imported slides. Not brand.

## 3. Typography

| Role | Font | Weight | Size (on the 10 in canvas) | Colour |
|---|---|---|---|---|
| Cover title | **Playfair Display** | Regular | 30 pt | #EBEBEB on photo |
| Section title | **Playfair Display** | Regular | 23–26 pt | #FFFFFF on blue |
| Slide title | **Playfair Display** | Regular | 19–21 pt | #023250 on light |
| Card / item heading | **Playfair Display** | Regular | 11 pt | #3950FF |
| Eyebrow / kicker | **Roboto** | Bold, ALL CAPS | 11 pt | #023250 or #FFFFFF |
| Cover kicker | **Roboto** | Regular, ALL CAPS | 12 pt | #EBEBEB |
| Label / stage name | **Roboto** | Bold, ALL CAPS | 10–15 pt | #3950FF |
| Body | **Roboto Light** | Light | 10 pt | #203659 / #202020 |
| Body (on dark) | **Roboto** | Regular | 10 pt | #FFFFFF or #C0FF7E for emphasis |
| Caption / annotation | **Roboto Light** or **Roboto** | 7–9 pt | #000000 / #203659 |
| Big statistics | **Poppins** | Regular | 6–8 pt labels, large for the number | #FFFFFF |
| Source note | **Roboto** | Regular | 7 pt | inherited |

The type scale is deliberately small — a dense agency deck. Expressed as a ratio of canvas
width it is: cover title 3.0%, slide title 2.0%, body 1.0%.

Fonts are embedded in the source deck (`ppt/fonts/*.fntdata`): Playfair Display (Regular /
Medium / SemiBold), Roboto (Light / Regular / Medium / SemiBold / ExtraBold), Poppins,
Montserrat Medium, Crimson Text, Oswald, Average. Only the first three matter. **All three
are Google Fonts**, so they are available natively in Google Slides with no font upload —
this is the single biggest reason to target Slides rather than a rendered format.

Ignore stray `Arial` (33 runs) and `Calibri` (8 runs) — imported-slide residue.

## 4. Logo

Three variants, all the same lockup (dotted-ring "C" mark + `The **Content** Engine`
wordmark, mark and wordmark separated by a thin vertical rule):

| Variant | Colour | Use |
|---|---|---|
| Navy | **#023250** exactly | On #F8F8F8, #FFFFFF, #EBEBEB |
| White | #FFFFFF | On #3950FF, #023250, photography |
| White, light dots | #FFFFFF mark with reduced-opacity ring | Alternate on photography |

Native raster 1076 × 470 px, **aspect ratio 2.29 : 1**.

Already in this repo at `public/assets/logo_engine_text_blue.{svg,png}` and
`logo_engine_text_white.{svg,png}` (the SVGs use `fill="#023250"` — confirms the navy).

### Placement convention (consistent across every content slide)

| Context | Position (in) | Size (in) |
|---|---|---|
| Standard content slide | (8.69, 0.19) | 1.06 × 0.46 — top-right, 0.25 in from right edge |
| Cover slide | (4.06, 0.77) | 1.79 × 0.78 — centred, upper third |
| Closing slide | (4.32, 4.47) | 1.47 × 0.57 — centred, lower third |

Section-divider slides carry **no** logo.

A decorative full-width rule strip (1920 × 101 px, drawn at 4.40 × 0.55 in or 10.44 × 0.55 in)
is used as a separator on multi-column and footer slides.

## 5. Layout inventory

The source deck resolves to seven layout archetypes. These are what a template should expose:

1. **Cover** — full-bleed photo, centred Playfair title, centred Roboto caps kicker, centred logo.
2. **Section divider** — solid #3950FF, large Playfair title, no logo, optional numbered index (`01 / 02 / 03` in lime).
3. **Title + body** — #F8F8F8, Playfair title at 1.22 in, Roboto Light body from 1.85 in.
4. **Title + two columns** — title, two 4.37 in columns from 1.26 in, or 3.33 in sidebar + 4.37 in main.
5. **Case study** — #F8F8F8, `CASE STUDY` eyebrow in Roboto Bold caps, Playfair title, body, supporting chart/photo.
6. **Dark index / gallery** — #023250 background, Playfair item headings in #3B39FF→#3950FF, thumbnail grid.
7. **Closing** — full-bleed photo, "Thank You" in Playfair, `www.thecontentengine.com`, centred logo.

---

# Plan — Google Slides generation in EngineAI

## What already exists

- `generate_document` (`lib/ai/providers.ts:985`) already makes a **.pptx** via pptxgenjs with
  four generic themes (`professional / modern / bold / minimal`) defined at
  `lib/ai/providers.ts:3402`. **None of them is TCE brand.**
- Google service account auth: `lib/gdrive/auth.ts` (JWT, hard-coded `drive.readonly`) and a
  second SA credential blob `GOOGLE_SERVICE` used by `app/api/google-docs/insert/route.ts`
  with the `documents` scope — precedent for a service-account *write*.
- User Google OAuth: `lib/connections/google-oauth.ts`. Deliberately mirrors MeetingBrain's
  grant and is **entirely read-only** (`calendar.readonly`, `documents.readonly`,
  `gmail.readonly`, `drive.metadata.readonly`).
- `googleapis@171` is already a dependency.

## Decision (2026-08-18): decks are created in the user's own Drive

Settled with Chris. Files belong to the person who asked for them — they appear in their
Drive, under their ownership, with no service-account intermediary.

### The scope to add: `drive.file` only

Add exactly one scope to `GOOGLE_SCOPES` in `lib/connections/google-oauth.ts`:

```
https://www.googleapis.com/auth/drive.file
```

That is sufficient. `presentations.create` and `presentations.batchUpdate` both accept
`drive.file` as an authorising scope, so no Slides-specific scope is needed.

**Do not** add `https://www.googleapis.com/auth/presentations` (sensitive → OAuth app
verification, video demo, ~10 day review) or `https://www.googleapis.com/auth/drive`
(restricted → verification plus an annual CASA security assessment). `drive.file` is
classified **non-sensitive**, so it carries no verification requirement at all.

### Why this is safe against the MeetingBrain shared grant

The warning in `google-oauth.ts` is about *narrowing* the list. Adding is a different case:

- The new list is a strict **superset** of MeetingBrain's — every scanner scope survives, so
  nothing over there can silently lose access.
- `app/api/connections/google/start/route.ts:60` already sets `include_granted_scopes=true`,
  so a re-consent returns a grant covering old **and** new scopes rather than replacing them.
- Existing refresh tokens are **not** invalidated. Users who never re-run Engine's connect
  flow keep working exactly as before, on their current narrower grant.

### The one real migration cost

Already-connected users hold a grant without `drive.file`, so slide generation will fail for
them until they reconnect. This is per-user and detectable rather than guesswork: the callback
persists the granted scope string on the account row
(`app/api/connections/google/callback/route.ts:125`). So:

- Check `scope` for `drive.file` before offering the tool.
- If absent, return a "reconnect Google to enable slides" prompt pointing at the existing
  connect flow. `prompt=consent` is already set, so the reconnect actually re-prompts.

## Consequence: the template-copy approach no longer works

This is the real cost of the decision, and it changes the build.

`drive.file` grants access only to files **the app itself created**, or that the user
explicitly hands over via the Google Picker. A template deck sitting in a TCE Drive is
neither. `drive.files.copy` against it returns **404 File Not Found** — a known and currently
open Google issue (issuetracker #396344374), not something to code around.

So "keep a designer-editable master deck in Drive and copy it" is off the table unless we
either take the restricted `drive` scope or add a one-time Picker step. Neither is worth it.

### Revised approach: render from brand tokens in code

Build the deck from `lib/slides/brand.ts` — the §2–§4 tokens as typed constants — rather than
from a Drive template. Two viable routes:

**Route 1 — native Slides API (recommended).**
`presentations.create` → `batchUpdate` with explicit `createShape` / `insertText` /
`updatePageProperties` calls positioned from the extracted geometry. Produces genuinely native
Slides objects that behave properly when someone edits the deck afterwards. All the numbers
needed are in §1 and §5 above.

**Route 2 — render .pptx, upload with conversion.**
Reuse the existing pptxgenjs path to render a TCE-branded .pptx, then `drive.files.create`
with `mimeType: application/vnd.google-apps.presentation` to convert on import. `drive.file`
covers this because the app creates the file. Attractive because it makes one renderer serve
both the .pptx and Slides outputs — but every slide lands as a loose bag of text boxes rather
than real placeholders, and the round-trip risks drift in exactly the details §2–§4 pin down.

Route 1 costs more code; Route 2 costs fidelity and edit quality. Recommend Route 1, with the
pptx path re-themed separately (step 7) so both share `brand.ts` and cannot diverge.

The thing genuinely lost either way is a template a designer can restyle without a deploy.
Worth revisiting later via a Picker-based "use my template" flow if that becomes a real need.

## Build steps

1. **`lib/slides/brand.ts`** — the §2–§4 tokens as typed constants: palette, type scale,
   grid geometry, logo placements, and the seven layout archetypes from §5. Single source of
   truth for both the Slides and pptx paths.
2. **Add `drive.file`** to `GOOGLE_SCOPES` (`lib/connections/google-oauth.ts:40`).
3. **Scope gating** — helper that reads the stored `scope` on the account row and reports
   whether a user can generate slides; drives both the tool gate and the reconnect prompt.
4. **`lib/slides/generate.ts`** — `presentations.create` → `batchUpdate`, mapping a slide array
   onto the layout archetypes. Uses the *user's* OAuth token via the existing MeetingBrain
   bridge, not the service account. Delete the deck if batchUpdate throws, so a failure leaves
   no half-built file in someone's Drive.
5. **Logo** — Slides' `createImage` needs a publicly-fetchable raster URL (no SVG).
   `public/assets/logo_engine_text_{blue,white}.png` already exist and are already served;
   confirm they are the 2.29:1 lockup and not a cropped variant before wiring.
6. **New tool `generate_slides`** in `lib/ai/providers.ts`, beside `generate_document`, schema
   near-identical plus a `layout` enum for the seven archetypes. Register at **all five**
   dispatch sites (`~6691`, `~7133`, `~8249`, `~9110`, `~9861`) — a new tool id that misses one
   fails silently.
7. **Re-theme the pptx path** — add a `tce` theme to `THEMES` (`lib/ai/providers.ts:3402`)
   reading from `brand.ts`.
8. **System prompt** — `lib/ai/system-prompts.ts:451,465` currently routes every deck request
   to `generate_document`. Split: Slides when the user wants something editable and shareable,
   .pptx when they want a file.
9. **Deploy** — `vercel deploy --prod` (git push alone does not deploy this project).

## Open questions

- Photography: the cover and closing layouts are photo-led. Placeholder, Drive picker, or a
  generated image via the existing gpt-image-1 path?
- Should decks be client-brandable (`ai_client_context.visual_identity` already models
  per-client palettes in `lib/ai/branded-prompt.ts`), or always TCE-branded? TCE-only is the
  smaller first cut.
