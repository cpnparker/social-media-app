import { NextRequest, NextResponse } from "next/server";
import { queryMeetingBrain } from "@/lib/ai/providers";
import { requireTceStaff } from "../_lib/access";

/**
 * GET /api/operations/clients/attendee-shape?days=90
 *
 * One question: does `external_attendees` on a client meeting carry EMAIL
 * ADDRESSES, or only display names?
 *
 * It decides whether the per-client relationship view is a small build or a
 * blocked one. Client meetings are attributed to a client by matching attendee
 * email domains against the registered client websites — deliberately by
 * domain and never by company name, since name matching merges two clients who
 * share a word. If the field holds only names, every meeting comes back
 * unattributed and the panels that depend on it cannot be built as specified.
 *
 * Reports SHAPES AND COUNTS, never attendee lists. Those are the names and
 * addresses of clients' staff: the question here is whether an "@" is present
 * and how many meetings resolve, which needs no personal data to answer.
 */
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const gate = await requireTceStaff();
  if (gate instanceof NextResponse) return gate;
  const { email } = gate;

  const days = Math.min(Math.max(parseInt(req.nextUrl.searchParams.get("days") || "90", 10) || 90, 1), 365);

  const result = await queryMeetingBrain("client_meetings", email, { days, visibility: "team" });
  if (result.error) {
    return NextResponse.json({ error: result.error, hint: result.hint ?? null }, { status: 502 });
  }

  const rows = (result.data as any[]) || [];
  let withAttendeeField = 0;
  let containsAtSign = 0;
  let attributed = 0;
  const domainsSeen = new Set<string>();

  for (const r of rows) {
    if (r.client_id != null) attributed++;
    const raw = r.attendees;
    const text = typeof raw === "string" ? raw : Array.isArray(raw) ? raw.join(" ") : "";
    if (!text) continue;
    withAttendeeField++;
    const emails = text.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g) || [];
    if (emails.length) {
      containsAtSign++;
      // The DOMAIN only. A domain is a company, not a person — it is the thing
      // attribution actually joins on, and it is what tells us whether this
      // works. The local part is never read.
      for (const e of emails) domainsSeen.add(e.split("@")[1].toLowerCase());
    }
  }

  const verdict =
    rows.length === 0
      ? "No client meetings in this window — inconclusive. Try a larger days value."
      : containsAtSign > 0
        ? "USABLE — attendee text contains email addresses, so domain attribution works."
        : withAttendeeField > 0
          ? "BLOCKED — attendee text is present but carries NO email addresses, so there is nothing to match a client " +
            "domain against. Per-client meeting attribution needs get_client_meetings to return the matched client " +
            "(or the attendee emails) before the relationship view can be built."
          : "BLOCKED — no attendee text at all on any meeting in this window.";

  return NextResponse.json({
    windowDays: days,
    meetings: rows.length,
    withAttendeeField,
    containsEmailAddresses: containsAtSign,
    attributedToAClient: attributed,
    // Domains only, capped. Enough to confirm real client domains are present
    // and to spot ones missing from app_clients.link_website, without
    // enumerating anyone's contacts.
    distinctAttendeeDomains: Array.from(domainsSeen).sort().slice(0, 40),
    distinctAttendeeDomainCount: domainsSeen.size,
    verdict,
    hint: result.hint ?? null,
  });
}
