import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { intelligenceDb } from "@/lib/supabase-intelligence";
import { verifyWorkspaceMembership } from "@/lib/permissions";

export const maxDuration = 30;

// POST /api/rfp/documents/upload
// Creates a document record after the file has already been uploaded to Vercel Blob.
// Returns immediately — the client triggers extraction separately via /reextract.
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = parseInt(session.user.id, 10);

  try {
    const body = await req.json();
    const { workspaceId, fileName, fileUrl, fileSize, mimeType, documentType } = body;

    if (!workspaceId || !fileName || !fileUrl || !fileSize || !mimeType) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    const memberRole = await verifyWorkspaceMembership(userId, workspaceId);
    if (!memberRole) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const validTypes = ["previous_response", "target_rfp", "supporting"];
    const docType = validTypes.includes(documentType) ? documentType : "previous_response";

    // Create the document record
    const { data: doc, error } = await intelligenceDb
      .from("rfp_documents")
      .insert({
        id_workspace: workspaceId,
        type_document: docType,
        name_file: fileName,
        url_file: fileUrl,
        units_file_size: fileSize,
        type_mime: mimeType,
        type_extraction_status: "pending",
        user_uploaded: userId,
      })
      .select()
      .single();

    if (error) throw error;

    return NextResponse.json({ document: doc });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
