import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { auth } from "@/lib/auth";

// GET /api/customer-members?customerId=xxx — list members for a customer
export async function GET(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const customerId = searchParams.get("customerId");

    if (!customerId) {
      return NextResponse.json(
        { error: "customerId query param is required" },
        { status: 400 }
      );
    }

    // Use the view to get user-client assignments with names
    const { data: rows, error } = await supabase
      .from("app_lookup_users_clients")
      .select("*")
      .eq("id_client", parseInt(customerId, 10));

    if (error) throw error;

    const members = (rows || []).map((r) => ({
      id: `${r.id_user}-${r.id_client}`,
      customerId: r.id_client ? String(r.id_client) : null,
      userId: String(r.id_user),
      role: r.role_user || "viewer",
      userName: r.name_user,
      userEmail: r.email_user,
      userAvatar: null,
    }));

    return NextResponse.json({ members });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// POST /api/customer-members — assign user to customer
export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { customerId, email, role, name } = await req.json();

    if (!customerId || !email) {
      return NextResponse.json(
        { error: "customerId and email are required" },
        { status: 400 }
      );
    }

    const normalizedEmail = email.trim().toLowerCase();
    const clientId = parseInt(customerId, 10);

    // Find or create user
    let { data: existingUser } = await supabase
      .from("users")
      .select("*")
      .eq("email_user", normalizedEmail)
      .is("date_deleted", null)
      .limit(1)
      .single();

    if (!existingUser) {
      const namePart = normalizedEmail.split("@")[0].replace(/[._-]/g, " ");
      const displayName = name || namePart.replace(/\b\w/g, (c: string) => c.toUpperCase());

      const { data: newUser, error: createErr } = await supabase
        .from("users")
        .insert({
          email_user: normalizedEmail,
          name_user: displayName,
          provider: "email",
          date_created: new Date().toISOString(),
        })
        .select()
        .single();

      if (createErr) throw createErr;
      existingUser = newUser;
    }

    // Check if already assigned
    const { data: existing } = await supabase
      .from("lookup_users_clients")
      .select("id_user")
      .eq("id_client", clientId)
      .eq("id_user", existingUser.id_user)
      .limit(1)
      .single();

    if (existing) {
      return NextResponse.json(
        { error: "User is already a member of this customer" },
        { status: 409 }
      );
    }

    await supabase.from("lookup_users_clients").insert({
      id_client: clientId,
      id_user: existingUser.id_user,
    });

    return NextResponse.json({
      member: {
        userId: String(existingUser.id_user),
        customerId: String(clientId),
        userName: existingUser.name_user,
        userEmail: existingUser.email_user,
        role: role || "viewer",
      },
    }, { status: 201 });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// DELETE /api/customer-members?customerId=xxx&userId=yyy
export async function DELETE(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const customerId = searchParams.get("customerId");
    const userId = searchParams.get("userId");

    if (!customerId || !userId) {
      return NextResponse.json(
        { error: "customerId and userId query params are required" },
        { status: 400 }
      );
    }

    const { error } = await supabase
      .from("lookup_users_clients")
      .delete()
      .eq("id_client", parseInt(customerId, 10))
      .eq("id_user", parseInt(userId, 10));

    if (error) throw error;

    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
