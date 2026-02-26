import { NextRequest, NextResponse } from "next/server";
import { lateApiFetch } from "@/lib/late";
import { supabase } from "@/lib/supabase";
import { requireAuth } from "@/lib/permissions";

// GET /api/posts — list posts (via Late API)
export async function GET(req: NextRequest) {
  const authResult = await requireAuth();
  if (authResult instanceof NextResponse) return authResult;

  const { searchParams } = new URL(req.url);
  const status = searchParams.get("status");
  const page = searchParams.get("page") || "1";
  const limit = searchParams.get("limit") || "20";
  const accountIds = searchParams.get("accountIds"); // comma-separated Late account IDs

  try {
    let endpoint = `/posts?page=${page}&limit=${limit}`;
    if (status) endpoint += `&status=${status}`;

    const data = await lateApiFetch(endpoint);

    // Filter posts by account IDs if specified (scopes to customer-linked accounts)
    // Late API nests account IDs inside platforms[].accountId (object with _id or string)
    if (accountIds && data.posts) {
      const ids = new Set(accountIds.split(",").map((id: string) => id.trim()));
      data.posts = data.posts.filter((p: any) => {
        // Check platform-level accountIds (the actual location in Late API responses)
        if (p.platforms && Array.isArray(p.platforms)) {
          return p.platforms.some((plat: any) => {
            const raw = plat.accountId;
            if (!raw) return false;
            const platAccountId = (typeof raw === "object" && raw !== null) ? raw._id : raw;
            return platAccountId && ids.has(platAccountId);
          });
        }
        // Fallback: check top-level accountId/account (for older API formats)
        const raw = p.accountId;
        const postAccountId = (typeof raw === "object" && raw !== null) ? raw._id : raw;
        return (postAccountId && ids.has(postAccountId)) ||
               (p.account?._id && ids.has(p.account._id));
      });
    }

    return NextResponse.json(data);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// POST /api/posts — create a new post (via Late API)
export async function POST(req: NextRequest) {
  const authResult = await requireAuth();
  if (authResult instanceof NextResponse) return authResult;

  try {
    const body = await req.json();

    const postPayload: any = {
      content: body.content,
      platforms: body.platforms,
    };

    if (body.mediaUrls?.length || body.mediaItems?.length) {
      const baseUrl = process.env.NEXTAUTH_URL || process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
      const urls: string[] = body.mediaUrls || body.mediaItems?.map((m: any) => m.url) || [];
      postPayload.mediaItems = urls.map((url: string) => {
        const absoluteUrl = url.startsWith("http") ? url : `${baseUrl}${url}`;
        const isVideo = /\.(mp4|mov|webm)$/i.test(absoluteUrl) ||
          body.mediaItems?.find((m: any) => m.url === url)?.contentType?.startsWith("video/");
        return { url: absoluteUrl, type: isVideo ? "video" : "image" };
      });
    }

    if (body.publishNow) postPayload.publishNow = true;
    else if (body.scheduledFor) {
      postPayload.scheduledFor = body.scheduledFor;
      postPayload.timezone = body.timezone || "UTC";
    }

    const data = await lateApiFetch("/posts", {
      method: "POST",
      body: JSON.stringify(postPayload),
    });

    // If linked to a content object, store in social table
    if (body.contentObjectId) {
      try {
        await supabase.from("social").insert({
          id_content: parseInt(body.contentObjectId, 10),
          id_client: body.customerId ? parseInt(body.customerId, 10) : null,
          name_social: (body.content || "").substring(0, 200),
          network: body.platforms?.[0]?.platform || "other",
          type_post: "standard",
          date_created: new Date().toISOString(),
        });
      } catch (dbErr) {
        console.error("[Posts] Failed to store content object linkage:", dbErr);
      }
    }

    return NextResponse.json(data);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
