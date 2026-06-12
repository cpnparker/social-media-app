/**
 * RFP document text extraction and summarisation.
 *
 * Extracts text from uploaded PDF/DOCX files and generates
 * an AI summary using grok-3-mini (cheap, fast).
 */

import { intelligenceDb } from "@/lib/supabase-intelligence";
import { fetchBlobContent } from "@/lib/ai/blob-utils";
import { logAiUsage } from "@/lib/ai/usage-logger";
import OpenAI from "openai";

function getXAIClient() {
  if (!process.env.XAI_API_KEY) {
    throw new Error("XAI_API_KEY is not set");
  }
  return new OpenAI({
    apiKey: process.env.XAI_API_KEY,
    baseURL: "https://api.x.ai/v1",
  });
}

/**
 * Fire-and-forget: extract text from a document and generate a summary.
 * Updates the rfp_documents row with extracted text, summary, and status.
 */
export async function extractRfpDocumentText(
  documentId: string,
  fileUrl: string,
  mimeType: string
): Promise<void> {
  try {
    // Mark as extracting
    await intelligenceDb
      .from("rfp_documents")
      .update({ type_extraction_status: "extracting" })
      .eq("id_document", documentId);

    // Fetch file content
    const { buffer } = await fetchBlobContent(fileUrl);
    let extractedText: string | undefined;

    if (mimeType === "application/pdf") {
      const pdfParseModule = await import("pdf-parse");
      const pdfParse = pdfParseModule.default ?? pdfParseModule;
      const data = await pdfParse(buffer);
      extractedText = data.text;
    } else if (
      mimeType ===
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    ) {
      const mammoth = await import("mammoth");
      const result = await mammoth.extractRawText({ buffer });
      extractedText = result.value;
    } else if (mimeType.startsWith("text/")) {
      extractedText = buffer.toString("utf-8");
    }

    if (!extractedText || extractedText.trim().length === 0) {
      await intelligenceDb
        .from("rfp_documents")
        .update({ type_extraction_status: "failed" })
        .eq("id_document", documentId);
      return;
    }

    // Generate summary with grok-3-mini
    let summary: string | null = null;
    try {
      const xai = getXAIClient();
      const truncatedText = extractedText.slice(0, 8000);

      const response = await xai.chat.completions.create({
        model: "grok-3-mini",
        messages: [
          {
            role: "system",
            content: `You are a document summariser for an RFP response tool. Summarise this document concisely, capturing:
1. What type of document this is (RFP response, proposal, capability statement, etc.)
2. Key topics and themes covered
3. Specific capabilities, case studies, or credentials mentioned
4. Any relevant methodologies, frameworks, or approaches described
5. Target audience or sector

Keep to 200-400 tokens. Return plain text only.`,
          },
          { role: "user", content: truncatedText },
        ],
        max_tokens: 500,
        temperature: 0.3,
      });

      summary = response.choices?.[0]?.message?.content?.trim() || null;

      // Log usage
      logAiUsage({
        model: "grok-3-mini",
        source: "rfp-extract",
        inputTokens: response.usage?.prompt_tokens || 0,
        outputTokens: response.usage?.completion_tokens || 0,
      });
    } catch (err) {
      console.error("[RFP] Summary generation failed:", err);
    }

    // Update document with extracted text and summary
    await intelligenceDb
      .from("rfp_documents")
      .update({
        document_extracted_text: extractedText.slice(0, 100000), // Cap at 100k chars
        document_summary: summary,
        type_extraction_status: "ready",
      })
      .eq("id_document", documentId);

    console.log(
      `[RFP] Document ${documentId} extracted (${extractedText.length} chars) and summarised`
    );
  } catch (err) {
    console.error("[RFP] Extraction failed for document", documentId, err);
    await intelligenceDb
      .from("rfp_documents")
      .update({ type_extraction_status: "failed" })
      .eq("id_document", documentId);
  }
}
