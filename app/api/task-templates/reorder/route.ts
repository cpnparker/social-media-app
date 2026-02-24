import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

// POST /api/task-templates/reorder
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { orderedIds } = body;

    if (!Array.isArray(orderedIds) || orderedIds.length === 0) {
      return NextResponse.json(
        { error: "orderedIds array is required" },
        { status: 400 }
      );
    }

    await Promise.all(
      orderedIds.map((id: string, index: number) =>
        supabase
          .from("templates_tasks_content")
          .update({ order_sort: index })
          .eq("id_template", parseInt(id, 10))
      )
    );

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error("Task templates reorder error:", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
