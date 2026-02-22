import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";
import { users, workspaces, workspaceMembers } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

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
    const existing = await db.query.users.findFirst({
      where: eq(users.email, email),
    });

    if (existing) {
      return NextResponse.json(
        { error: "An account with this email already exists" },
        { status: 409 }
      );
    }

    // Hash password and create user
    const hashedPassword = await bcrypt.hash(password, 12);

    const [newUser] = await db
      .insert(users)
      .values({
        name,
        email,
        hashedPassword,
        provider: "email",
      })
      .returning();

    // Create a default workspace for the new user
    const slug = email.split("@")[0].replace(/[^a-z0-9-]/gi, "-").toLowerCase();
    const [workspace] = await db
      .insert(workspaces)
      .values({
        name: `${name}'s Workspace`,
        slug: `${slug}-${newUser.id.slice(0, 8)}`,
      })
      .returning();

    // Add user as admin of their workspace
    await db.insert(workspaceMembers).values({
      workspaceId: workspace.id,
      userId: newUser.id,
      role: "admin",
    });

    return NextResponse.json(
      { user: { id: newUser.id, email: newUser.email, name: newUser.name } },
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
