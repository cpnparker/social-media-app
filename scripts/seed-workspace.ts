/**
 * Seed script: Creates a default workspace and adds all existing users as members.
 * The first "super" role user (or first user) becomes the workspace owner.
 *
 * Prerequisites:
 *   1. Run scripts/migrate-new-tables.sql in Supabase SQL Editor first
 *   2. Ensure .env.local has NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY
 *
 * Usage: npx tsx scripts/seed-workspace.ts
 */

import { config } from "dotenv";
config({ path: ".env.local" });

import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function main() {
  // 1. Check if a workspace already exists
  const { data: existingWorkspaces } = await supabase
    .from("workspaces")
    .select("id, name")
    .limit(1);

  if (existingWorkspaces && existingWorkspaces.length > 0) {
    console.log(
      `Workspace already exists: "${existingWorkspaces[0].name}" (${existingWorkspaces[0].id})`
    );
    console.log("Skipping creation. Delete it manually if you want to re-seed.");
    process.exit(0);
  }

  // 2. Find the owner — prefer a user with role_user = 'super', else first user
  const { data: superUsers } = await supabase
    .from("users")
    .select("id_user, name_user, email_user, role_user")
    .eq("role_user", "super")
    .is("date_deleted", null)
    .limit(1);

  let owner = superUsers?.[0];

  if (!owner) {
    const { data: firstUsers } = await supabase
      .from("users")
      .select("id_user, name_user, email_user, role_user")
      .is("date_deleted", null)
      .order("id_user", { ascending: true })
      .limit(1);

    owner = firstUsers?.[0];
  }

  if (!owner) {
    console.error("No users found in the database. Cannot create workspace.");
    process.exit(1);
  }

  console.log(`Owner: ${owner.name_user} (${owner.email_user})`);

  // 3. Create the default workspace
  const { data: workspace, error: wsError } = await supabase
    .from("workspaces")
    .insert({
      name: "The Content Engine",
      slug: "the-content-engine",
      plan: "pro",
      late_api_key: process.env.LATE_API_KEY || null,
    })
    .select()
    .single();

  if (wsError) {
    console.error("Failed to create workspace:", wsError.message);
    process.exit(1);
  }

  console.log(`Created workspace: "${workspace.name}" (${workspace.id})`);

  // 4. Add the owner as admin
  await supabase.from("workspace_members").insert({
    workspace_id: workspace.id,
    user_id: owner.id_user,
    role: "admin",
  });
  console.log(`Added ${owner.name_user} as workspace admin`);

  // 5. Add all other active users as members
  const { data: allUsers } = await supabase
    .from("users")
    .select("id_user, name_user")
    .is("date_deleted", null)
    .neq("id_user", owner.id_user);

  let addedCount = 0;
  for (const user of allUsers || []) {
    const { error } = await supabase.from("workspace_members").insert({
      workspace_id: workspace.id,
      user_id: user.id_user,
      role: "viewer",
    });
    if (!error) addedCount++;
  }

  console.log(`Added ${addedCount} users as workspace viewers`);

  // 6. Summary
  console.log("\n--- Seed Complete ---");
  console.log(`Workspace: ${workspace.name}`);
  console.log(`Slug: ${workspace.slug}`);
  console.log(`ID: ${workspace.id}`);
  console.log(`Members: ${addedCount + 1} (1 admin + ${addedCount} viewers)`);

  process.exit(0);
}

main().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
