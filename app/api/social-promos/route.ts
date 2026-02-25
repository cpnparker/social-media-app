import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { requireAuth, scopeQueryToClients } from "@/lib/permissions";

// GET /api/social-promos — list all social promos from the Supabase social table
// Supports: ?customerId=xxx, ?network=twitter, ?status=published|scheduled|draft, ?limit=50, ?offset=0
export async function GET(req: NextRequest) {
  const authResult = await requireAuth();
  if (authResult instanceof NextResponse) return authResult;
  const { userId, role } = authResult;

  const { searchParams } = new URL(req.url);
  const customerId = searchParams.get("customerId");
  const network = searchParams.get("network"); // platform filter
  const status = searchParams.get("status"); // published, scheduled, draft
  const limit = parseInt(searchParams.get("limit") || "100");
  const offset = parseInt(searchParams.get("offset") || "0");

  try {
    // Build query on the social table
    let query = supabase
      .from("social")
      .select(
        "id_social, id_content, id_client, id_distribution, name_social, network, type_post, date_created, date_scheduled, date_published"
      )
      .is("date_deleted", null)
      .order("date_created", { ascending: false })
      .range(offset, offset + limit - 1);

    // Network/platform filter
    if (network) {
      query = query.eq("network", network.toLowerCase());
    }

    // Status filter: derive from date_published / date_scheduled
    if (status === "published") {
      query = query.not("date_published", "is", null);
    } else if (status === "scheduled") {
      query = query.is("date_published", null).not("date_scheduled", "is", null);
    } else if (status === "draft") {
      query = query.is("date_published", null).is("date_scheduled", null);
    }

    // Scope by customer/client access
    const scoped = await scopeQueryToClients(query, userId, role, customerId, "id_client");
    if (scoped.error) return scoped.error;
    query = scoped.query;

    const { data: rows, error } = await query;
    if (error) throw error;

    // Get unique distribution IDs and content IDs for batch lookups
    const distIds = Array.from(new Set((rows || []).map((r) => r.id_distribution).filter(Boolean)));
    const contentIds = Array.from(new Set((rows || []).map((r) => r.id_content).filter(Boolean)));

    // Batch fetch posting_distributions for account names
    const distMap: Record<number, { name: string; network: string }> = {};
    if (distIds.length > 0) {
      const { data: dists } = await supabase
        .from("posting_distributions")
        .select("id_distribution, name_resource, network")
        .in("id_distribution", distIds);
      for (const d of dists || []) {
        distMap[d.id_distribution] = { name: d.name_resource || d.network, network: d.network };
      }
    }

    // Batch fetch content objects for titles
    const contentMap: Record<number, { title: string; type: string; customerName: string }> = {};
    if (contentIds.length > 0) {
      const { data: contents } = await supabase
        .from("app_content")
        .select("id_content, name_content, type_content, name_client")
        .in("id_content", contentIds);
      for (const c of contents || []) {
        contentMap[c.id_content] = {
          title: c.name_content || "Untitled",
          type: c.type_content,
          customerName: c.name_client || "",
        };
      }
    }

    // Map to response
    const promos = (rows || []).map((r) => {
      const dist = r.id_distribution ? distMap[r.id_distribution] : null;
      const content = r.id_content ? contentMap[r.id_content] : null;

      // Derive status
      let promoStatus = "draft";
      if (r.date_published) promoStatus = "published";
      else if (r.date_scheduled) promoStatus = "scheduled";

      return {
        id: String(r.id_social),
        contentId: r.id_content ? String(r.id_content) : null,
        customerId: r.id_client ? String(r.id_client) : null,
        customerName: content?.customerName || null,
        contentTitle: content?.title || null,
        contentType: content?.type || null,
        name: r.name_social,
        network: r.network,
        platform: r.network, // alias
        accountName: dist?.name || null,
        distributionId: r.id_distribution ? String(r.id_distribution) : null,
        type: r.type_post,
        status: promoStatus,
        createdAt: r.date_created,
        scheduledAt: r.date_scheduled,
        publishedAt: r.date_published,
      };
    });

    // Also get total count for the customer (without limit/offset)
    let countQuery = supabase
      .from("social")
      .select("id_social", { count: "exact", head: true })
      .is("date_deleted", null);
    if (network) countQuery = countQuery.eq("network", network.toLowerCase());
    if (status === "published") countQuery = countQuery.not("date_published", "is", null);
    else if (status === "scheduled") countQuery = countQuery.is("date_published", null).not("date_scheduled", "is", null);
    else if (status === "draft") countQuery = countQuery.is("date_published", null).is("date_scheduled", null);

    const countScoped = await scopeQueryToClients(countQuery, userId, role, customerId, "id_client");
    if (!countScoped.error) {
      const { count } = await countScoped.query;
      return NextResponse.json({ promos, total: count ?? promos.length });
    }

    return NextResponse.json({ promos, total: promos.length });
  } catch (error: any) {
    console.error("[social-promos] Error:", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
