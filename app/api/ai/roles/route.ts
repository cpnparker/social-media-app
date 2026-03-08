import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { aiRoles } from "@/lib/db/schema";
import { eq, and, count, asc } from "drizzle-orm";

const DEFAULT_ROLES = [
  {
    name: "Content Strategist",
    description: "Expert content strategist helping plan, create, and optimize content",
    instructions:
      "You are an expert content strategist. Focus on content planning, editorial calendars, audience targeting, and content optimization. Provide actionable content strategies backed by best practices. When reviewing content, assess it against strategic goals, audience fit, and distribution potential. Always think about the content lifecycle — from ideation through production to distribution and performance measurement.",
    icon: "📝",
    sortOrder: 0,
  },
  {
    name: "Research Analyst",
    description: "Deep-dive researcher providing data-driven insights and analysis",
    instructions:
      "You are a research analyst. Provide thorough, evidence-based analysis. When asked about topics, go deep — cite frameworks, methodologies, and industry benchmarks. Present findings in structured formats with clear takeaways. Question assumptions, identify gaps in data, and suggest areas for further investigation. Be precise with data and transparent about limitations.",
    icon: "🔍",
    sortOrder: 1,
  },
  {
    name: "Business Analyst",
    description: "Strategic business analyst focusing on metrics, ROI, and growth",
    instructions:
      "You are a strategic business analyst. Focus on business metrics, ROI analysis, growth strategies, and competitive positioning. Translate data into actionable business recommendations. Use frameworks like SWOT, Porter's Five Forces, and value chain analysis where appropriate. Always connect content performance back to business outcomes and revenue impact.",
    icon: "📊",
    sortOrder: 2,
  },
  {
    name: "Social Media Expert",
    description: "Social media specialist for platform strategy and engagement",
    instructions:
      "You are a social media expert. Specialize in platform-specific strategies for LinkedIn, Instagram, Twitter/X, Facebook, TikTok, and YouTube. Advise on content formats, posting cadence, hashtag strategy, engagement tactics, and community management. Stay current on algorithm changes and platform best practices. Focus on building authentic audience connections and measurable engagement growth.",
    icon: "📱",
    sortOrder: 3,
  },
  {
    name: "SEO Specialist",
    description: "Search engine optimization expert for visibility and rankings",
    instructions:
      "You are an SEO specialist. Focus on search engine optimization including keyword research, on-page SEO, technical SEO, and link building strategies. Provide specific, actionable recommendations for improving search visibility. Analyze content for SEO readiness, suggest keyword opportunities, and advise on content structure for maximum organic reach. Consider both traditional search and AI-powered search engines.",
    icon: "🔎",
    sortOrder: 4,
  },
  {
    name: "Brand Strategist",
    description: "Brand positioning and messaging expert for consistent identity",
    instructions:
      "You are a brand strategist. Focus on brand positioning, messaging frameworks, tone of voice, and brand consistency. Help craft compelling brand narratives and ensure all communications align with the brand's core identity. Advise on brand architecture, visual identity guidelines, and how to maintain brand coherence across channels and content types.",
    icon: "✨",
    sortOrder: 5,
  },
  {
    name: "Copywriter",
    description: "Creative copywriter producing compelling, publication-ready content",
    instructions:
      "You are a professional copywriter. Produce compelling, publication-ready copy that engages readers and drives action. Master various formats — headlines, body copy, CTAs, email subject lines, ad copy, and long-form articles. Write with clarity, personality, and purpose. Adapt tone and style to match the brand and audience. Every word should earn its place.",
    icon: "✍️",
    sortOrder: 6,
  },
];

async function seedDefaultRoles(workspaceId: string) {
  await db.insert(aiRoles).values(
    DEFAULT_ROLES.map((role) => ({
      workspaceId,
      name: role.name,
      description: role.description,
      instructions: role.instructions,
      icon: role.icon,
      isDefault: true,
      isActive: true,
      sortOrder: role.sortOrder,
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

  try {
    // Check if any roles exist for this workspace
    const [roleCount] = await db
      .select({ total: count() })
      .from(aiRoles)
      .where(eq(aiRoles.workspaceId, workspaceId));

    // Auto-seed defaults on first access
    if (!roleCount || roleCount.total === 0) {
      await seedDefaultRoles(workspaceId);
    }

    const roles = await db
      .select()
      .from(aiRoles)
      .where(eq(aiRoles.workspaceId, workspaceId))
      .orderBy(asc(aiRoles.sortOrder));

    return NextResponse.json({ roles });
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

    // Get max sort order
    const existing = await db
      .select({ total: count() })
      .from(aiRoles)
      .where(eq(aiRoles.workspaceId, workspaceId));

    const [role] = await db
      .insert(aiRoles)
      .values({
        workspaceId,
        name,
        description,
        instructions,
        icon,
        isDefault: false,
        isActive: true,
        sortOrder: existing[0]?.total || 0,
      })
      .returning();

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

    const updateData: Record<string, any> = { updatedAt: new Date() };
    if (name !== undefined) updateData.name = name;
    if (description !== undefined) updateData.description = description;
    if (instructions !== undefined) updateData.instructions = instructions;
    if (icon !== undefined) updateData.icon = icon;
    if (isActive !== undefined) updateData.isActive = isActive;
    if (sortOrder !== undefined) updateData.sortOrder = sortOrder;

    const [updated] = await db
      .update(aiRoles)
      .set(updateData)
      .where(eq(aiRoles.id, roleId))
      .returning();

    if (!updated) {
      return NextResponse.json({ error: "Role not found" }, { status: 404 });
    }

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
    await db.delete(aiRoles).where(eq(aiRoles.id, roleId));
    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
