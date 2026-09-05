import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { searchArtlist } from "@/lib/integrations/artlist";

/**
 * GET /api/ai/design/artlist?q=...&duration_min=...&orientation=...&page=...
 * Server-side Artlist proxy so the API key never reaches the browser.
 * Used by the manual Library browser in Design mode.
 */
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const q = searchParams.get("q") || "";
  if (!q.trim()) {
    return NextResponse.json({ items: [], totalCount: 0, hasMore: false, page: 1 });
  }

  try {
    const result = await searchArtlist({
      query: q,
      durationMin: numberOrUndef(searchParams.get("duration_min")),
      durationMax: numberOrUndef(searchParams.get("duration_max")),
      orientation: (searchParams.get("orientation") as any) || undefined,
      mood: searchParams.get("mood") || undefined,
      page: numberOrUndef(searchParams.get("page")) || 1,
      perPage: numberOrUndef(searchParams.get("per_page")) || 12,
    });
    return NextResponse.json(result);
  } catch (err: any) {
    // Surface a clean 502 so the UI can show a clear error.
    return NextResponse.json(
      { error: err?.message || "Artlist search failed" },
      { status: 502 }
    );
  }
}

function numberOrUndef(s: string | null): number | undefined {
  if (!s) return undefined;
  const n = Number(s);
  return Number.isFinite(n) ? n : undefined;
}
