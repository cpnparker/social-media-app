import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { requireAuth, isTCEStaff, scopeQueryToClients } from "@/lib/permissions";

// GET /api/customers
export async function GET(req: NextRequest) {
  const authResult = await requireAuth();
  if (authResult instanceof NextResponse) return authResult;
  const { userId, role } = authResult;

  const { searchParams } = new URL(req.url);
  const search = searchParams.get("search");
  const limit = parseInt(searchParams.get("limit") || "50");
  const offset = parseInt(searchParams.get("offset") || "0");

  try {
    let query = supabase
      .from("app_clients")
      .select("*")
      .order("date_created", { ascending: false })
      .range(offset, offset + limit - 1);

    if (search) {
      query = query.ilike("name_client", `%${search}%`);
    }

    // Scope to allowed clients
    const scoped = await scopeQueryToClients(query, userId, role, null, "id_client");
    if (scoped.error) return scoped.error;
    query = scoped.query;

    const { data: rows, error } = await query;
    if (error) throw error;

    // Fetch contract summaries for all returned clients
    const clientIds = (rows || []).map((r) => r.id_client);
    const contractMap: Record<number, { active: number; total: number; used: number }> = {};

    if (clientIds.length > 0) {
      const { data: contracts } = await supabase
        .from("app_contracts")
        .select("id_client, flag_active, units_contract, units_total_completed")
        .in("id_client", clientIds);

      for (const c of contracts || []) {
        if (!contractMap[c.id_client]) {
          contractMap[c.id_client] = { active: 0, total: 0, used: 0 };
        }
        if (c.flag_active === 1) contractMap[c.id_client].active++;
        contractMap[c.id_client].total += Number(c.units_contract) || 0;
        contractMap[c.id_client].used += Number(c.units_total_completed) || 0;
      }
    }

    const customers = (rows || []).map((r) => {
      const summary = contractMap[r.id_client] || { active: 0, total: 0, used: 0 };
      return {
        id: String(r.id_client),
        name: r.name_client,
        website: r.link_website,
        industry: r.information_industry,
        notes: r.information_description,
        status: "active",
        createdAt: r.date_created,
        logoUrl: r.file_logo_bucket && r.file_logo_path
          ? `https://dcwodczzdeltxlyepxmc.supabase.co/storage/v1/object/public/${r.file_logo_bucket}/${r.file_logo_path}`
          : null,
        accountManager: r.name_account_manager,
        featureSocial: r.feature_social,
        featureAnalytics: r.feature_analytics,
        featureAutoschedule: r.feature_autoschedule,
        activeContracts: summary.active,
        totalBudget: summary.total,
        usedBudget: summary.used,
      };
    });

    return NextResponse.json({ customers });
  } catch (error: any) {
    console.error("Customers GET error:", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// POST /api/customers — create a new client (TCE staff only)
export async function POST(req: NextRequest) {
  const authResult = await requireAuth();
  if (authResult instanceof NextResponse) return authResult;
  const { role } = authResult;

  if (!isTCEStaff(role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const body = await req.json();

    if (!body.name) {
      return NextResponse.json(
        { error: "name is required" },
        { status: 400 }
      );
    }

    const { data: customer, error } = await supabase
      .from("clients")
      .insert({
        name_client: body.name,
        link_website: body.website || null,
        information_industry: body.industry || null,
        information_description: body.notes || null,
        date_created: new Date().toISOString(),
      })
      .select()
      .single();

    if (error) throw error;

    return NextResponse.json({
      customer: {
        id: String(customer.id_client),
        name: customer.name_client,
        website: customer.link_website,
        industry: customer.information_industry,
        notes: customer.information_description,
        status: "active",
        createdAt: customer.date_created,
      },
    });
  } catch (error: any) {
    console.error("Customers POST error:", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
