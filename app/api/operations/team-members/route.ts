import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { requireAuth } from "@/lib/permissions";

// GET /api/operations/team-members
// Returns the full list of users from app_users so client-side team
// pickers can include people who aren't in the hardcoded TEAMS structure.
export async function GET(_req: NextRequest) {
  const authResult = await requireAuth();
  if (authResult instanceof NextResponse) return authResult;

  try {
    const { data, error } = await supabase
      .from("app_users")
      .select("id_user, name_user, email_user, role_job, role_user")
      .order("name_user", { ascending: true });

    if (error) throw error;

    const users = (data || [])
      .filter((u) => u.id_user != null && u.name_user)
      .map((u) => ({
        id: String(u.id_user),
        name: u.name_user as string,
        email: u.email_user as string | null,
        roleJob: u.role_job as string | null,
        roleUser: u.role_user as string | null,
      }));

    return NextResponse.json({ users });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[team-members] failed:", err);
    return NextResponse.json(
      { error: "Failed to load team members" },
      { status: 500 },
    );
  }
}
