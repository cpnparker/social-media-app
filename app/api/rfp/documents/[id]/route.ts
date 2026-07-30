import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { intelligenceDb } from "@/lib/supabase-intelligence";
import { verifyWorkspaceMembership } from "@/lib/permissions";

// GET /api/rfp/documents/[id]
export async function GET(
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
    const { data: doc, error } = await intelligenceDb
      .from("rfp_documents")
      .select("*")
      .eq("id_document", id)
      .single();

    if (error || !doc) {
      return NextResponse.json({ error: "Document not found" }, { status: 404 });
    }

    const memberRole = await verifyWorkspaceMembership(userId, doc.id_workspace);
    if (!memberRole) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    return NextResponse.json({ document: doc });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// DELETE /api/rfp/documents/[id]
export async function DELETE(
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
    const { data: doc } = await intelligenceDb
      .from("rfp_documents")
      .select("id_workspace")
      .eq("id_document", id)
      .single();

    if (!doc) {
      return NextResponse.json({ error: "Document not found" }, { status: 404 });
    }

    const memberRole = await verifyWorkspaceMembership(userId, doc.id_workspace);
    if (!memberRole) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { error } = await intelligenceDb
      .from("rfp_documents")
      .delete()
      .eq("id_document", id);

    if (error) throw error;

    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
