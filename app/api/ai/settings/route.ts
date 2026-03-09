import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { workspaces } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { getAvailableModels } from "@/lib/ai/providers";
import { normalizeContextConfig } from "@/lib/ai/system-prompts";
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
        aiDebugMode: workspaces.aiDebugMode,
        aiFormatDescriptions: workspaces.aiFormatDescriptions,
        aiTypeInstructions: workspaces.aiTypeInstructions,
      })
      .from(workspaces)
      .where(eq(workspaces.id, workspaceId))
      .limit(1);

    // Fetch CU definitions and content types from Supabase
    const [{ data: cuDefs }, { data: contentTypes }] = await Promise.all([
      supabase
        .from("calculator_content")
        .select("id, name, format, units_content, sort_order, id_type")
        .order("sort_order"),
      supabase
        .from("types_content")
        .select("id_type, key_type, type_content"),
    ]);

    // Build type lookup map
    const typeMap: Record<number, { key: string; name: string }> = {};
    (contentTypes || []).forEach((t: any) => {
      typeMap[t.id_type] = { key: t.key_type, name: t.type_content };
    });

    // Format descriptions stored in Neon workspaces table
    const formatDescriptions: Record<string, string> = workspace?.aiFormatDescriptions || {};

    return NextResponse.json({
      currentModel: workspace?.aiModel || "grok-4-1-fast",
      availableModels: getAvailableModels(),
      contextConfig: normalizeContextConfig(workspace?.aiContextConfig),
      cuDescription: workspace?.aiCuDescription || "",
      maxTokens: workspace?.aiMaxTokens || 4096,
      debugMode: workspace?.aiDebugMode || false,
      cuDefinitions: (cuDefs || []).map((c: any) => ({
        id: c.id,
        format: c.name,
        category: typeMap[c.id_type]?.key || c.format || "other",
        categoryName: typeMap[c.id_type]?.name || "",
        units: c.units_content,
        description: formatDescriptions[c.id] || "",
      })),
      contentTypes: (contentTypes || []).map((t: any) => ({
        id: t.id_type,
        key: t.key_type,
        name: t.type_content,
      })),
      typeInstructions: workspace?.aiTypeInstructions || {},
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
    const { workspaceId, model, contextConfig, cuDescription, maxTokens, debugMode, formatDescriptions, typeInstructions } = body;

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
    if (debugMode !== undefined) updateData.aiDebugMode = debugMode;

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

    // Update format descriptions in Neon workspaces table
    if (formatDescriptions && typeof formatDescriptions === "object") {
      // Merge with existing descriptions
      const [current] = await db
        .select({ aiFormatDescriptions: workspaces.aiFormatDescriptions })
        .from(workspaces)
        .where(eq(workspaces.id, workspaceId))
        .limit(1);

      const merged = { ...(current?.aiFormatDescriptions || {}), ...formatDescriptions };
      await db
        .update(workspaces)
        .set({ aiFormatDescriptions: merged, updatedAt: new Date() })
        .where(eq(workspaces.id, workspaceId));
    }

    // Update type instructions in Neon workspaces table
    if (typeInstructions && typeof typeInstructions === "object") {
      const [current] = await db
        .select({ aiTypeInstructions: workspaces.aiTypeInstructions })
        .from(workspaces)
        .where(eq(workspaces.id, workspaceId))
        .limit(1);

      const merged = { ...(current?.aiTypeInstructions || {}), ...typeInstructions };
      await db
        .update(workspaces)
        .set({ aiTypeInstructions: merged, updatedAt: new Date() })
        .where(eq(workspaces.id, workspaceId));
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
