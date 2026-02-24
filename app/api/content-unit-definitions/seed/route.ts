import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { defaultContentUnitDefinitions } from "@/lib/seed-content-units";

// POST /api/content-unit-definitions/seed
export async function POST(req: NextRequest) {
  try {
    // Check if definitions already exist
    const { data: existing } = await supabase
      .from("calculator_content")
      .select("id")
      .limit(1);

    if (existing && existing.length > 0) {
      return NextResponse.json({ seeded: false, message: "Definitions already exist" });
    }

    // Insert all default definitions
    const rows = defaultContentUnitDefinitions.map((def) => ({
      format: def.category,
      name: def.formatName,
      units_content: def.defaultContentUnits,
      sort_order: def.sortOrder,
    }));

    const { error } = await supabase.from("calculator_content").insert(rows);
    if (error) throw error;

    return NextResponse.json({ seeded: true, count: rows.length });
  } catch (error: any) {
    console.error("Content unit definitions seed error:", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
