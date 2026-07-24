import { createClient } from "@supabase/supabase-js";

// Server-side admin client — uses service role key to bypass RLS.
// Use this in API routes and server components.
//
// Type safety: Run `supabase login` then `npx supabase gen types typescript
// --project-id dcwodczzdeltxlyepxmc > lib/types/supabase.ts` to get proper
// types, then change to: createClient<Database>(...)
//
// Constructed lazily on first use — a module-scope createClient throws at
// import time when env vars are absent, which breaks `next build`'s page-data
// collection on machines without a .env.local.
function createSupabaseClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

let client: ReturnType<typeof createSupabaseClient> | undefined;

export const supabase: ReturnType<typeof createSupabaseClient> = new Proxy(
  {} as ReturnType<typeof createSupabaseClient>,
  {
    get(_target, prop) {
      client ??= createSupabaseClient();
      const value = Reflect.get(client, prop, client);
      return typeof value === "function" ? value.bind(client) : value;
    },
  }
);
