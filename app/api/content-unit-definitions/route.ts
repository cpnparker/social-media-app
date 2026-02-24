import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

// GET /api/content-unit-definitions?category=blogs
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const category = searchParams.get("category");

    let query = supabase
      .from("calculator_content")
      .select("*")
      .order("sort_order", { ascending: true });

    if (category) {
      query = query.eq("format", category);
    }

    const { data: rows, error } = await query;
    if (error) throw error;

    const definitions = (rows || []).map((r) => ({
      id: r.id,
      category: r.format,
      formatName: r.name,
      defaultContentUnits: Number(r.units_content) || 0,
      sortOrder: r.sort_order,
      isActive: true,
      splitText: r.split_text,
      splitVideo: r.split_video,
      splitVisual: r.split_visual,
    }));

    return NextResponse.json({ definitions });
  } catch (error: any) {
    console.error("Content unit definitions GET error:", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// POST /api/content-unit-definitions
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    if (!body.category || !body.formatName || body.defaultContentUnits === undefined) {
      return NextResponse.json(
        { error: "category, formatName, and defaultContentUnits are required" },
        { status: 400 }
      );
    }

    const { data: definition, error } = await supabase
      .from("calculator_content")
      .insert({
        format: body.category,
        name: body.formatName,
        units_content: body.defaultContentUnits,
        sort_order: body.sortOrder ?? 0,
        split_text: body.splitText ?? null,
        split_video: body.splitVideo ?? null,
        split_visual: body.splitVisual ?? null,
      })
      .select()
      .single();

    if (error) throw error;

    return NextResponse.json({
      definition: {
        id: definition.id,
        category: definition.format,
        formatName: definition.name,
        defaultContentUnits: Number(definition.units_content) || 0,
        sortOrder: definition.sort_order,
        isActive: true,
      },
    });
  } catch (error: any) {
    console.error("Content unit definitions POST error:", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
