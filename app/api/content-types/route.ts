import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

// GET /api/content-types — returns all content types with their document templates
export async function GET(req: NextRequest) {
  try {
    const { data: types, error } = await supabase
      .from("types_content")
      .select("id_type, key_type, type_content, flag_active, ai_prompt")
      .order("id_type", { ascending: true });

    let typesData = types;

    if (error) {
      // Fallback if ai_prompt column doesn't exist yet
      if (error.message?.includes("ai_prompt")) {
        const { data: fallback, error: fbError } = await supabase
          .from("types_content")
          .select("id_type, key_type, type_content, flag_active")
          .order("id_type", { ascending: true });
        if (fbError) throw fbError;
        typesData = (fallback || []).map((t: any) => ({ ...t, ai_prompt: null }));
      } else {
        throw error;
      }
    }

    // Fetch document templates for all content types
    const { data: docTemplates } = await supabase
      .from("app_templates_document")
      .select("id_template, document_type, document_target, key_template, link_url, document_reference, id_type");

    // Group templates by content type id
    const templatesByType: Record<number, any[]> = {};
    (docTemplates || []).forEach((dt: any) => {
      if (dt.id_type) {
        if (!templatesByType[dt.id_type]) templatesByType[dt.id_type] = [];
        templatesByType[dt.id_type].push({
          id: dt.id_template,
          documentType: dt.document_type,
          documentTarget: dt.document_target,
          key: dt.key_template,
          linkUrl: dt.link_url,
          documentReference: dt.document_reference,
        });
      }
    });

    const contentTypes = (typesData || []).map((t: any) => ({
      id: t.id_type,
      key: t.key_type,
      name: t.type_content,
      isActive: t.flag_active === 1,
      aiPrompt: t.ai_prompt || null,
      documentTemplates: templatesByType[t.id_type] || [],
    }));

    return NextResponse.json({ contentTypes });
  } catch (error: any) {
    console.error("Content types GET error:", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// PUT /api/content-types — update AI prompt for a content type
export async function PUT(req: NextRequest) {
  try {
    const body = await req.json();
    const { typeId, aiPrompt } = body;

    if (!typeId) {
      return NextResponse.json({ error: "typeId is required" }, { status: 400 });
    }

    const { error } = await supabase
      .from("types_content")
      .update({ ai_prompt: aiPrompt || null })
      .eq("id_type", typeId);

    if (error) throw error;

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error("Content types PUT error:", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
