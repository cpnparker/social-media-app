import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

// POST /api/ideas/[id]/commission
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const ideaId = parseInt(id, 10);
    const body = await req.json().catch(() => ({}));

    const { data: idea, error: ideaError } = await supabase
      .from("ideas")
      .select("*")
      .eq("id_idea", ideaId)
      .is("date_deleted", null)
      .single();

    if (ideaError || !idea) {
      return NextResponse.json({ error: "Idea not found" }, { status: 404 });
    }

    const clientId = body.customerId ? parseInt(body.customerId, 10) : idea.id_client;
    const contractId = body.contractId ? parseInt(body.contractId, 10) : null;
    const contentUnits = body.contentUnits ? parseFloat(body.contentUnits) : null;

    await supabase
      .from("ideas")
      .update({
        status: "commissioned",
        flag_commissioned: 1,
        date_commissioned: new Date().toISOString(),
        id_client: clientId,
        date_updated: new Date().toISOString(),
      })
      .eq("id_idea", ideaId);

    const { data: contentObject, error: contentError } = await supabase
      .from("content")
      .insert({
        id_idea: ideaId,
        id_client: clientId,
        id_contract: contractId,
        name_content: idea.name_idea,
        information_brief: idea.information_brief || "",
        type_content: body.contentType || "article",
        units_override: contentUnits,
        user_commissioned: body.createdBy ? parseInt(body.createdBy, 10) : idea.user_submitted,
        date_created: new Date().toISOString(),
      })
      .select()
      .single();

    if (contentError) throw contentError;

    return NextResponse.json({
      contentObject: {
        id: String(contentObject.id_content),
        ideaId: String(ideaId),
        workingTitle: contentObject.name_content,
        contentType: contentObject.type_content,
        status: "draft",
        createdAt: contentObject.date_created,
      },
      idea: { id: String(ideaId), status: "commissioned", customerId: clientId ? String(clientId) : null },
    });
  } catch (error: any) {
    console.error("Commission error:", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
