import { createClient } from "@supabase/supabase-js";

// Server-side admin client for the intelligence schema.
// Uses service role key to bypass RLS (same as the public schema client).
// All EngineAI tables (ai_conversations, ai_messages, ai_roles, etc.) live here.
//
// Constructed lazily on first use — a module-scope createClient throws at
// import time when env vars are absent, which breaks `next build`'s page-data
// collection on machines without a .env.local.
function createIntelligenceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      db: { schema: "intelligence" },
    }
  );
}

let client: ReturnType<typeof createIntelligenceClient> | undefined;

export const intelligenceDb: ReturnType<typeof createIntelligenceClient> = new Proxy(
  {} as ReturnType<typeof createIntelligenceClient>,
  {
    get(_target, prop) {
      client ??= createIntelligenceClient();
      const value = Reflect.get(client, prop, client);
      return typeof value === "function" ? value.bind(client) : value;
    },
  }
);
