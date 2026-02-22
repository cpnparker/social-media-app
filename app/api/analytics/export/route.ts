import { NextRequest, NextResponse } from "next/server";
import { lateApiFetch } from "@/lib/late";

// GET /api/analytics/export — export analytics as CSV
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const period = searchParams.get("period") || "30";

  try {
    const endDate = new Date().toISOString().split("T")[0];
    const startDate = new Date(Date.now() - parseInt(period) * 86400000)
      .toISOString()
      .split("T")[0];

    // Fetch posts from Late API
    let allPosts: any[] = [];
    let page = 1;
    let hasMore = true;

    while (hasMore) {
      const raw = await lateApiFetch(
        `/analytics?startDate=${startDate}&endDate=${endDate}&page=${page}&limit=50`
      );
      const posts = raw.posts || [];
      allPosts = allPosts.concat(posts);
      hasMore = raw.pagination && page < raw.pagination.pages;
      page++;
      if (page > 10) break;
    }

    if (allPosts.length === 0) {
      return NextResponse.json({ error: "No data available" }, { status: 404 });
    }

    // Build CSV from post-level data
    const headers = [
      "Post ID",
      "Content",
      "Platform",
      "Published At",
      "Status",
      "Impressions",
      "Reach",
      "Likes",
      "Comments",
      "Shares",
      "Saves",
      "Clicks",
      "Views",
      "Engagement Rate",
      "URL",
    ];

    const escapeCSV = (val: string) => {
      if (val.includes(",") || val.includes('"') || val.includes("\n")) {
        return `"${val.replace(/"/g, '""')}"`;
      }
      return val;
    };

    const rows = allPosts.map((post: any) => {
      const a = post.analytics || {};
      return [
        post._id || "",
        escapeCSV((post.content || "").replace(/\n/g, " ").substring(0, 200)),
        post.platform || "",
        post.publishedAt || post.scheduledFor || "",
        post.status || "",
        a.impressions || 0,
        a.reach || 0,
        a.likes || 0,
        a.comments || 0,
        a.shares || 0,
        a.saves || 0,
        a.clicks || 0,
        a.views || 0,
        a.engagementRate || 0,
        post.platformPostUrl || "",
      ].join(",");
    });

    const csv = [headers.join(","), ...rows].join("\n");

    return new NextResponse(csv, {
      headers: {
        "Content-Type": "text/csv",
        "Content-Disposition": `attachment; filename="analytics-${period}d-${endDate}.csv"`,
      },
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
