import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { supabase } from "@/lib/supabase";

// GET /api/me — returns the current user's profile
export async function GET() {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userId = parseInt(session.user.id, 10);

    const { data: dbUser } = await supabase
      .from("users")
      .select("id_user, email_user, name_user, role_user")
      .eq("id_user", userId)
      .is("date_deleted", null)
      .single();

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
