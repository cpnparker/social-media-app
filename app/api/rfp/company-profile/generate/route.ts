import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { intelligenceDb } from "@/lib/supabase-intelligence";
import { verifyWorkspaceMembership } from "@/lib/permissions";
import { logAiUsage } from "@/lib/ai/usage-logger";
import Anthropic from "@anthropic-ai/sdk";

export const maxDuration = 60;

// POST /api/rfp/company-profile/generate — AI-generate profile from uploaded documents
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = parseInt(session.user.id, 10);

  try {
    const body = await req.json();
    const { workspaceId } = body;

    if (!workspaceId) {
      return NextResponse.json({ error: "workspaceId is required" }, { status: 400 });
    }

    const memberRole = await verifyWorkspaceMembership(userId, workspaceId);
    if (!memberRole) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // Fetch all ready documents for this workspace
    const { data: docs, error: docsErr } = await intelligenceDb
      .from("rfp_documents")
      .select("name_file, type_document, document_summary, document_extracted_text")
      .eq("id_workspace", workspaceId)
      .eq("type_extraction_status", "ready")
      .order("date_created", { ascending: false });

    if (docsErr) throw docsErr;

    if (!docs || docs.length === 0) {
      return NextResponse.json(
        { error: "No processed documents found. Upload documents first and wait for extraction to complete." },
        { status: 400 }
      );
    }

    // Build context from documents — use summaries for efficiency, fall back to extracted text
    const docContext = docs
      .map((doc) => {
        const typeLabel =
          doc.type_document === "previous_response"
            ? "Previous RFP Response"
            : doc.type_document === "target_rfp"
            ? "Target RFP"
            : "Supporting Document";
        const content = doc.document_summary || doc.document_extracted_text?.slice(0, 3000) || "";
        return `--- ${typeLabel}: ${doc.name_file} ---\n${content}`;
      })
      .join("\n\n");

    // Generate profile using Claude
    const anthropic = new Anthropic();

    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 2000,
      messages: [
        {
          role: "user",
          content: `Based on the following company documents, generate a comprehensive company profile for use in RFP discovery and response. Analyse the documents to understand the company's capabilities, expertise, and ideal opportunities.

DOCUMENTS:
${docContext}

Generate the profile as a JSON object with these exact fields:
{
  "overview": "A 2-3 sentence description of the company, what they do, who they serve",
  "services": "A bullet-point list of core services (one per line, starting with '- ')",
  "sectors": "A bullet-point list of key sectors/industries (one per line, starting with '- ')",
  "differentiators": "A bullet-point list of what makes this company unique (one per line, starting with '- ')",
  "targetRfpTypes": "A bullet-point list of ideal RFP types to pursue (one per line, starting with '- ')",
  "winThemes": ["Array of 4-6 short win theme strings that highlight competitive advantages"]
}

Be specific based on what the documents reveal. Focus on actual capabilities demonstrated in their previous work, not generic claims. If the documents are about a specific company, use their actual name.

Return ONLY the JSON object, no other text.`,
        },
      ],
    });

    // Log usage
    logAiUsage({
      model: "claude-sonnet-4-20250514",
      source: "rfp-profile",
      inputTokens: response.usage?.input_tokens || 0,
      outputTokens: response.usage?.output_tokens || 0,
    });

    // Parse the AI response
    const textContent = response.content.find((b) => b.type === "text")?.text || "";

    // Extract JSON from the response
    const jsonMatch = textContent.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return NextResponse.json({ error: "Failed to generate profile — AI did not return valid JSON" }, { status: 500 });
    }

    const generated = JSON.parse(jsonMatch[0]);

    return NextResponse.json({
      generated: {
        document_overview: generated.overview || "",
        document_services: generated.services || "",
        document_sectors: generated.sectors || "",
        document_differentiators: generated.differentiators || "",
        document_target_rfps: generated.targetRfpTypes || "",
        config_win_themes: Array.isArray(generated.winThemes) ? generated.winThemes : [],
      },
      documentsUsed: docs.length,
    });
  } catch (error: any) {
    console.error("[Company Profile Generate] Error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
