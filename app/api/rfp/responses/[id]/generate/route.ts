import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { intelligenceDb } from "@/lib/supabase-intelligence";
import { verifyWorkspaceMembership } from "@/lib/permissions";
import Anthropic from "@anthropic-ai/sdk";
import { logAiUsage } from "@/lib/ai/usage-logger";
import { TCE_COMPANY_PROFILE } from "@/lib/rfp/company-profile";

export const maxDuration = 120;

function getAnthropicClient() {
  return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });
}

// POST /api/rfp/responses/[id]/generate
// Generates content for a specific section
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = parseInt(session.user.id, 10);
  const { id } = await params;

  try {
    const body = await req.json();
    const { sectionId } = body;

    if (!sectionId) {
      return NextResponse.json({ error: "sectionId is required" }, { status: 400 });
    }

    // Fetch response
    const { data: response } = await intelligenceDb
      .from("rfp_responses")
      .select("*")
      .eq("id_response", id)
      .single();

    if (!response) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const memberRole = await verifyWorkspaceMembership(userId, response.id_workspace);
    if (!memberRole) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const sections = response.document_sections || [];
    const section = sections.find((s: any) => s.id === sectionId);
    if (!section) {
      return NextResponse.json({ error: "Section not found" }, { status: 404 });
    }

    // Fetch reference documents from library
    const { data: docs } = await intelligenceDb
      .from("rfp_documents")
      .select("name_file, document_summary, type_document")
      .eq("id_workspace", response.id_workspace)
      .eq("type_extraction_status", "ready")
      .limit(10);

    const referenceMaterial = (docs || [])
      .map(
        (d: any) =>
          `[${d.type_document}: ${d.name_file}]\n${d.document_summary || "No summary available"}`
      )
      .join("\n\n");

    // Fetch opportunity context if linked
    let opportunityContext = "";
    if (response.id_opportunity) {
      const { data: opp } = await intelligenceDb
        .from("rfp_opportunities")
        .select("title, organisation_name, document_scope, document_ai_reasoning")
        .eq("id_opportunity", response.id_opportunity)
        .single();

      if (opp) {
        opportunityContext = `Target RFP: "${opp.title}" by ${opp.organisation_name}
Scope: ${opp.document_scope || "Not specified"}
Context: ${opp.document_ai_reasoning || ""}`;
      }
    }

    const winThemes = (response.config_win_themes || []).length > 0
      ? `Win Themes to weave throughout:\n${(response.config_win_themes as string[]).map((t: string, i: number) => `${i + 1}. ${t}`).join("\n")}`
      : "";

    const anthropic = getAnthropicClient();

    const systemPrompt = `You are an expert RFP response writer for The Content Engine, a content production agency.

Company Profile:
${TCE_COMPANY_PROFILE}

${opportunityContext ? `\n${opportunityContext}\n` : ""}
${winThemes ? `\n${winThemes}\n` : ""}
${referenceMaterial ? `\nReference Material from Previous Responses:\n${referenceMaterial}\n` : ""}

Your task is to write the "${section.title}" section of an RFP response.

Section Guidance: ${section.guidance}
Target Length: approximately ${section.targetWords} words

Rules:
- Write in a professional, confident tone
- Be specific and substantive — avoid vague generalities
- Reference The Content Engine's capabilities and experience
- If win themes are provided, weave them naturally into the content
- Use the reference material to inform your writing style and content
- Output in markdown format
- Target approximately ${section.targetWords} words`;

    const aiResponse = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 2048,
      system: systemPrompt,
      messages: [
        {
          role: "user",
          content: `Write the "${section.title}" section for our RFP response titled "${response.title}". Make it compelling and specific to The Content Engine's strengths.`,
        },
      ],
    });

    // Log usage
    logAiUsage({
      model: "claude-sonnet-4-6",
      source: "rfp-generate",
      inputTokens: aiResponse.usage?.input_tokens || 0,
      outputTokens: aiResponse.usage?.output_tokens || 0,
    });

    let generatedContent = "";
    for (const block of aiResponse.content) {
      if (block.type === "text") {
        generatedContent += block.text;
      }
    }

    // Update the section in the response
    const updatedSections = sections.map((s: any) =>
      s.id === sectionId
        ? {
            ...s,
            content: generatedContent,
            status: "generated",
            wordCount: generatedContent.split(/\s+/).length,
          }
        : s
    );

    await intelligenceDb
      .from("rfp_responses")
      .update({
        document_sections: updatedSections,
        date_updated: new Date().toISOString(),
      })
      .eq("id_response", id);

    return NextResponse.json({
      content: generatedContent,
      wordCount: generatedContent.split(/\s+/).length,
    });
  } catch (error: any) {
    console.error("[RFP Generate] Error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
