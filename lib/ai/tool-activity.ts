/**
 * What to show the user while a tool is running.
 *
 * ── WHY ─────────────────────────────────────────────────────────────────────
 *
 * A turn that fetches an AuthorityOn report, a mailbox and a meeting history
 * can sit for a minute with nothing on screen but "Thinking…", and a report
 * that pulls the full performance data plus score history plus the change
 * ledger sits longer still. There is no way to tell a working turn from a hung
 * one, and this session has real hangs.
 *
 * What existed was a per-tool `if` chain in ONE of the four provider chains,
 * emitting three hand-written flags. It had drifted the way hand-kept lists do:
 * `query_slack` and `query_meetingbrain` both raised "Searching memories…",
 * which is neither of those things, and `query_authorityon` was not in the list
 * at all — so a minute spent fetching an AI-visibility report was reported to
 * the user as "Querying the Engine…", the wrong service entirely.
 *
 * One map, used by every chain. A tool missing from it still shows something
 * honest rather than nothing, because the fallback is derived from the name.
 */

export interface ToolActivity {
  /** Present tense, what is happening, in the user's words not ours. */
  label: string;
  /**
   * WHAT THE TOOL READS, as a noun a sentence can be built around: "your
   * meeting records", "your mail". Present only on tools that fetch a SOURCE,
   * so the cut-short notice can name what a refused lookup would have reached.
   *
   * Absent on everything that builds rather than reads. That gate was found by
   * running the notice, not by reading it: unscoped, it produced "ran out of
   * its own allowance for reading the deck builder" and, on an unmapped tool,
   * "…for reading not a tool".
   */
  subject?: string;
  /** Which system is being reached. Drives the icon on the client. */
  service:
    | "authorityon"
    | "engine"
    | "mail"
    | "calendar"
    | "slack"
    | "meetings"
    | "drive"
    | "web"
    | "memory"
    | "finance"
    | "document"
    | "image"
    | "generic";
}

const ACTIVITY: Record<string, ToolActivity> = {
  query_authorityon: { label: "Reading AuthorityOn", service: "authorityon", subject: "AuthorityOn" },
  query_engine: { label: "Querying the Engine", service: "engine", subject: "the Engine database" },
  query_resourcing: { label: "Checking resourcing", service: "engine", subject: "the resourcing data" },
  lookup_client_context: { label: "Looking up the client", service: "engine", subject: "the client record" },
  // Scores content rather than fetching it, so no subject: a notice about a
  // cut-short lookup of the scorer would name a thing nobody asked it to read.
  query_content_score: { label: "Scoring the content", service: "engine" },
  query_page_audit: { label: "Auditing the page", service: "engine", subject: "the page being audited" },
  query_gmail: { label: "Searching your mail", service: "mail", subject: "your mail" },
  query_calendar: { label: "Checking your calendar", service: "calendar", subject: "your calendar" },
  query_microsoft: { label: "Checking Microsoft 365", service: "calendar", subject: "Microsoft 365" },
  query_slack: { label: "Searching Slack", service: "slack", subject: "Slack" },
  query_meetingbrain: { label: "Reading meeting notes", service: "meetings", subject: "your meeting records" },
  query_drive_docs: { label: "Reading Drive documents", service: "drive", subject: "Drive documents" },
  query_xero: { label: "Reading Xero", service: "finance", subject: "Xero" },
  search_memory: { label: "Searching memories", service: "memory", subject: "your saved memories" },
  search_notebook: { label: "Searching your notebook", service: "memory", subject: "your notebook" },
  search_thread: { label: "Searching this conversation", service: "memory", subject: "this conversation" },
  // SUBJECT GIVEN BACK on 2026-09-16, in the same change that gave web_search a
  // budget of 6 in lib/ai/tool-loop-guard.ts. It was held out because on the
  // default cap of THREE it went over in four of its six turns in the review
  // window, and a notice that fires on most search turns stops being read. With
  // a real budget the notice means what it says again: a turn that spends six
  // searches and still wants a seventh has a hole in its answer worth naming.
  // The two are a pair — check 11 of scripts/verify-tool-loop-guard.ts goes red
  // if either moves without the other.
  web_search: { label: "Searching the web", service: "web", subject: "web search results" },
  generate_word_document: { label: "Writing the document", service: "document" },
  generate_document: { label: "Building the deck", service: "document" },
  generate_slides: { label: "Building the deck", service: "document" },
  generate_image: { label: "Generating an image", service: "image" },
  generate_chart: { label: "Drawing the chart", service: "image" },
  create_scheduled_task: { label: "Scheduling the task", service: "engine" },
  update_scheduled_task: { label: "Updating the schedule", service: "engine" },
};

/**
 * The activity for a tool. Never returns null: an unmapped tool is still a
 * minute of silence to the user, and "Running query_whatever" is a better
 * answer than nothing — and reads as obviously unfinished to whoever adds the
 * next tool, which is the point.
 */
export function toolActivity(name: string): ToolActivity {
  const known = ACTIVITY[name];
  if (known) return known;
  return { label: `Running ${String(name || "a tool").replace(/_/g, " ")}`, service: "generic" };
}

/**
 * The source a tool reads, or null when it reads no source.
 *
 * Null for a generator, for a tool this map has never heard of, and for
 * anything whose service builds rather than fetches. A notice naming a machine
 * name, or naming the deck builder as something the turn failed to READ, is
 * worse than no notice at all.
 *
 * THE SERVICE GATE IS UNREACHABLE TODAY, deliberately and on the record. No
 * generator in the map above carries a `subject`, so the line before it has
 * already returned null by the time it is read: it is a second lock on a door
 * the first lock holds shut, and it exists for the entry somebody adds later
 * with a subject copied from the row above. A mutation that deletes it alone
 * therefore SURVIVES every check in this repo, and both mutation logs say so
 * rather than claiming a kill nothing can reproduce.
 */
export function dataSubject(name: string): string | null {
  const known = ACTIVITY[name];
  if (!known || !known.subject) return null;
  if (known.service === "document" || known.service === "image" || known.service === "generic") return null;
  return known.subject;
}

/** The SSE frame the chains emit when a tool starts. One shape, four chains. */
export function toolActivityEvent(name: string): string {
  const a = toolActivity(name);
  return `data: ${JSON.stringify({ tool_running: { tool: name, label: a.label, service: a.service } })}\n\n`;
}

/** …and when it finishes, so the row can clear rather than linger. */
export function toolDoneEvent(name: string): string {
  return `data: ${JSON.stringify({ tool_done: { tool: name } })}\n\n`;
}

/** Every tool the map knows, for the check that keeps it in step with the
 *  registered tool set. */
export function mappedToolNames(): string[] {
  return Object.keys(ACTIVITY);
}
