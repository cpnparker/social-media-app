# Plan: Platform Indicators, Filters, Quick Actions, Accounts, Preview Names & Growth Analytics

## Issues Identified

1. **Dashboard & Queue platform indicators** — Posts show colored dots only, no text labels showing which platform (LinkedIn, X, etc.)
2. **Queue page needs platform filter** — Currently only has status filter (all/draft/scheduled/published/failed), no way to filter by social network
3. **Quick Actions links don't work** — Dashboard uses `<Link><Button>` pattern; the `<button>` element inside the `<a>` may intercept clicks. Fix: use shadcn `<Button asChild><Link>` pattern
4. **Can't add additional social networks** — On the Accounts page, the "Connect" button for unconnected platforms is hidden (`opacity-0`) and only appears on hover. Users can't discover it. Fix: make Connect buttons always visible
5. **Preview components show "Your Account" instead of real name** — All preview components (LinkedIn, Twitter, Instagram, Facebook, Generic) hardcode "Your Account". Need to pass actual account name from the accounts API
6. **LinkedIn shows "Organization 34913678"** — The Late API returns org IDs as display names for LinkedIn company pages. Fix: resolve the actual account name from our accounts data and fall back gracefully
7. **Account growth analytics deck** — Build a new analytics section using the Late API `get-follower-stats` endpoint to show page size growth/decline and historical metrics. Will probe the endpoint to determine how far back data goes

## Implementation Steps

### Step 1: Fix Quick Actions Links (Dashboard)
**File:** `app/(app)/dashboard/page.tsx`
- Change all 4 quick action links from `<Link><Button>` to `<Button asChild><Link>` pattern
- This ensures the `<a>` tag IS the rendered element (no nested button)

### Step 2: Platform Indicators on Dashboard & Queue
**Files:** `app/(app)/dashboard/page.tsx`, `app/(app)/queue/page.tsx`
- Replace anonymous colored dots with labeled platform badges/pills
- Each pill shows platform color dot + platform name (e.g., "LinkedIn", "Twitter / X")
- Use existing `platformLabels` from `lib/platform-utils`

### Step 3: Platform Filter on Queue Page
**File:** `app/(app)/queue/page.tsx`
- Add a platform filter dropdown next to the existing status filter pills
- Multi-select: filter by one or more platforms
- Filter applied client-side on the fetched posts (matching `post.platforms[].platform`)
- Reuse the dropdown pattern from the analytics page

### Step 4: Fix Accounts Page — Always Show Connect Button
**File:** `app/(app)/accounts/page.tsx`
- Remove `opacity-0 group-hover:opacity-100` from the Connect button for unconnected platforms — make it always visible
- For already-connected platforms, show both "Add Another" and the existing count
- Keep "Reconnect" option for already-connected accounts

### Step 5: Pass Real Account Names to Platform Previews
**Files:** `app/(app)/posts/[id]/page.tsx`, `components/post-detail/PlatformPreview.tsx`, all 5 preview components
- Fetch accounts list on the post detail page (from `/api/accounts`)
- Match `platformEntry.accountId` to account `_id` to resolve `displayName`/`username`
- Pass `accountName` and `accountAvatar` props down through PlatformPreview to each specific preview
- Update LinkedInPreview, TwitterPreview, InstagramPreview, FacebookPreview, GenericPreview to display the actual account name
- For LinkedIn: if displayName matches "Organization XXXXX" pattern, prefer username or a cleaned-up name

### Step 6: Account Growth Analytics Deck
**New file:** `app/(app)/analytics/growth/page.tsx`
**New API:** `app/api/analytics/growth/route.ts`
- Create API route that calls Late API `get-follower-stats` for each connected account
- Build a new "Account Growth" page accessible from the analytics section
- Show: follower count over time (line chart), growth rate, period comparisons
- Handle the "analytics add-on required" case gracefully with a message
- Add navigation link from the main analytics page
- Probe the endpoint first to determine data availability and time range

### Step 7: Build, Cache Clear & Test
- Run build to catch TypeScript errors
- Clear `.next` cache, restart dev server
- Verify all changes via browser
