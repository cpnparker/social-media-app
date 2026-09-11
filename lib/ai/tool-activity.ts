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
  query_authorityon: { label: "Reading AuthorityOn", service: "authorityon" },
  query_engine: { label: "Querying the Engine", service: "engine" },
  query_resourcing: { label: "Checking resourcing", service: "engine" },
  lookup_client_context: { label: "Looking up the client", service: "engine" },
  query_content_score: { label: "Scoring the content", service: "engine" },
  query_page_audit: { label: "Auditing the page", service: "engine" },
  query_gmail: { label: "Searching your mail", service: "mail" },
  query_calendar: { label: "Checking your calendar", service: "calendar" },
  query_microsoft: { label: "Checking Microsoft 365", service: "calendar" },
  query_slack: { label: "Searching Slack", service: "slack" },
  query_meetingbrain: { label: "Reading meeting notes", service: "meetings" },
  query_drive_docs: { label: "Reading Drive documents", service: "drive" },
  query_xero: { label: "Reading Xero", service: "finance" },
  search_memory: { label: "Searching memories", service: "memory" },
  search_notebook: { label: "Searching your notebook", service: "memory" },
  search_thread: { label: "Searching this conversation", service: "memory" },
  web_search: { label: "Searching the web", service: "web" },
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
