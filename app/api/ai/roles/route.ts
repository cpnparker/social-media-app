import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { intelligenceDb } from "@/lib/supabase-intelligence";
import { verifyWorkspaceMembership } from "@/lib/permissions";

const DEFAULT_ROLES = [
  {
    name: "Content Strategist",
    description: "Expert content strategist helping plan, create, and optimize content",
    instructions:
      "You are an expert content strategist. Focus on content planning, editorial calendars, audience targeting, and content optimization. Provide actionable content strategies backed by best practices. When reviewing content, assess it against strategic goals, audience fit, and distribution potential. Always think about the content lifecycle — from ideation through production to distribution and performance measurement.",
    icon: "📝",
    order_sort: 0,
  },
  {
    name: "Research Analyst",
    description: "Deep-dive researcher providing data-driven insights and analysis",
    instructions:
      "You are a research analyst. Provide thorough, evidence-based analysis. When asked about topics, go deep — cite frameworks, methodologies, and industry benchmarks. Present findings in structured formats with clear takeaways. Question assumptions, identify gaps in data, and suggest areas for further investigation. Be precise with data and transparent about limitations.",
    icon: "🔍",
    order_sort: 1,
  },
  {
    name: "Business Analyst",
    description: "Strategic business analyst focusing on metrics, ROI, and growth",
    instructions:
      "You are a strategic business analyst. Focus on business metrics, ROI analysis, growth strategies, and competitive positioning. Translate data into actionable business recommendations. Use frameworks like SWOT, Porter's Five Forces, and value chain analysis where appropriate. Always connect content performance back to business outcomes and revenue impact.",
    icon: "📊",
    order_sort: 2,
  },
  {
    name: "Social Media Expert",
    description: "Social media specialist for platform strategy and engagement",
    instructions:
      "You are a social media expert. Specialize in platform-specific strategies for LinkedIn, Instagram, Twitter/X, Facebook, TikTok, and YouTube. Advise on content formats, posting cadence, hashtag strategy, engagement tactics, and community management. Stay current on algorithm changes and platform best practices. Focus on building authentic audience connections and measurable engagement growth.",
    icon: "📱",
    order_sort: 3,
  },
  {
    name: "SEO Specialist",
    description: "Search engine optimization expert for visibility and rankings",
    instructions:
      "You are an SEO specialist. Focus on search engine optimization including keyword research, on-page SEO, technical SEO, and link building strategies. Provide specific, actionable recommendations for improving search visibility. Analyze content for SEO readiness, suggest keyword opportunities, and advise on content structure for maximum organic reach. Consider both traditional search and AI-powered search engines.",
    icon: "🔎",
    order_sort: 4,
  },
  {
    name: "Brand Strategist",
    description: "Brand positioning and messaging expert for consistent identity",
    instructions:
      "You are a brand strategist. Focus on brand positioning, messaging frameworks, tone of voice, and brand consistency. Help craft compelling brand narratives and ensure all communications align with the brand's core identity. Advise on brand architecture, visual identity guidelines, and how to maintain brand coherence across channels and content types.",
    icon: "✨",
    order_sort: 5,
  },
  {
    name: "Copywriter",
    description: "Creative copywriter producing compelling, publication-ready content",
    instructions:
      "You are a professional copywriter. Produce compelling, publication-ready copy that engages readers and drives action. Master various formats — headlines, body copy, CTAs, email subject lines, ad copy, and long-form articles. Write with clarity, personality, and purpose. Adapt tone and style to match the brand and audience. Every word should earn its place.",
    icon: "✍️",
    order_sort: 6,
  },
];

async function seedDefaultRoles(workspaceId: string) {
  await intelligenceDb.from("ai_roles").insert(
    DEFAULT_ROLES.map((role) => ({
      id_workspace: workspaceId,
      name_role: role.name,
      information_description: role.description,
      information_instructions: role.instructions,
      name_icon: role.icon,
      flag_default: 1,
      flag_active: 1,
      order_sort: role.order_sort,
    }))
  );
}

