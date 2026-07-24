import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { intelligenceDb } from "@/lib/supabase-intelligence";
import { verifyWorkspaceMembership } from "@/lib/permissions";
import { findService } from "@/lib/admin/service-registry";

interface PutBody {
  app: string;
  typeSource: string;
  provider: string;
  /** When null/empty, removes the override (falls back to code default). */
  model: string | null;
}

async function adminGuard(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return { ok: false as const, response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }
  const { searchParams } = new URL(req.url);
  const workspaceId = searchParams.get("workspaceId");
  if (!workspaceId) {
    return { ok: false as const, response: NextResponse.json({ error: "workspaceId is required" }, { status: 400 }) };
  }
  const userId = parseInt(session.user.id, 10);
  const role = await verifyWorkspaceMembership(userId, workspaceId);
  if (!role || (role !== "owner" && role !== "admin")) {
    return { ok: false as const, response: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }
  return { ok: true as const, session, userId };
}

export async function PUT(req: NextRequest) {
  const guard = await adminGuard(req);
  if (!guard.ok) return guard.response;

  const body = (await req.json()) as PutBody;
  if (!body.app || !body.typeSource || !body.provider) {
    return NextResponse.json({ error: "app, typeSource, provider required" }, { status: 400 });
  }
  if (!findService(body.app, body.typeSource)) {
    return NextResponse.json(
      { error: `Unknown service ${body.app}/${body.typeSource}` },
      { status: 400 },
    );
  }

  // Empty model = clear the override.
  if (!body.model || !body.model.trim()) {
    const { error } = await intelligenceDb
      .from("model_overrides")
      .delete()
      .eq("app", body.app)
      .eq("type_source", body.typeSource)
      .eq("provider", body.provider);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true, cleared: true });
  }

  const { error } = await intelligenceDb.from("model_overrides").upsert(
    {
      app: body.app,
      type_source: body.typeSource,
      provider: body.provider,
      model: body.model.trim(),
      updated_at: new Date().toISOString(),
      updated_by: guard.session.user.email ?? String(guard.userId),
    },
    { onConflict: "app,type_source,provider" },
  );
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
