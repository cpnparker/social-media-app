import { createClient } from "@supabase/supabase-js";

/**
 * Server-side admin client for the `meetingbrain` schema.
 *
 * MeetingBrain lives in the SAME Supabase project as Engine — different schema,
 * same connection — so this is a direct read/write, not a bridge. The HTTP
 * bridge exists for things MeetingBrain has to do with a user's OAuth token
 * (reading Gmail, Calendar, Graph); plain table access does not need it.
 *
 * There was already a `getMeetingBrainDb()` inside lib/ai/providers.ts, but
 * that module is ~9,000 lines and pulls in the Anthropic and OpenAI SDKs,
 * pptxgenjs and docx. Importing it into an OAuth callback to get a database
 * handle meant loading all of that on a route whose whole job is to be small
 * and reliable. Same lazy-construction pattern as lib/supabase-intelligence.ts:
 * a module-scope createClient throws at import time when env vars are absent,
 * which breaks `next build`'s page-data collection.
 */
function createMeetingBrainClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { db: { schema: "meetingbrain" } }
  );
}

let client: ReturnType<typeof createMeetingBrainClient> | undefined;

export const meetingBrainDb: ReturnType<typeof createMeetingBrainClient> = new Proxy(
  {} as ReturnType<typeof createMeetingBrainClient>,
  {
    get(_target, prop) {
      client ??= createMeetingBrainClient();
      const value = Reflect.get(client, prop, client);
      return typeof value === "function" ? value.bind(client) : value;
    },
  }
);
