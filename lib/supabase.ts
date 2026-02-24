import { createClient } from "@supabase/supabase-js";

// Server-side admin client — uses service role key to bypass RLS.
// Use this in API routes and server components.
//
// Type safety: Run `supabase login` then `npx supabase gen types typescript
// --project-id dcwodczzdeltxlyepxmc > lib/types/supabase.ts` to get proper
// types, then change to: createClient<Database>(...)
export const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);
