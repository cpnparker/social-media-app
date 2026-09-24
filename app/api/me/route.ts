import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { findUserByEmail } from "@/lib/user-lookup";

// GET /api/me — returns the current user's profile
export async function GET() {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userId = parseInt(session.user.id, 10);

    // Primary lookup by ID
    let dbUser: any = null;
    const isValidId = !isNaN(userId) && userId > 0 && userId < 10000000;

    if (isValidId) {
      const { data } = await supabase
        .from("users")
        .select("id_user, email_user, name_user, role_user")
        .eq("id_user", userId)
        .is("date_deleted", null)
        .single();
      dbUser = data;
    }

    // Fallback: lookup by email from JWT (handles Google ID in token.sub)
    if (!dbUser && session.user.email) {
      console.warn(`[/api/me] ID lookup failed for ${session.user.id}, falling back to email: ${session.user.email}`);
      dbUser = await findUserByEmail(
        session.user.email,
        "id_user, email_user, name_user, role_user"
      );
    }

    if (!dbUser) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    return NextResponse.json({
      user: {
        id: String(dbUser.id_user),
        email: dbUser.email_user,
        name: dbUser.name_user,
        role: dbUser.role_user || "none",
      },
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
