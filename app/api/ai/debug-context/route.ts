import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { getAllowedClientIds } from "@/lib/permissions";

// GET /api/ai/debug-context — debug what context the AI would see
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = parseInt(session.user.id, 10);

  // Step 1: Get user role
  const { data: dbUser, error: userErr } = await supabase
    .from("users")
    .select("role_user")
    .eq("id_user", userId)
    .is("date_deleted", null)
    .single();

  const role = dbUser?.role_user || "none";

  // Step 2: Get allowed client IDs
  const allowedIds = await getAllowedClientIds(userId, role);

  // Step 3: Fetch clients
  let clientsQuery = supabase
    .from("app_clients")
    .select("id_client, name_client, information_industry")
    .is("date_deleted", null)
    .order("name_client")
    .limit(30);
  if (allowedIds !== null) {
    clientsQuery = clientsQuery.in("id_client", allowedIds.length ? allowedIds : [-1]);
  }
  const { data: clients, error: clientsErr } = await clientsQuery;

  // Step 4: Fetch contracts
  let contracts = null;
  let contractsErr = null;
  if (clients?.length) {
    const clientIds = clients.map((c) => c.id_client);
    const result = await supabase
      .from("app_contracts")
      .select("id_contract, name_contract, name_client, units_contract, units_total_completed, flag_active")
      .in("id_client", clientIds)
      .eq("flag_active", 1)
      .is("date_deleted", null)
      .limit(10);
    contracts = result.data;
    contractsErr = result.error;
  }

  // Step 5: Fetch recent content
  let recentContent = null;
  let contentErr = null;
  if (clients?.length) {
    const clientIds = clients.map((c) => c.id_client);
    const result = await supabase
      .from("app_content")
      .select("id_content, name_content, type_content, name_client, flag_completed")
      .in("id_client", clientIds)
      .is("date_deleted", null)
      .order("date_created", { ascending: false })
      .limit(10);
    recentContent = result.data;
    contentErr = result.error;
  }

  return NextResponse.json({
    userId,
    role,
    userError: userErr?.message,
    allowedIds: allowedIds === null ? "null (unrestricted)" : allowedIds,
    clients: {
      count: clients?.length ?? 0,
      data: clients?.slice(0, 5),
      error: clientsErr?.message,
    },
    contracts: {
      count: contracts?.length ?? 0,
      data: contracts?.slice(0, 5),
      error: contractsErr?.message,
    },
    recentContent: {
      count: recentContent?.length ?? 0,
      data: recentContent?.slice(0, 5),
      error: contentErr?.message,
    },
  });
}
