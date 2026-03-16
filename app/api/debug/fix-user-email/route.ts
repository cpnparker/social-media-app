import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { intelligenceDb } from "@/lib/supabase-intelligence";

// POST /api/debug/fix-user-email — Fix email mismatch + clean up duplicates
// Body: { targetEmail: "correct@email.com", userId?: number }
// Admin only — temporary debug endpoint
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { targetEmail, userId } = await req.json();
  if (!targetEmail) {
    return NextResponse.json({ error: "targetEmail required" }, { status: 400 });
  }

  const diagnostics: Record<string, any> = { targetEmail };

  // Find ALL users with this email (including potential duplicates)
  const { data: allByEmail } = await supabase
    .from("users")
    .select("id_user, email_user, name_user, role_user, date_created")
    .eq("email_user", targetEmail)
    .is("date_deleted", null);

  diagnostics.usersWithEmail = allByEmail;

  // If userId provided, check that user too
  if (userId) {
    const { data: targetUser } = await supabase
      .from("users")
      .select("id_user, email_user, name_user, role_user")
      .eq("id_user", userId)
      .is("date_deleted", null)
      .single();

    diagnostics.targetUser = targetUser;

    if (targetUser && targetUser.email_user !== targetEmail) {
      // Update the user's email to match
      const { error: updateErr } = await supabase
        .from("users")
        .update({ email_user: targetEmail })
        .eq("id_user", userId);

      diagnostics.emailUpdated = !updateErr;
      diagnostics.emailUpdateError = updateErr?.message || null;
      diagnostics.oldEmail = targetUser.email_user;
    }

    // Check for duplicates that should be cleaned up
    if (allByEmail && allByEmail.length > 0) {
      const duplicates = allByEmail.filter(u => u.id_user !== userId);
      diagnostics.duplicates = duplicates;

      // Soft-delete duplicates (mark as deleted)
      for (const dup of duplicates) {
        // Check if duplicate has any real data (workspace access, etc.)
        const { data: dupAccess } = await intelligenceDb
          .from("users_access")
          .select("id_access")
          .eq("user_target", dup.id_user);

        const { data: dupMembers } = await intelligenceDb
          .from("workspace_members")
          .select("id")
          .eq("user_id", dup.id_user);

        diagnostics[`duplicate_${dup.id_user}`] = {
          accessRows: dupAccess?.length || 0,
          memberRows: dupMembers?.length || 0,
        };

        // Soft-delete the duplicate user
        await supabase
          .from("users")
          .update({ date_deleted: new Date().toISOString() })
          .eq("id_user", dup.id_user);

        // Clean up their workspace memberships
        if (dupMembers && dupMembers.length > 0) {
          await intelligenceDb
            .from("workspace_members")
            .delete()
            .eq("user_id", dup.id_user);
        }

        // Clean up their access rows
        if (dupAccess && dupAccess.length > 0) {
          await intelligenceDb
            .from("users_access")
            .delete()
            .eq("user_target", dup.id_user);
        }
      }

      diagnostics.duplicatesCleaned = duplicates.length;
    }
  }

  // Also check workspace access for the primary user
  if (userId) {
    const { data: access } = await intelligenceDb
      .from("users_access")
      .select("*")
      .eq("user_target", userId);

    const { data: members } = await intelligenceDb
      .from("workspace_members")
      .select("workspace_id, role")
      .eq("user_id", userId);

    diagnostics.primaryUserAccess = access;
    diagnostics.primaryUserMemberships = members;
  }

  return NextResponse.json(diagnostics);
}

// GET /api/debug/fix-user-email?email=xxx — Just diagnose (read-only)
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const email = req.nextUrl.searchParams.get("email");
  if (!email) {
    return NextResponse.json({ error: "email param required" }, { status: 400 });
  }

  // Find all users with this email or similar
  const { data: byEmail } = await supabase
    .from("users")
    .select("id_user, email_user, name_user, role_user, date_created, date_deleted")
    .eq("email_user", email);

  // Also search by name to find potential mismatches
  const namePart = email.split("@")[0].split(".")[0]; // e.g. "farahnaz" from "farahnaz.mohammed@..."
  const { data: byName } = await supabase
    .from("users")
    .select("id_user, email_user, name_user, role_user, date_created, date_deleted")
    .ilike("name_user", `%${namePart}%`);

  // Also search by partial email
  const { data: byPartialEmail } = await supabase
    .from("users")
    .select("id_user, email_user, name_user, role_user, date_created, date_deleted")
    .ilike("email_user", `%${namePart}%`);

  // Check workspace memberships and access for any found users
  const allUserIds = [
    ...(byEmail?.map(u => u.id_user) || []),
    ...(byName?.map(u => u.id_user) || []),
    ...(byPartialEmail?.map(u => u.id_user) || []),
  ].filter((v, i, a) => a.indexOf(v) === i); // dedupe

  const accessInfo: Record<number, any> = {};
  for (const uid of allUserIds) {
    const { data: access } = await intelligenceDb
      .from("users_access")
      .select("id_workspace, flag_access_enginegpt")
      .eq("user_target", uid);
    const { data: members } = await intelligenceDb
      .from("workspace_members")
      .select("workspace_id, role")
      .eq("user_id", uid);
    accessInfo[uid] = { access, members };
  }

  return NextResponse.json({
    byEmail,
    byName,
    byPartialEmail,
    accessInfo,
  });
}
