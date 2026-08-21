/**
 * The client canon — per-client grounding for the Content Optimizer.
 *
 * A source-tagged fact sheet assembled from what EngineAI already knows about
 * a client, so a draft is written against that client's real world rather than
 * a generic one. Spec: docs/content-optimizer-spec.md §3.
 *
 * WHY EVERY FACT CARRIES ITS SOURCE AND DATE: a writer is being asked to trust
 * these facts enough to put them in a client's published content. "The client
 * wants ROI proof" is worth something when it says which meeting it came from
 * and when; anonymous, it is a rumour the tool made authoritative by printing
 * it in a box.
 *
 * PRIVACY — the load-bearing rule. Only workspace-shared CLIENT meetings may
 * contribute. The personal MeetingBrain reports (my_tasks, meetings,
 * upcoming_meetings, search_meetings) are one person's private data, and a
 * canon is a shared artefact visible to everyone with that client selected.
 * queryMeetingBrain's audience gate blocks those reports unless the caller
 * passes visibility:"private" — and passing it from here to "make them work"
 * would be deliberately defeating the gate, not a workaround. That exact
 * mistake has already leaked personal tasks into a team-visible feed once.
 */

import { supabase } from "@/lib/supabase";
import { intelligenceDb } from "@/lib/supabase-intelligence";
import { queryMeetingBrain } from "@/lib/ai/providers";

export type CanonSource = "engine" | "assets" | "meetings" | "authorityon" | "manual";

export interface CanonFact {
  /** Short, quotable statement of fact. Rendered as a chip in the brief. */
  text: string;
  source: CanonSource;
  /** ISO date this was true, where the source knows. Meetings always know. */
  asOf?: string;
  /** Human-readable provenance, e.g. a meeting title. Shown on hover. */
  detail?: string;
}

export interface ClientCanon {
  clientId: number;
  clientName: string;
  facts: CanonFact[];
  /** Canonical name plus any aliases seen — feeds the entity-consistency criteria. */
  brandName: string;
  brandAliases: string[];
  /** Suggested target queries seeded from industry and recent meeting themes. */
  suggestedQueries: string[];
  /** Sources that produced nothing, and why. Shown in the UI: a thin canon must
   *  look thin, not look complete. */
  gaps: { source: CanonSource; reason: string }[];
  refreshedAt: string;
}

const MEETING_WINDOW_DAYS = 90;
const MAX_MEETING_FACTS = 6;

/**
 * Assemble a client's canon.
 *
 * `userEmail` is the caller's, used only as MeetingBrain's identity for the
 * workspace-shared client report. Failures in any one source degrade to a
 * recorded gap rather than an exception: a canon missing its meetings is still
 * worth having, and a studio that will not open because MeetingBrain is slow
 * is worse than one that says "meetings unavailable".
 */
export async function buildClientCanon(
  workspaceId: string,
  clientId: number,
  userEmail: string
): Promise<ClientCanon> {
  const facts: CanonFact[] = [];
  const gaps: { source: CanonSource; reason: string }[] = [];
  const today = new Date().toISOString().slice(0, 10);

  // ── 1. Engine: the client record ──
  let clientName = `Client ${clientId}`;
  let industry: string | null = null;
  try {
    const { data } = await supabase
      .from("app_clients")
      .select("id_client, name_client, information_industry, link_website")
      .eq("id_client", clientId)
      .maybeSingle();
    if (data) {
      clientName = (data as any).name_client || clientName;
      industry = (data as any).information_industry || null;
      const site = (data as any).link_website;
      if (industry) facts.push({ text: `${clientName} — ${industry}`, source: "engine", asOf: today });
      else facts.push({ text: clientName, source: "engine", asOf: today });
      if (site) facts.push({ text: `Website: ${site}`, source: "engine", asOf: today });
    } else {
      gaps.push({ source: "engine", reason: "No client record found" });
    }
  } catch {
    gaps.push({ source: "engine", reason: "Client record unavailable" });
  }

  // ── 2. Client assets: the consolidated profile from uploaded files ──
  // There is no shared read helper for this table; every caller inlines the
  // same select, so this one does too rather than inventing a helper that
  // diverges from the six existing readers.
  try {
    const { data } = await intelligenceDb
      .from("ai_client_context")
      .select("document_context, units_asset_count, date_last_processed")
      .eq("id_workspace", workspaceId)
      .eq("id_client", clientId)
      .maybeSingle();
    const doc = (data as any)?.document_context as string | undefined;
    if (doc && doc.trim()) {
      const asOf = ((data as any).date_last_processed || "").slice(0, 10) || undefined;
      // The stored profile is a ~1,500-token prose summary. Split it into
      // sentence-sized facts rather than dropping a wall of text into a chip.
      const sentences = doc.split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter((s) => s.length > 30);
      for (let i = 0; i < Math.min(4, sentences.length); i++) {
        facts.push({ text: sentences[i], source: "assets", asOf, detail: "From uploaded client files" });
      }
    } else {
      gaps.push({ source: "assets", reason: "No client files have been processed" });
    }
  } catch {
    gaps.push({ source: "assets", reason: "Client asset profile unavailable" });
  }

  // ── 3. Meetings: workspace-shared client meetings only ──
  const meetingThemes: string[] = [];
  try {
    const result = await queryMeetingBrain("client_meetings", userEmail, {
      days: MEETING_WINDOW_DAYS,
      // "team", never "private" — see the privacy note at the top of this file.
      visibility: "team",
      workspaceId,
    });
    if (result.error) {
      gaps.push({ source: "meetings", reason: "MeetingBrain unavailable" });
    } else {
      const rows: any[] = Array.isArray(result.data) ? result.data : [];
      const mine = rows.filter(
        (r) =>
          r &&
          r.client_id === clientId &&
          // Attribution is by email domain alone, so a meeting spanning two
          // clients or with no recognisable domain comes back unattributed.
          // Those stay out — a fact on the wrong client's sheet is worse than
          // a missing one.
          r.meeting_kind === "client meeting"
      );
      if (mine.length === 0) {
        // A capped or empty result is NOT evidence the client went quiet, and
        // the UI must not imply it is.
        gaps.push({ source: "meetings", reason: `No shared client meetings in the last ${MEETING_WINDOW_DAYS} days` });
      }
      for (let i = 0; i < Math.min(MAX_MEETING_FACTS, mine.length); i++) {
        const m = mine[i];
        const topics: string[] = Array.isArray(m.key_topics) ? m.key_topics : [];
        for (let t = 0; t < Math.min(2, topics.length); t++) {
          if (typeof topics[t] === "string" && topics[t].trim()) {
            facts.push({
              text: topics[t].trim(),
              source: "meetings",
              asOf: typeof m.date === "string" ? m.date : undefined,
              detail: m.title || "Client meeting",
            });
            meetingThemes.push(topics[t].trim());
          }
        }
      }
    }
  } catch {
    gaps.push({ source: "meetings", reason: "MeetingBrain unavailable" });
  }

  // ── 4. AuthorityOn ──
  // There is NO connection from this repo to AuthorityOn data. The spec files
  // it under the v2 Pulse work (§7). Recorded as an explicit gap rather than
  // omitted, so the UI can say the source is not connected instead of quietly
  // presenting a three-source canon as if it were the full four.
  gaps.push({ source: "authorityon", reason: "Not connected — planned for a later milestone" });

  return {
    clientId,
    clientName,
    facts,
    brandName: clientName,
    brandAliases: deriveAliases(clientName),
    suggestedQueries: seedQueries(industry, meetingThemes),
    gaps,
    refreshedAt: new Date().toISOString(),
  };
}

