import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

// GET /api/workspace/customer-assignments — all customer-member mappings
export async function GET() {
  try {
    const { data: rows, error } = await supabase
      .from("app_lookup_users_clients")
      .select("*");

    if (error) throw error;

    const assignments = (rows || []).map((r) => ({
      userId: String(r.id_user),
      customerId: r.id_client ? String(r.id_client) : null,
      customerName: r.name_client,
      role: r.role_user,
    }));

    return NextResponse.json({ assignments });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
