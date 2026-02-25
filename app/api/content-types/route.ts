import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

// GET /api/content-types — returns all content types from types_content
export async function GET(req: NextRequest) {
  try {
    const { data: types, error } = await supabase
      .from("types_content")
      .select("id_type, key_type, type_content, flag_active")
      .order("id_type", { ascending: true });

    if (error) throw error;

    const contentTypes = (types || []).map((t) => ({
      id: t.id_type,
      key: t.key_type,
      name: t.type_content,
      isActive: t.flag_active === 1,
    }));

    return NextResponse.json({ contentTypes });
  } catch (error: any) {
    console.error("Content types GET error:", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
