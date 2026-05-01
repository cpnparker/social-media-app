/**
 * Service registry for the AI Control Centre.
 *
 * Hand-curated catalog of every LLM-using service across the three apps that
 * share the `intelligence.ai_usage` table (AuthorityOn, Engine, MeetingBrain).
 * Each row joins what the code does (label, schedule, kill-switch) with the
 * type_source string used in ai_usage so we can attach live spend data.
 *
 * Kept hand-curated for Phase 1 (read-only). Phase 2 will move config to a
 * shared `intelligence.service_config` table that services read at runtime.
 */

export type AppName = "authorityon" | "engine" | "meetingbrain";

export type ScheduleType = "cron" | "user-triggered" | "background";

export interface ScheduleInfo {
  type: ScheduleType;
  /** crontab expression — only set when type === "cron" */
  cronExpression?: string;
  /** route path that the cron hits */
  cronPath?: string;
  /** Vercel project that hosts the cron */
  vercelProject?: string;
}

export interface ServiceEntry {
  /** unique key */
  id: string;
  app: AppName;
  /** value of intelligence.ai_usage.type_source — joins to live spend */
  typeSource: string;
  /** human-readable name */
  label: string;
  /** one-line description of what this service does */
  description: string;
  schedule: ScheduleInfo;
  /** env var on the Vercel project that disables this service when set to "1" */
  killSwitchEnv?: string;
}

export const APP_LABELS: Record<AppName, string> = {
  authorityon: "AuthorityOn",
  engine: "Engine",
  meetingbrain: "MeetingBrain",
};

export const APP_COLORS: Record<AppName, string> = {
  authorityon: "bg-amber-500",
  engine: "bg-blue-500",
  meetingbrain: "bg-emerald-500",
};

