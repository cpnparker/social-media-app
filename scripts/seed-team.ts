/**
 * Seed script: Creates a "Test" team, adds the first user as admin,
 * and links all Late API accounts to the team.
 *
 * Usage: npx tsx scripts/seed-team.ts
 */

import { config } from "dotenv";
config({ path: ".env.local" });

import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const LATE_API_BASE = "https://getlate.dev/api/v1";

async function main() {
  // 1. Find or create the first user
  const { data: users } = await supabase
    .from("users")
    .select("*")
    .is("date_deleted", null)
    .limit(1);

  let user = users?.[0];

  if (!user) {
    console.log("No users found, creating default user...");
    const { data: newUser, error } = await supabase
      .from("users")
      .insert({
        email_user: "chris@thecontentengine.com",
        name_user: "Chris",
        provider: "email",
        date_created: new Date().toISOString(),
      })
      .select()
      .single();

    if (error) throw error;
    user = newUser;
  }
  console.log(`Found user: ${user.name_user} (${user.email_user})`);

  // 2. Find or create a workspace
  const { data: workspaces } = await supabase
    .from("workspaces")
    .select("*")
    .limit(1);

  let workspace = workspaces?.[0];

  if (!workspace) {
    console.log("No workspace found, creating default workspace...");
    const { data: ws, error } = await supabase
      .from("workspaces")
      .insert({
        name: "My Workspace",
        slug: "my-workspace",
        plan: "free",
        late_api_key: process.env.LATE_API_KEY || null,
      })
      .select()
      .single();

    if (error) throw error;
    workspace = ws;
  }
  console.log(`Using workspace: ${workspace.name} (${workspace.id})`);

  // 3. Check if Test team already exists
  const { data: existingTeams } = await supabase
    .from("teams")
    .select("*")
    .eq("name", "Test")
    .eq("workspace_id", workspace.id);

  if (existingTeams && existingTeams.length > 0) {
    console.log("Test team already exists, skipping creation.");
    console.log(`Team ID: ${existingTeams[0].id}`);
    process.exit(0);
  }

  // 4. Create the Test team
  const { data: team, error: teamErr } = await supabase
    .from("teams")
    .insert({
      workspace_id: workspace.id,
      name: "Test",
      description: "Default test team with all accounts",
    })
    .select()
    .single();

  if (teamErr) throw teamErr;
  console.log(`Created team: ${team.name} (${team.id})`);

  // 5. Add user as admin
  await supabase.from("team_members").insert({
    team_id: team.id,
    user_id: user.id_user,
    role: "admin",
  });
  console.log(`Added ${user.name_user} as admin`);

  // 6. Fetch accounts from Late API
  const apiKey = process.env.LATE_API_KEY;
  if (!apiKey) {
    console.error("LATE_API_KEY not set in .env.local");
    process.exit(1);
  }

  const res = await fetch(`${LATE_API_BASE}/accounts`, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
  });

  if (!res.ok) {
    console.error(`Failed to fetch accounts: ${res.status} ${res.statusText}`);
    process.exit(1);
  }

  const data = await res.json();
  const accounts = data.accounts || [];
  console.log(`Found ${accounts.length} accounts from Late API`);

  // 7. Link each account to the team
  for (const acc of accounts) {
    await supabase.from("team_accounts").insert({
      team_id: team.id,
      late_account_id: acc._id || acc.id,
      platform: (acc.platform || "unknown").toLowerCase(),
      display_name: acc.displayName || acc.username || acc.platform || "Unknown",
      username: acc.username || null,
      avatar_url: acc.avatarUrl || acc.avatar || null,
    });
    console.log(
      `  Linked: ${acc.displayName || acc.username} (${acc.platform})`
    );
  }

  console.log("\nSeed complete!");
  console.log(`Team: ${team.name}`);
  console.log(`Members: 1 (${user.name_user} as admin)`);
  console.log(`Accounts: ${accounts.length}`);

  process.exit(0);
}

main().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
