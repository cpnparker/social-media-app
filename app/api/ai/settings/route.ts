import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { intelligenceDb } from "@/lib/supabase-intelligence";
import { getAvailableModels } from "@/lib/ai/providers";
import { normalizeContextConfig } from "@/lib/ai/system-prompts";
import { supabase } from "@/lib/supabase";
import { verifyWorkspaceMembership } from "@/lib/permissions";

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

  // Verify user belongs to this workspace
  const userId = parseInt(session.user.id, 10);
  const memberRole = await verifyWorkspaceMembership(userId, workspaceId);
  if (!memberRole) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    // Fetch or auto-create settings row
    let { data: settings } = await intelligenceDb
      .from("ai_settings")
      .select("*")
      .eq("id_workspace", workspaceId)
      .maybeSingle();

    if (!settings) {
      // Auto-create default settings on first access
      const { data: created } = await intelligenceDb
        .from("ai_settings")
        .insert({ id_workspace: workspaceId })
        .select()
        .single();
      settings = created;
    }

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

    // Format descriptions stored in ai_settings
    const formatDescriptions: Record<string, string> = settings?.information_format_descriptions || {};

    return NextResponse.json({
      currentModel: settings?.name_model || "grok-4-1-fast",
      availableModels: getAvailableModels(),
      contextConfig: normalizeContextConfig(settings?.config_context),
      cuDescription: settings?.information_cu_description || "",
      maxTokens: settings?.units_max_tokens || 4096,
      debugMode: settings?.flag_debug || false,
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
      typeInstructions: settings?.information_type_instructions || {},
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

    // Verify user belongs to this workspace and has admin/owner role
    const userId = parseInt(session.user.id, 10);
    const memberRole = await verifyWorkspaceMembership(userId, workspaceId);
    if (!memberRole) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    if (!["owner", "admin"].includes(memberRole)) {
      return NextResponse.json({ error: "Admin access required" }, { status: 403 });
    }

    // Ensure settings row exists
    let { data: settings } = await intelligenceDb
      .from("ai_settings")
      .select("*")
      .eq("id_workspace", workspaceId)
      .maybeSingle();

    if (!settings) {
      const { data: created } = await intelligenceDb
        .from("ai_settings")
        .insert({ id_workspace: workspaceId })
        .select()
        .single();
      settings = created;
    }

    const updateData: Record<string, any> = {
      date_updated: new Date().toISOString(),
    };
    if (model !== undefined) updateData.name_model = model;
    if (contextConfig !== undefined) updateData.config_context = contextConfig;
    if (cuDescription !== undefined) updateData.information_cu_description = cuDescription;
    if (maxTokens !== undefined) updateData.units_max_tokens = maxTokens;
    if (debugMode !== undefined) updateData.flag_debug = debugMode ? 1 : 0;

    // Merge format descriptions with existing
    if (formatDescriptions && typeof formatDescriptions === "object") {
      const merged = { ...(settings?.information_format_descriptions || {}), ...formatDescriptions };
      updateData.information_format_descriptions = merged;
    }

    // Merge type instructions with existing
    if (typeInstructions && typeof typeInstructions === "object") {
      const merged = { ...(settings?.information_type_instructions || {}), ...typeInstructions };
      updateData.information_type_instructions = merged;
    }

    await intelligenceDb
      .from("ai_settings")
      .update(updateData)
      .eq("id_workspace", workspaceId);

    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