/**
 * Obvious surface forms of a client's name, for the entity-consistency checks.
 *
 * Deliberately conservative: only forms derivable from the name itself (a
 * legal-suffix strip, an initialism for a multi-word name). Guessing further
 * would create aliases the client never uses, and the drift criterion counts
 * DISTINCT forms present — so a wrong alias cannot cost points, but it can
 * make a correctly-named draft look inconsistent in the UI.
 */
function deriveAliases(name: string): string[] {
  const out: string[] = [name];
  const stripped = name.replace(/\s+(Ltd\.?|Limited|GmbH|AG|Inc\.?|LLC|PLC|SA|BV)$/i, "").trim();
  if (stripped && stripped !== name) out.push(stripped);
  const words = stripped.split(/\s+/).filter((w) => /^[A-Za-z]/.test(w));
  if (words.length >= 2 && words.length <= 4) {
    const initials = words.map((w) => w[0].toUpperCase()).join("");
    if (initials.length >= 2) out.push(initials);
  }
  return out;
}

/**
 * Candidate target queries.
 *
 * The meeting themes are the interesting half and the part no competitor tool
 * has: every GEO platform generates synthetic prompts, but "what this client's
 * own stakeholders actually asked about in the last quarter" is a signal that
 * only exists because the meetings are already here. These are candidates for
 * the writer to accept or reject, never auto-applied — a theme lifted from a
 * meeting is not automatically a query a buyer would type.
 */
function seedQueries(industry: string | null, meetingThemes: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < Math.min(4, meetingThemes.length); i++) {
    const t = meetingThemes[i].toLowerCase().replace(/[.?!]+$/, "");
    if (t.length >= 8 && t.length <= 80) out.push(t);
  }
  if (industry) {
    out.push(`best ${industry.toLowerCase()} providers`);
    out.push(`how to choose a ${industry.toLowerCase()} partner`);
  }
  return out.slice(0, 6);
}

/** Read the cached canon, or build and cache one. */
export async function getClientCanon(
  workspaceId: string,
  clientId: number,
  userEmail: string,
  maxAgeHours = 24
): Promise<ClientCanon> {
  try {
    const { data } = await intelligenceDb
      .from("optimizer_client_canon")
      .select("config_facts, config_queries, document_voice, date_refreshed")
      .eq("id_workspace", workspaceId)
      .eq("id_client", clientId)
      .maybeSingle();
    if (data) {
      const age = Date.now() - new Date((data as any).date_refreshed).getTime();
      if (age < maxAgeHours * 3600_000) {
        const cached = (data as any).config_facts;
        if (cached && cached.clientId) return cached as ClientCanon;
      }
    }
  } catch {
    // A missing table (migration not yet applied) must not break the studio —
    // rebuild live and skip the cache write below.
  }

  const fresh = await buildClientCanon(workspaceId, clientId, userEmail);
  try {
    await intelligenceDb.from("optimizer_client_canon").upsert(
      {
        id_workspace: workspaceId,
        id_client: clientId,
        config_facts: fresh,
        config_queries: fresh.suggestedQueries,
        date_refreshed: fresh.refreshedAt,
        date_updated: new Date().toISOString(),
      },
      { onConflict: "id_workspace,id_client" }
    );
  } catch {
    // Cache write is best-effort. The canon is already built and returned.
  }
  return fresh;
}
