import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { intelligenceDb } from "@/lib/supabase-intelligence";
import { verifyWorkspaceMembership } from "@/lib/permissions";
import {
  TCE_COMPANY_PROFILE,
  DEFAULT_WIN_THEMES,
} from "@/lib/rfp/company-profile";

/** Parse the hardcoded profile into individual sections as defaults */
function getDefaults() {
  const lines = TCE_COMPANY_PROFILE.split("\n");
  const sections: Record<string, string[]> = {};
  let currentKey = "overview";
  sections[currentKey] = [];

  for (const line of lines) {
    if (line.startsWith("Core Services:")) {
      currentKey = "services";
      sections[currentKey] = [];
    } else if (line.startsWith("Key Sectors:")) {
      currentKey = "sectors";
      sections[currentKey] = [];
    } else if (line.startsWith("Differentiators:")) {
      currentKey = "differentiators";
      sections[currentKey] = [];
    } else if (line.startsWith("Target RFP Types:")) {
      currentKey = "target_rfps";
      sections[currentKey] = [];
    } else {
      sections[currentKey]?.push(line);
    }
  }

  return {
    document_overview: (sections.overview || []).join("\n").trim(),
    document_services: (sections.services || []).join("\n").trim(),
    document_sectors: (sections.sectors || []).join("\n").trim(),
    document_differentiators: (sections.differentiators || []).join("\n").trim(),
    document_target_rfps: (sections.target_rfps || []).join("\n").trim(),
    config_win_themes: DEFAULT_WIN_THEMES,
    url_website: "",
    url_linkedin: "",
  };
}

// GET /api/rfp/company-profile?workspaceId=...
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = parseInt(session.user.id, 10);

  const { searchParams } = new URL(req.url);
  const workspaceId = searchParams.get("workspaceId");

  if (!workspaceId) {
    return NextResponse.json({ error: "workspaceId is required" }, { status: 400 });
  }

  const memberRole = await verifyWorkspaceMembership(userId, workspaceId);
  if (!memberRole) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const { data, error } = await intelligenceDb
      .from("rfp_company_profiles")
      .select("*")
      .eq("id_workspace", workspaceId)
      .maybeSingle();

    if (error) throw error;

    // Return stored profile or defaults
    const profile = data || { ...getDefaults(), id_workspace: workspaceId, isDefault: true };

    return NextResponse.json({ profile });
  } catch (error: any) {
    console.error("[Company Profile] GET error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// PATCH /api/rfp/company-profile — upsert profile
export async function PATCH(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = parseInt(session.user.id, 10);

  try {
    const body = await req.json();
    const { workspaceId, ...fields } = body;

    if (!workspaceId) {
      return NextResponse.json({ error: "workspaceId is required" }, { status: 400 });
    }

    const memberRole = await verifyWorkspaceMembership(userId, workspaceId);
    if (!memberRole) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // Whitelist allowed fields
    const allowed = [
      "document_overview",
      "document_services",
      "document_sectors",
      "document_differentiators",
      "document_target_rfps",
      "config_win_themes",
      "url_website",
      "url_linkedin",
    ];

    const updatePayload: Record<string, any> = {
      id_workspace: workspaceId,
      user_updated: userId,
      date_updated: new Date().toISOString(),
    };

    for (const key of allowed) {
      if (key in fields) updatePayload[key] = fields[key];
    }

    // Upsert (insert or update on conflict)
    const { data, error } = await intelligenceDb
      .from("rfp_company_profiles")
      .upsert(updatePayload, { onConflict: "id_workspace" })
      .select()
      .single();

    if (error) throw error;

    return NextResponse.json({ profile: data });
  } catch (error: any) {
    console.error("[Company Profile] PATCH error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
