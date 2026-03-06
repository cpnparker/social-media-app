import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { workspaces } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { getAvailableModels } from "@/lib/ai/providers";
import { supabase } from "@/lib/supabase";

// Ensure workspace row exists in Neon (lazy-create from Supabase)
async function ensureNeonWorkspace(workspaceId: string) {
  const existing = await db
    .select({ id: workspaces.id })
    .from(workspaces)
    .where(eq(workspaces.id, workspaceId))
    .limit(1);

  if (existing.length === 0) {
    const { data: supaWs } = await supabase
      .from("workspaces")
      .select("id, name, slug, plan")
      .eq("id", workspaceId)
      .single();

    if (supaWs) {
      await db
        .insert(workspaces)
        .values({
          id: supaWs.id,
          name: supaWs.name,
          slug: supaWs.slug,
          plan: supaWs.plan || "free",
        })
        .onConflictDoNothing();
    }
  }
}

// GET /api/ai/settings — get workspace AI settings + context config + CU definitions
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const workspaceId = searchParams.get("workspaceId");

  if (!workspaceId) {
    return NextResponse.json({ error: "workspaceId is required" }, { status: 400 });
  }

  try {
    // Ensure Neon row exists before reading
    await ensureNeonWorkspace(workspaceId);

    const [workspace] = await db
      .select({
        aiModel: workspaces.aiModel,
        aiContextConfig: workspaces.aiContextConfig,
        aiCuDescription: workspaces.aiCuDescription,
        aiMaxTokens: workspaces.aiMaxTokens,
      })
      .from(workspaces)
      .where(eq(workspaces.id, workspaceId))
      .limit(1);

    // Fetch CU definitions from Supabase
    const { data: cuDefs } = await supabase
      .from("calculator_content")
      .select("name, format, units_content, cu_category")
      .order("sort_order");

    return NextResponse.json({
      currentModel: workspace?.aiModel || "grok-4-1-fast",
      availableModels: getAvailableModels(),
      contextConfig: workspace?.aiContextConfig || {
        contracts: true,
        contentPipeline: true,
        socialPresence: true,
      },
      cuDescription: workspace?.aiCuDescription || "",
      maxTokens: workspace?.aiMaxTokens || 4096,
      cuDefinitions: (cuDefs || []).map((c: any) => ({
        format: c.name,
        category: c.cu_category || c.format,
        units: c.units_content,
      })),
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// PATCH /api/ai/settings — update workspace AI settings
export async function PATCH(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await req.json();
    const { workspaceId, model, contextConfig, cuDescription, maxTokens } = body;

    if (!workspaceId) {
      return NextResponse.json(
        { error: "workspaceId is required" },
        { status: 400 }
      );
    }

    // Ensure Neon row exists before updating
    await ensureNeonWorkspace(workspaceId);

    const updateData: Record<string, any> = { updatedAt: new Date() };
    if (model !== undefined) updateData.aiModel = model;
    if (contextConfig !== undefined) updateData.aiContextConfig = contextConfig;
    if (cuDescription !== undefined) updateData.aiCuDescription = cuDescription;
    if (maxTokens !== undefined) updateData.aiMaxTokens = maxTokens;

    await db
      .update(workspaces)
      .set(updateData)
      .where(eq(workspaces.id, workspaceId));

    // Sync aiModel to Supabase for backward compatibility
    if (model !== undefined) {
      await supabase
        .from("workspaces")
        .update({ ai_model: model })
        .eq("id", workspaceId);
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
