import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { ideas, contentObjects, contracts } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { createTasksFromTemplates } from "@/lib/task-template-utils";

// POST /api/ideas/[id]/commission — commission an idea into a content object
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await req.json().catch(() => ({}));

    // Fetch the idea
    const [idea] = await db.select().from(ideas).where(eq(ideas.id, id)).limit(1);

    if (!idea) {
      return NextResponse.json({ error: "Idea not found" }, { status: 404 });
    }

    // Resolve customer/contract/CU fields
    const customerId = body.customerId || idea.customerId || null;
    const contractId = body.contractId || null;
    const contentUnits = body.contentUnits ? parseFloat(body.contentUnits) : null;

    // If a contract is specified, validate and deduct CUs
    let contractBalance = null;
    if (contractId && contentUnits && contentUnits > 0) {
      const [contract] = await db
        .select()
        .from(contracts)
        .where(eq(contracts.id, contractId))
        .limit(1);

      if (!contract) {
        return NextResponse.json({ error: "Contract not found" }, { status: 404 });
      }

      if (contract.status !== "active") {
        return NextResponse.json(
          { error: "Contract is not active. Only active contracts can be charged." },
          { status: 400 }
        );
      }

      // Validate workspace match
      if (contract.workspaceId !== idea.workspaceId) {
        return NextResponse.json(
          { error: "Contract does not belong to this workspace" },
          { status: 400 }
        );
      }

      // Validate customer match if both specified
      if (customerId && contract.customerId !== customerId) {
        return NextResponse.json(
          { error: "Contract does not belong to the selected customer" },
          { status: 400 }
        );
      }

      // Check balance
      const totalBudget = (contract.totalContentUnits || 0) + (contract.rolloverUnits || 0);
      const currentUsed = contract.usedContentUnits || 0;
      const remaining = totalBudget - currentUsed;

      if (contentUnits > remaining) {
        return NextResponse.json(
          {
            error: `Insufficient content units. Requested: ${contentUnits}, Available: ${remaining.toFixed(2)}`,
            remaining,
            requested: contentUnits,
          },
          { status: 400 }
        );
      }

      // Deduct CUs from contract
      await db
        .update(contracts)
        .set({
          usedContentUnits: currentUsed + contentUnits,
          updatedAt: new Date(),
        })
        .where(eq(contracts.id, contractId));

      // Calculate updated balance for response
      contractBalance = {
        total: totalBudget,
        used: currentUsed + contentUnits,
        remaining: remaining - contentUnits,
        percentUsed: totalBudget > 0 ? ((currentUsed + contentUnits) / totalBudget) * 100 : 0,
      };
    }

    // Update idea status to commissioned
    await db
      .update(ideas)
      .set({
        status: "commissioned",
        customerId: customerId,
        updatedAt: new Date(),
      })
      .where(eq(ideas.id, id));

    // Create a content object linked to this idea
    const [contentObject] = await db
      .insert(contentObjects)
      .values({
        ideaId: id,
        workspaceId: idea.workspaceId,
        contentType: body.contentType || "article",
        workingTitle: idea.title,
        body: idea.description || "",
        status: "draft",
        formatTags: idea.topicTags || [],
        campaignTags: idea.strategicTags || [],
        createdBy: body.createdBy || idea.createdBy,
        customerId: customerId,
        contractId: contractId,
        contentUnits: contentUnits,
      })
      .returning();

    // Auto-create production tasks from templates for this content type
    const contentType = body.contentType || "article";
    await createTasksFromTemplates(
      contentObject.id,
      contentType,
      idea.workspaceId,
      body.createdBy || idea.createdBy
    );

    return NextResponse.json({
      contentObject,
      idea: { ...idea, status: "commissioned", customerId },
      contractBalance,
    });
  } catch (error: any) {
    console.error("Commission error:", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