// GET /api/ai/roles — list roles for a workspace (auto-seeds on first access)
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
    // Check if any roles exist for this workspace
    const { count: roleCount } = await intelligenceDb
      .from("ai_roles")
      .select("*", { count: "exact", head: true })
      .eq("id_workspace", workspaceId);

    // Auto-seed defaults on first access
    if (!roleCount || roleCount === 0) {
      await seedDefaultRoles(workspaceId);
    }

    const { data: roles, error } = await intelligenceDb
      .from("ai_roles")
      .select("*")
      .eq("id_workspace", workspaceId)
      .order("order_sort", { ascending: true });

    if (error) throw error;

    return NextResponse.json({ roles: roles || [] });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// POST /api/ai/roles — create a new role
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await req.json();
    const { workspaceId, name, description, instructions, icon = "🤖" } = body;

    if (!workspaceId || !name || !description || !instructions) {
      return NextResponse.json(
        { error: "workspaceId, name, description, and instructions are required" },
        { status: 400 }
      );
    }

    // Verify user belongs to this workspace with admin/owner role
    const userId = parseInt(session.user.id, 10);
    const memberRole = await verifyWorkspaceMembership(userId, workspaceId);
    if (!memberRole || !["owner", "admin"].includes(memberRole)) {
      return NextResponse.json({ error: "Admin access required" }, { status: 403 });
    }

    // Get current count for sort order
    const { count: existing } = await intelligenceDb
      .from("ai_roles")
      .select("*", { count: "exact", head: true })
      .eq("id_workspace", workspaceId);

    const { data: role, error } = await intelligenceDb
      .from("ai_roles")
      .insert({
        id_workspace: workspaceId,
        name_role: name,
        information_description: description,
        information_instructions: instructions,
        name_icon: icon,
        flag_default: 0,
        flag_active: 1,
        order_sort: existing || 0,
      })
      .select()
      .single();

    if (error) throw error;

    return NextResponse.json({ role });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// PATCH /api/ai/roles — update a role
export async function PATCH(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await req.json();
    const { roleId, name, description, instructions, icon, isActive, sortOrder } = body;

    if (!roleId) {
      return NextResponse.json({ error: "roleId is required" }, { status: 400 });
    }

    // Fetch the role first to verify workspace ownership
    const { data: existingRole } = await intelligenceDb
      .from("ai_roles")
      .select("id_role, id_workspace")
      .eq("id_role", roleId)
      .maybeSingle();

    if (!existingRole) {
      return NextResponse.json({ error: "Role not found" }, { status: 404 });
    }

    // Verify user belongs to the role's workspace with admin/owner role
    const userId = parseInt(session.user.id, 10);
    const memberRole = await verifyWorkspaceMembership(userId, existingRole.id_workspace);
    if (!memberRole || !["owner", "admin"].includes(memberRole)) {
      return NextResponse.json({ error: "Admin access required" }, { status: 403 });
    }

    const updateData: Record<string, any> = { date_updated: new Date().toISOString() };
    if (name !== undefined) updateData.name_role = name;
    if (description !== undefined) updateData.information_description = description;
    if (instructions !== undefined) updateData.information_instructions = instructions;
    if (icon !== undefined) updateData.name_icon = icon;
    if (isActive !== undefined) updateData.flag_active = isActive ? 1 : 0;
    if (sortOrder !== undefined) updateData.order_sort = sortOrder;

    const { data: updated, error } = await intelligenceDb
      .from("ai_roles")
      .update(updateData)
      .eq("id_role", roleId)
      .select()
      .single();

    if (error) throw error;

    return NextResponse.json({ role: updated });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// DELETE /api/ai/roles — delete a role
export async function DELETE(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const roleId = searchParams.get("roleId");

  if (!roleId) {
    return NextResponse.json({ error: "roleId is required" }, { status: 400 });
  }

  try {
    // Fetch the role first to verify workspace ownership
    const { data: existingRole } = await intelligenceDb
      .from("ai_roles")
      .select("id_role, id_workspace")
      .eq("id_role", roleId)
      .maybeSingle();

    if (!existingRole) {
      return NextResponse.json({ error: "Role not found" }, { status: 404 });
    }

    // Verify user belongs to the role's workspace with admin/owner role
    const userId = parseInt(session.user.id, 10);
    const memberRole = await verifyWorkspaceMembership(userId, existingRole.id_workspace);
    if (!memberRole || !["owner", "admin"].includes(memberRole)) {
      return NextResponse.json({ error: "Admin access required" }, { status: 403 });
    }

    await intelligenceDb
      .from("ai_roles")
      .delete()
      .eq("id_role", roleId);

    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
