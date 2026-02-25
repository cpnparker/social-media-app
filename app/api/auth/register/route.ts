import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { supabase } from "@/lib/supabase";

export async function POST(req: NextRequest) {
  try {
    const { name, email, password } = await req.json();

    if (!name || !email || !password) {
      return NextResponse.json(
        { error: "Name, email, and password are required" },
        { status: 400 }
      );
    }

    if (password.length < 8) {
      return NextResponse.json(
        { error: "Password must be at least 8 characters" },
        { status: 400 }
      );
    }

    // Check if user already exists
    const { data: existing } = await supabase
      .from("users")
      .select("id_user")
      .eq("email_user", email)
      .is("date_deleted", null)
      .single();

    if (existing) {
      return NextResponse.json(
        { error: "An account with this email already exists" },
        { status: 409 }
      );
    }

    // Create user (hashed_password column not yet available in Supabase)
    // TODO: Add hashed_password column and store bcrypt hash
    const { data: newUser, error: insertError } = await supabase
      .from("users")
      .insert({
        name_user: name,
        email_user: email,
        date_created: new Date().toISOString(),
      })
      .select("id_user, email_user, name_user")
      .single();

    if (insertError || !newUser) {
      throw insertError || new Error("Failed to create user");
    }

    // Create a default workspace for the new user
    const slug = email.split("@")[0].replace(/[^a-z0-9-]/gi, "-").toLowerCase();
    const { data: workspace, error: wsError } = await supabase
      .from("workspaces")
      .insert({
        name: `${name}'s Workspace`,
        slug: `${slug}-${newUser.id_user}`,
        plan: "free",
      })
      .select("id")
      .single();

    if (wsError || !workspace) {
      throw wsError || new Error("Failed to create workspace");
    }

    // Add user as admin of their workspace
    await supabase.from("workspace_members").insert({
      workspace_id: workspace.id,
      user_id: newUser.id_user,
      role: "admin",
    });

    return NextResponse.json(
      {
        user: {
          id: String(newUser.id_user),
          email: newUser.email_user,
          name: newUser.name_user,
        },
      },
      { status: 201 }
    );
  } catch (error: any) {
    console.error("Registration error:", error);
    return NextResponse.json(
      { error: "Failed to create account" },
      { status: 500 }
    );
  }
}
