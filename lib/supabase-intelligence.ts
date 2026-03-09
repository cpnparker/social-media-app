import { createClient } from "@supabase/supabase-js";

// Server-side admin client for the intelligence schema.
// Uses service role key to bypass RLS (same as the public schema client).
// All EngineGPT tables (ai_conversations, ai_messages, ai_roles, etc.) live here.
export const intelligenceDb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  {
    db: { schema: "intelligence" },
  }
);
