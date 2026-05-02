import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { intelligenceDb } from "@/lib/supabase-intelligence";
import { verifyWorkspaceMembership } from "@/lib/permissions";
import { extractRfpDocumentText } from "@/lib/rfp/extract";

export const maxDuration = 120;

// POST /api/rfp/documents/[id]/reextract
// Re-triggers extraction for a stuck or failed document.
// Runs extraction inline (not fire-and-forget) so it completes within the request.
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = parseInt(session.user.id, 10);
  const { id: documentId } = await params;

  try {
    // Fetch the document
    const { data: doc, error } = await intelligenceDb
      .from("rfp_documents")
      .select("id_document, id_workspace, url_file, type_mime, type_extraction_status")
      .eq("id_document", documentId)
      .single();

    if (error || !doc) {
      return NextResponse.json({ error: "Document not found" }, { status: 404 });
    }

    // Verify workspace membership
    const memberRole = await verifyWorkspaceMembership(userId, doc.id_workspace);
    if (!memberRole) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // Run extraction INLINE (awaited, not fire-and-forget)
    await extractRfpDocumentText(doc.id_document, doc.url_file, doc.type_mime);

    // Fetch updated document
    const { data: updated } = await intelligenceDb
      .from("rfp_documents")
      .select("*")
      .eq("id_document", documentId)
      .single();

    return NextResponse.json({ document: updated });
  } catch (error: any) {
    console.error("[RFP] Re-extract failed:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