export const SERVICE_REGISTRY: ServiceEntry[] = [
  // ── AuthorityOn ────────────────────────────────────────────────────────
  {
    id: "authorityon-scan",
    app: "authorityon",
    typeSource: "scan",
    label: "Brand Scan",
    description:
      "Multi-provider LLM probe per template × brand. Runs every 10 min 5–9 UTC for due brands.",
    schedule: {
      type: "cron",
      cronExpression: "*/10 5-9 * * *",
      cronPath: "/api/cron/scheduled-scans",
      vercelProject: "authorityon-ai",
    },
    killSwitchEnv: "SCANS_DISABLED",
  },
  {
    id: "authorityon-topic-scan",
    app: "authorityon",
    typeSource: "topic-scan",
    label: "Topic Scan",
    description:
      "Daily category leaderboard scan across 6 providers, triggered for every brand with a category.",
    schedule: {
      type: "cron",
      cronExpression: "*/10 5-9 * * *",
      cronPath: "/api/cron/scheduled-scans",
      vercelProject: "authorityon-ai",
    },
    killSwitchEnv: "SCANS_DISABLED",
  },
  {
    id: "authorityon-stories-extract",
    app: "authorityon",
    typeSource: "stories-extract",
    label: "Stories — Extract Claims",
    description:
      "Pulls quotable claims out of brand mentions; runs as part of story rebuild after each scan.",
    schedule: { type: "background" },
    killSwitchEnv: "SCANS_DISABLED",
  },
  {
    id: "authorityon-stories-summarize",
    app: "authorityon",
    typeSource: "stories-summarize",
    label: "Stories — Summarize",
    description: "Produces the per-brand story summary used on the dashboard.",
    schedule: { type: "background" },
    killSwitchEnv: "SCANS_DISABLED",
  },
  {
    id: "authorityon-stories-recommend",
    app: "authorityon",
    typeSource: "stories-recommend",
    label: "Stories — Recommendations",
    description: "Generates content/PR recommendations from the story snapshot.",
    schedule: { type: "background" },
    killSwitchEnv: "SCANS_DISABLED",
  },
  {
    id: "authorityon-stories-source-attr",
    app: "authorityon",
    typeSource: "stories-source-attr",
    label: "Stories — Source Attribution",
    description: "Attributes each claim to a source (provider + scan output).",
    schedule: { type: "background" },
    killSwitchEnv: "SCANS_DISABLED",
  },
  {
    id: "authorityon-stories-embed",
    app: "authorityon",
    typeSource: "stories-embed",
    label: "Stories — Embeddings",
    description: "Computes semantic embeddings for clustering similar claims.",
    schedule: { type: "background" },
    killSwitchEnv: "SCANS_DISABLED",
  },
  {
    id: "authorityon-audit-website",
    app: "authorityon",
    typeSource: "audit-website",
    label: "Audit — Website",
    description:
      "Grok-4 qualitative findings on website AI-discoverability (Phase 1 audits).",
    schedule: { type: "background" },
    killSwitchEnv: "SCANS_DISABLED",
  },
  {
    id: "authorityon-audit-content",
    app: "authorityon",
    typeSource: "audit-content",
    label: "Audit — Content",
    description: "Grok-4 content-quality assessment (storytelling, voice, uniqueness).",
    schedule: { type: "background" },
    killSwitchEnv: "SCANS_DISABLED",
  },
  {
    id: "authorityon-audit-social",
    app: "authorityon",
    typeSource: "audit-social",
    label: "Audit — Social",
    description: "Grok-4 LinkedIn/social presence assessment.",
    schedule: { type: "background" },
    killSwitchEnv: "SCANS_DISABLED",
  },
  {
    id: "authorityon-linkedin-analysis",
    app: "authorityon",
    typeSource: "linkedin-analysis",
    label: "LinkedIn — Profile/Company",
    description: "Per-profile LinkedIn analysis (Grok-4).",
    schedule: { type: "user-triggered" },
  },
  {
    id: "authorityon-linkedin-content-multi",
    app: "authorityon",
    typeSource: "linkedin-content-multi",
    label: "LinkedIn — Multi-post",
    description: "Cross-post LinkedIn content quality (Grok-4).",
    schedule: { type: "user-triggered" },
  },
  {
    id: "authorityon-linkedin-content-single",
    app: "authorityon",
    typeSource: "linkedin-content-single",
    label: "LinkedIn — Single-post",
    description: "Deep-dive single LinkedIn post analysis (Grok-4).",
    schedule: { type: "user-triggered" },
  },
  {
    id: "authorityon-brand-suggest",
    app: "authorityon",
    typeSource: "brand-suggest",
    label: "Brand Setup Suggestions",
    description: "Suggests competitors/keywords when adding a new brand.",
    schedule: { type: "user-triggered" },
  },
  {
    id: "authorityon-explorer",
    app: "authorityon",
    typeSource: "explorer",
    label: "Explorer Query",
    description: "Ad-hoc LLM queries from the explorer UI.",
    schedule: { type: "user-triggered" },
  },

  // ── Engine ─────────────────────────────────────────────────────────────
  {
    id: "engine-enginegpt",
    app: "engine",
    typeSource: "enginegpt",
    label: "EngineAI Chat",
    description: "User-facing conversation: chats with their brand context.",
    schedule: { type: "user-triggered" },
  },
  {
    id: "engine-engineai",
    app: "engine",
    typeSource: "engineai",
    label: "EngineAI (legacy alias)",
    description: "Older source-tag for EngineAI; still emitted in some paths.",
    schedule: { type: "user-triggered" },
  },
  {
    id: "engine-rfp-extract",
    app: "engine",
    typeSource: "rfp-extract",
    label: "RFP — Extract",
    description: "Pulls structured questions out of RFP source documents.",
    schedule: { type: "user-triggered" },
  },
  {
    id: "engine-rfp-search",
    app: "engine",
    typeSource: "rfp-search",
    label: "RFP — Search",
    description: "Finds matching RFPs across saved sources.",
    schedule: {
      type: "cron",
      cronExpression: "0 */1 * * *",
      cronPath: "/api/cron/rfp-scan",
      vercelProject: "social-media-app",
    },
  },
  {
    id: "engine-rfp-sections",
    app: "engine",
    typeSource: "rfp-sections",
    label: "RFP — Sections",
    description: "Drafts response sections for a chosen RFP.",
    schedule: { type: "user-triggered" },
  },
  {
    id: "engine-rfp-generate",
    app: "engine",
    typeSource: "rfp-generate",
    label: "RFP — Generate",
    description: "Full-response generation from RFP sections + company profile.",
    schedule: { type: "user-triggered" },
  },
  {
    id: "engine-rfp-profile",
    app: "engine",
    typeSource: "rfp-profile",
    label: "RFP — Company Profile",
    description: "Generates the company profile that feeds RFP responses.",
    schedule: { type: "user-triggered" },
  },
  {
    id: "engine-client-context",
    app: "engine",
    typeSource: "client-context",
    label: "Client Context Refresh",
    description:
      "Cron every 12h: re-derives client context from recent posts/meetings.",
    schedule: {
      type: "cron",
      cronExpression: "0 */12 * * *",
      cronPath: "/api/cron/client-context",
      vercelProject: "social-media-app",
    },
  },
  {
    id: "engine-memory-extract",
    app: "engine",
    typeSource: "memory-extract",
    label: "Memory — Extract",
    description: "Builds long-term memory from user activity.",
    schedule: { type: "background" },
  },
  {
    id: "engine-memory-extract-task",
    app: "engine",
    typeSource: "memory-extract-task",
    label: "Memory — Task",
    description: "Per-task memory snippet generation.",
    schedule: { type: "background" },
  },
  {
    id: "engine-memory-consolidate",
    app: "engine",
    typeSource: "memory-consolidate",
    label: "Memory — Consolidate",
    description: "Merges duplicate memory entries.",
    schedule: { type: "background" },
  },
  {
    id: "engine-summary-generate",
    app: "engine",
    typeSource: "summary-generate",
    label: "Summary — Generate",
    description: "Generates fresh summary text for a recent meeting/post.",
    schedule: { type: "background" },
  },
  {
    id: "engine-summary-update",
    app: "engine",
    typeSource: "summary-update",
    label: "Summary — Update",
    description: "Updates an existing summary when new context arrives.",
    schedule: { type: "background" },
  },

  // ── MeetingBrain ───────────────────────────────────────────────────────
  {
    id: "mb-meeting",
    app: "meetingbrain",
    typeSource: "meeting",
    label: "Meeting Processing",
    description:
      "Extracts tasks, summary, insights from meeting transcripts. Triggered by scan-meetings cron + on-demand.",
    schedule: {
      type: "cron",
      cronExpression: "*/15 * * * *",
      cronPath: "/api/cron/scan-meetings",
      vercelProject: "meetingbrain",
    },
  },
  {
    id: "mb-meeting-audio",
    app: "meetingbrain",
    typeSource: "meeting-audio",
    label: "Meeting — Audio Transcribe",
    description: "AssemblyAI transcript ingestion + Haiku post-processing.",
    schedule: { type: "user-triggered" },
  },
  {
    id: "mb-email",
    app: "meetingbrain",
    typeSource: "email",
    label: "Email Scanner",
    description: "Per-message extraction of tasks/topics from Gmail + MS Email.",
    schedule: {
      type: "cron",
      cronExpression: "*/15 * * * *",
      cronPath: "/api/cron/scan-meetings",
      vercelProject: "meetingbrain",
    },
  },
  {
    id: "mb-slack",
    app: "meetingbrain",
    typeSource: "slack",
    label: "Slack Scanner",
    description: "Slack message extraction.",
    schedule: {
      type: "cron",
      cronExpression: "*/15 * * * *",
      cronPath: "/api/cron/scan-meetings",
      vercelProject: "meetingbrain",
    },
  },
  {
    id: "mb-focus",
    app: "meetingbrain",
    typeSource: "focus",
    label: "Focus / Action Items",
    description: "Highlights action items and focus tasks.",
    schedule: { type: "background" },
  },
  {
    id: "mb-chat",
    app: "meetingbrain",
    typeSource: "chat",
    label: "MeetingBrain Chat",
    description: "User-facing assistant inside MeetingBrain.",
    schedule: { type: "user-triggered" },
  },
  {
    id: "mb-dedup",
    app: "meetingbrain",
    typeSource: "dedup",
    label: "Deduplication",
    description: "Cross-source dedup of tasks and topics.",
    schedule: { type: "background" },
  },
];

export function findService(typeApp: string, typeSource: string): ServiceEntry | undefined {
  return SERVICE_REGISTRY.find(
    (s) => s.app === typeApp && s.typeSource === typeSource,
  );
}
