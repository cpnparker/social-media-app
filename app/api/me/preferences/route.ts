import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { intelligenceDb } from "@/lib/supabase-intelligence";

/** Mirrors the editor's own cap (app/(app)/ai-context). Enforced here too,
 *  because a limit that lives only in the browser is not a limit. */
const PERSONAL_CONTEXT_MAX = 2000;

// GET /api/me/preferences — returns the current user's personal preferences
export async function GET() {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userId = parseInt(session.user.id, 10);

    // Get workspace
    const { data: ws } = await intelligenceDb
      .from("workspaces")
      .select("id")
      .limit(1)
      .single();

    if (!ws) {
      return NextResponse.json({
        personalContext: null,
        region: "Global",
        pinnedConversationIds: [],
        pinnedClientIds: [],
        pinnedArticleIds: [],
      });
    }

    // Fetch preferences from users_access
    const { data: row } = await intelligenceDb
      .from("users_access")
      .select(
        "information_personal_context, name_region, data_pinned_conversations, data_pinned_clients, data_selected_roles"
      )
      .eq("id_workspace", ws.id)
      .eq("user_target", userId)
      .maybeSingle();

    // Article pins are read in their OWN select, deliberately.
    //
    // PostgREST fails an ENTIRE select when it names one unknown column, so
    // adding data_pinned_articles to the query above would have taken the
    // CONVERSATION and CLIENT pins down with it on any deploy that ran ahead of
    // the migration — a new feature silently breaking two old ones. Same rule
    // as the optimizer access flag, and for the same reason.
    let pinnedArticleIds: string[] = [];
    try {
      const { data: pins } = await intelligenceDb
        .from("users_access")
        .select("data_pinned_articles")
        .eq("id_workspace", ws.id)
        .eq("user_target", userId)
        .maybeSingle();
      if (pins && Array.isArray((pins as any).data_pinned_articles)) {
        pinnedArticleIds = (pins as any).data_pinned_articles;
      }
    } catch {
      /* column not migrated yet — no pins, everything else still works */
    }

    return NextResponse.json({
      personalContext: row?.information_personal_context || null,
      region: row?.name_region || "Global",
      pinnedConversationIds: row?.data_pinned_conversations || [],
      pinnedClientIds: row?.data_pinned_clients || [],
      pinnedArticleIds,
      selectedRoleIds: row?.data_selected_roles || [],
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// PATCH /api/me/preferences — update personal preferences
export async function PATCH(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userId = parseInt(session.user.id, 10);
    const body = await req.json();

    // Get workspace
    const { data: ws } = await intelligenceDb
      .from("workspaces")
      .select("id")
      .limit(1)
      .single();

    if (!ws) {
      return NextResponse.json({ error: "No workspace found" }, { status: 404 });
    }

    /** Written separately from `updates` — see the note at its assignment. */
    let articlePinsToWrite: string[] | null = null;

    // Build update object (only include provided fields)
    const updates: Record<string, any> = {
      date_updated: new Date().toISOString(),
    };

    // The 2000-char cap was enforced only in the browser, so anything reaching
    // this route directly saved unbounded — the mirror image of the company
    // context bug, which trimmed silently on the server instead. Both now
    // refuse: the user is told, and the model never reads a half-sentence as a
    // complete one.
    if (body.personalContext !== undefined) {
      const text = String(body.personalContext ?? "");
      if (text.length > PERSONAL_CONTEXT_MAX) {
        return NextResponse.json(
          {
            error: `Personal context is ${text.length.toLocaleString()} characters — the limit is ${PERSONAL_CONTEXT_MAX.toLocaleString()}. Nothing was saved.`,
            limit: PERSONAL_CONTEXT_MAX,
            length: text.length,
          },
          { status: 400 }
        );
      }
      updates.information_personal_context = text;
    }
    if (body.region !== undefined) {
      updates.name_region = body.region;
    }
    if (body.pinnedConversationIds !== undefined) {
      updates.data_pinned_conversations = body.pinnedConversationIds;
    }
    // Written on its own too, for the same reason: a failed article-pin write
    // must not roll back a personal-context edit sent in the same request.
    if (body.pinnedArticleIds !== undefined) {
      articlePinsToWrite = body.pinnedArticleIds;
    }
    if (body.pinnedClientIds !== undefined) {
      updates.data_pinned_clients = body.pinnedClientIds;
    }
    if (body.selectedRoleIds !== undefined) {
      updates.data_selected_roles = body.selectedRoleIds;
    }

    // Check if row exists
    const { data: existing } = await intelligenceDb
      .from("users_access")
      .select("id_access")
      .eq("id_workspace", ws.id)
      .eq("user_target", userId)
      .maybeSingle();

    if (existing) {
      await intelligenceDb
        .from("users_access")
        .update(updates)
        .eq("id_access", existing.id_access);
      if (articlePinsToWrite !== null) {
        const { error: pinErr } = await intelligenceDb
          .from("users_access")
          .update({ data_pinned_articles: articlePinsToWrite })
          .eq("id_access", existing.id_access);
        // A pre-migration deploy loses the pin and keeps everything else. Worth
        // a log line, not a 500: nobody should lose a personal-context edit
        // because a pin could not be stored.
        if (pinErr) console.warn("[preferences] article pins not saved:", pinErr.message);
      }
    } else {
      // Create the row with NO access, matching what sign-in does for a new
      // user (lib/auth.ts: "add as viewer with no access", every flag 0).
      //
      // This previously inserted flag_access_admin: 1 — along with engine and
      // enginegpt — which meant anyone who reached this endpoint without an
      // existing row granted THEMSELVES admin simply by saving a personal
      // preference. flag_access_admin=1 opens the whole /settings area and the
      // Users page, where every other user's access flags can be changed.
      //
      // This is a preferences endpoint. It has no business deciding access, and
      // the sign-in path already establishes what a new row should look like.
      await intelligenceDb.from("users_access").insert({
        id_workspace: ws.id,
        user_target: userId,
        flag_access_engine: 0,
        flag_access_enginegpt: 0,
        flag_access_operations: 0,
        flag_access_admin: 0,
        flag_access_meetingbrain: 0,
        ...updates,
      });
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
