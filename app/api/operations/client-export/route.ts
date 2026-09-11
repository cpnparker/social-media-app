import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isTCEStaff } from "@/lib/permissions";
import { buildClientExport } from "@/lib/client-export";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// GET /api/operations/client-export?clientId=6&from=2023-07-01&to=2026-08-11
// Streams a two-sheet xlsx handover export for one client: content
// commissioned in the period with Google Doc links, plus signed 1-year
// download URLs for every final-revision media file.
//
// Staff only: the payload is long-lived login-less download URLs for an
// arbitrary client's files — requireAuth alone would let any authenticated
// user (including client-role logins) exfiltrate another client's media.
export async function GET(req: NextRequest) {
  const authResult = await requireAuth();
  if (authResult instanceof NextResponse) return authResult;
  if (!isTCEStaff(authResult.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const clientId = parseInt(searchParams.get("clientId") || "", 10);
  if (isNaN(clientId)) {
    return NextResponse.json({ error: "clientId is required" }, { status: 400 });
  }
  const from = searchParams.get("from");
  const to = searchParams.get("to");
  if ((from && !DATE_RE.test(from)) || (to && !DATE_RE.test(to))) {
    return NextResponse.json({ error: "from/to must be YYYY-MM-DD" }, { status: 400 });
  }

  try {
    const { buffer, clientName } = await buildClientExport(clientId, from, to);
    const safeName = clientName.trim().replace(/[^a-zA-Z0-9-]+/g, "-").replace(/^-+|-+$/g, "") || "client";
    const filename = `${safeName}-content-export-${from || "all"}-to-${to || "now"}.xlsx`;
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("Client export GET error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
