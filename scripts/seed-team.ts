/**
 * Seed script: Creates a "Test" team, adds the first user as admin,
 * and links all Late API accounts to the team.
 *
 * Usage: npx tsx scripts/seed-team.ts
 */

import { config } from "dotenv";
config({ path: ".env.local" });

import { sql } from "@vercel/postgres";
import { drizzle } from "drizzle-orm/vercel-postgres";
import * as schema from "../lib/db/schema";
import { eq } from "drizzle-orm";

const LATE_API_BASE = "https://getlate.dev/api/v1";

async function main() {
  const db = drizzle(sql, { schema });

  // 1. Find or create the first user
  let allUsers = await db.select().from(schema.users).limit(1);
  if (allUsers.length === 0) {
    console.log("No users found, creating default user...");
    const [newUser] = await db
      .insert(schema.users)
      .values({
        email: "chris@thecontentengine.com",
        name: "Chris",
        provider: "email",
      })
      .returning();
    allUsers = [newUser];
  }
  const user = allUsers[0];
  console.log(`Found user: ${user.name} (${user.email})`);

  // 2. Find or create a workspace
  let workspace: typeof schema.workspaces.$inferSelect | undefined;
  const allWorkspaces = await db.select().from(schema.workspaces).limit(1);
  if (allWorkspaces.length === 0) {
    console.log("No workspace found, creating default workspace...");
    const [ws] = await db
      .insert(schema.workspaces)
      .values({
        name: "My Workspace",
        slug: "my-workspace",
        plan: "free",
        lateApiKey: process.env.LATE_API_KEY || null,
      })
      .returning();
    workspace = ws;
  } else {
    workspace = allWorkspaces[0];
  }
  console.log(`Using workspace: ${workspace.name} (${workspace.id})`);

  // 3. Check if Test team already exists
  const existingTeams = await db
    .select()
    .from(schema.teams)
    .where(eq(schema.teams.name, "Test"));

  if (existingTeams.length > 0) {
    console.log("Test team already exists, skipping creation.");
    console.log(`Team ID: ${existingTeams[0].id}`);
    process.exit(0);
  }

  // 4. Create the Test team
  const [team] = await db
    .insert(schema.teams)
    .values({
      workspaceId: workspace.id,
      name: "Test",
      description: "Default test team with all accounts",
    })
    .returning();
  console.log(`Created team: ${team.name} (${team.id})`);

  // 5. Add user as admin
  await db.insert(schema.teamMembers).values({
    teamId: team.id,
    userId: user.id,
    role: "admin",
  });
  console.log(`Added ${user.name} as admin`);

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
    await db.insert(schema.teamAccounts).values({
      teamId: team.id,
      lateAccountId: acc._id || acc.id,
      platform: (acc.platform || "unknown").toLowerCase(),
      displayName: acc.displayName || acc.username || acc.platform || "Unknown",
      username: acc.username || null,
      avatarUrl: acc.avatarUrl || acc.avatar || null,
    });
    console.log(
      `  Linked: ${acc.displayName || acc.username} (${acc.platform})`
    );
  }

  console.log("\nSeed complete!");
  console.log(`Team: ${team.name}`);
  console.log(`Members: 1 (${user.name} as admin)`);
  console.log(`Accounts: ${accounts.length}`);

  process.exit(0);
}

main().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
