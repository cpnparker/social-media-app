# RFP Search Quality Overhaul — Plan

## Root Cause Analysis

The user reported 4 classes of quality issues:
1. **Expired/closed RFPs** — e.g. UNGM notice 274082 (expired), DevelopmentAid tender 1587125 (clearly closed)
2. **Generic portal URLs** — e.g. `unep.org/about-un-environment/procurement` (general procurement page, not a specific RFP)
3. **Aggregator homepages** — e.g. `fundsforngos.org` (just a homepage, not a specific opportunity)
4. **Overall low quality** — too many junk results that waste the user's time

### Why the current system fails:

| Problem | Current behaviour | Root cause |
|---------|------------------|------------|
| Expired RFPs | Deadline filter exists but only checks date, not page content | AI returns expired listings still indexed by Google; page may say "closed" but URL still resolves with 200 OK |
| Portal URLs | URL verification checks if URL resolves + domain trust | No detection of "this is a portal homepage" vs "this is a specific tender notice" |
| Low quality | AI told to cast a "WIDE net" for 8-12+ results | Quantity-over-quality prompt + only 10 web searches = shallow, unreliable results |
| Dead links | HEAD check catches 404s but not "soft 404s" | Pages like DevelopmentAid show 200 OK for closed tenders — the page loads fine, it just says "Closed" |

---

## Implementation Plan (6 changes across 3 files)

### Change 1: Generic URL Detection (url-verification.ts)
**What:** Detect and reject URLs that are portal homepages / search pages rather than specific opportunity listings.

Add a `isGenericPortalUrl()` function that flags URLs matching patterns like:
- Exact match or near-match to any `TRUSTED_PORTALS[].searchUrl`
- Path ends with `/procurement`, `/tenders`, `/tenders/`, `/opportunities` with no ID/slug
- Path has ≤2 segments after domain (e.g. `/about-un-environment/procurement` = generic)
- Known homepage patterns: just `/`, no path at all

When detected:
- Set `sourceUrl = null` (drop the useless URL)
- Set `urlConfidence = "portal_page"` (new tier)
- Auto-populate `portalSearchUrl` from the portal registry as fallback
- Log it so we know how often this happens

### Change 2: Content-Level Verification — "Closed/Expired" Detection (url-verification.ts)
**What:** For URLs that pass the HEAD check, do a lightweight GET request and scan the page text for closure signals.

New function `contentVerifyUrl()`:
- Fetch first ~50KB of page body (not the whole page)
- Search for closure keywords: "closed", "deadline has passed", "no longer accepting", "expired", "awarded", "cancelled", "this tender is closed", "submission period ended"
- Also search for open signals: "submit proposal", "apply now", "deadline:", "closing date:" + future date
- Return a status: `"confirmed_open" | "likely_closed" | "unknown"`

Apply to TOP N results (max 8) to stay within timeout budget. Use parallel requests with 4s timeout.

When `likely_closed`:
- Don't remove the result (it might be wrong) — instead add a `status` field
- The UI will show a warning badge: "May be closed"
- Lower the quality score (Change 5)

### Change 3: Prompt Overhaul (search.ts — buildSearchPrompt)
**What:** Rewrite the AI prompt for quality over quantity.

Key prompt changes:
- **Remove** "Cast a WIDE net" and "Aim for at least 8-12 opportunities" — this directly causes junk results
- **Add** "QUALITY over QUANTITY — 5 genuinely open, relevant opportunities are worth more than 15 stale or generic ones"
- **Add** "Each opportunity MUST have a direct URL to the specific tender/RFP notice page. Do NOT return generic portal URLs like /procurement or /tenders"
- **Add** "Before including an RFP, verify from the search result snippet that it appears to still be open and accepting responses"
- **Add** "Include a 'status' field for each opportunity: 'open' (confirmed still accepting), 'likely_open' (recent posting, no closure signals), or 'uncertain' (couldn't confirm)"
- **Add** explicit negative examples: "Do NOT include: (1) Generic procurement portal pages, (2) RFPs where the search snippet says closed/expired/awarded, (3) URLs that are just portal homepages"
- **Increase max_uses** from 10 → 20 web searches — more searches = can actually verify each result

### Change 4: Status Field on DiscoveredRfp (search.ts types)
**What:** Add `status` field to track whether an RFP is confirmed open.

New type + field:
- `RfpStatus = "confirmed_open" | "likely_open" | "likely_closed" | "unknown"`
- Added to `DiscoveredRfp` interface

Flow:
1. AI returns initial `status` in JSON response ("open" / "likely_open" / "uncertain")
2. Content verification upgrades/downgrades: if content says "closed" → `likely_closed`
3. Generic URL detection: if portal URL → `unknown`

### Change 5: Quality Scoring (search.ts — new function)
**What:** After all verification, compute a composite quality score that determines sort order and filtering.

```
qualityScore = relevanceScore (0-100, from AI)
  + (has specific URL, not portal page: +15)
  + (URL verified/cross-referenced: +10)
  + (has future deadline: +10)
  + (content confirmed open: +15)
  - (likely_closed from content check: -40)
  - (no URL at all: -10)
  - (generic portal URL detected: -20)
  - (no deadline: -5)
```

This composite score:
- Sorts results so the best opportunities appear first
- Results with `qualityScore < 30` are filtered out entirely (they're junk)
- Shown in UI as part of the relevance display

### Change 6: UI Quality Indicators (RfpTool.tsx — card rendering)
**What:** Show quality signals on each search result card.

- **"May be closed"** warning badge (amber) when `status === "likely_closed"`
- **"Status unverified"** subtle badge when `status === "unknown"` and no URL
- **"Verified open"** green checkmark when `status === "confirmed_open"`
- **Portal page indicator** — when urlConfidence is "portal_page", show "Search on [portal]" instead of pretending to link to a specific RFP
- Sort results by `qualityScore` descending so best opportunities are always first

---

## Files Modified

| File | Changes |
|------|---------|
| `lib/rfp/search.ts` | Prompt overhaul, add `status` + `qualityScore` to types, quality scoring function, increase max_uses to 20, map AI status to RfpStatus |
| `lib/rfp/url-verification.ts` | Add `isGenericPortalUrl()`, content verification `contentVerifyUrl()`, new "portal_page" confidence tier, update `verifyOpportunityUrls()` pipeline |
| `components/ai-writer/rfp/RfpTool.tsx` | Quality badges on cards, sort by quality score, "May be closed" warning, "Verified open" indicator |

## Expected Impact

- **Expired/closed RFPs**: Caught by content verification (Change 2) — page says "closed" → flagged
- **Generic portal URLs**: Caught by generic URL detection (Change 1) — dropped and replaced with portal search link
- **Low quality results**: Fixed by prompt rewrite (Change 3) + quality scoring (Change 5) — AI aims for quality, then we score and sort
- **Better UX**: User immediately sees which results are verified vs uncertain (Change 6)
