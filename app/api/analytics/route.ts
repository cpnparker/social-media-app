import { NextRequest, NextResponse } from "next/server";
import { lateApiFetch } from "@/lib/late";

const PLATFORM_META: Record<string, { name: string; color: string }> = {
  instagram: { name: "Instagram", color: "#E4405F" },
  twitter: { name: "Twitter / X", color: "#1DA1F2" },
  facebook: { name: "Facebook", color: "#1877F2" },
  linkedin: { name: "LinkedIn", color: "#0A66C2" },
  tiktok: { name: "TikTok", color: "#000000" },
  youtube: { name: "YouTube", color: "#FF0000" },
  pinterest: { name: "Pinterest", color: "#BD081C" },
  reddit: { name: "Reddit", color: "#FF4500" },
  bluesky: { name: "Bluesky", color: "#0085FF" },
  threads: { name: "Threads", color: "#000000" },
};

// GET /api/analytics — fetch analytics data and transform for dashboard
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const period = searchParams.get("period") || "30";
  const accountIds = searchParams.get("accountIds"); // comma-separated Late account IDs
  const platformsFilter = searchParams.get("platforms"); // comma-separated platform names

  try {
    // Build query params for the Late API
    const endDate = new Date().toISOString().split("T")[0];
    const startDate = new Date(Date.now() - parseInt(period) * 86400000)
      .toISOString()
      .split("T")[0];

    // Fetch first page (limit=50 covers most use cases, avoids timeout)
    const raw = await lateApiFetch(
      `/analytics?startDate=${startDate}&endDate=${endDate}&limit=50`
    );

    let posts = raw.posts || [];

    // Filter by account IDs if specified
    if (accountIds) {
      const ids = accountIds.split(",").map((id) => id.trim());
      posts = posts.filter((p: any) => {
        const raw = p.accountId;
        const postAccountId = (typeof raw === "object" && raw !== null) ? raw._id : raw;
        return (postAccountId && ids.includes(postAccountId)) ||
               (p.account?._id && ids.includes(p.account._id)) ||
               (p.account?.id && ids.includes(p.account.id));
      });
    }

    // Filter by platforms if specified
    if (platformsFilter) {
      const plats = platformsFilter.split(",").map((p) => p.trim().toLowerCase());
      posts = posts.filter((p: any) => {
        const postPlatform = (p.platform || "").toLowerCase();
        return plats.includes(postPlatform);
      });
    }

    const transformed = transformLateData(posts, raw, parseInt(period));
    return NextResponse.json({ data: transformed });
  } catch (error: any) {
    console.error("Analytics fetch error:", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

function transformLateData(posts: any[], raw: any, days: number) {
  // --- Aggregate totals from all posts ---
  const totals = {
    impressions: 0,
    engagements: 0,
    reach: 0,
    clicks: 0,
    likes: 0,
    comments: 0,
    shares: 0,
    saves: 0,
    views: 0,
    profileVisits: 0,
  };

  for (const post of posts) {
    const a = post.analytics || {};
    totals.impressions += a.impressions || 0;
    totals.reach += a.reach || 0;
    totals.clicks += a.clicks || 0;
    totals.likes += a.likes || 0;
    totals.comments += a.comments || 0;
    totals.shares += a.shares || 0;
    totals.saves += a.saves || 0;
    totals.views += a.views || 0;
  }
  totals.engagements = totals.likes + totals.comments + totals.shares + totals.saves;

  const engagementRate =
    totals.impressions > 0
      ? parseFloat(((totals.engagements / totals.impressions) * 100).toFixed(1))
      : 0;

  // --- Build daily aggregates from post dates ---
  const dailyMap: Record<string, any> = {};
  const now = new Date();
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    const key = d.toISOString().split("T")[0];
    dailyMap[key] = {
      date: key,
      impressions: 0,
      engagements: 0,
      reach: 0,
      clicks: 0,
      likes: 0,
      comments: 0,
      shares: 0,
      saves: 0,
    };
  }

  for (const post of posts) {
    const dateStr = (post.publishedAt || post.scheduledFor || "").split("T")[0];
    if (dailyMap[dateStr]) {
      const a = post.analytics || {};
      dailyMap[dateStr].impressions += a.impressions || 0;
      dailyMap[dateStr].reach += a.reach || 0;
      dailyMap[dateStr].clicks += a.clicks || 0;
      dailyMap[dateStr].likes += a.likes || 0;
      dailyMap[dateStr].comments += a.comments || 0;
      dailyMap[dateStr].shares += a.shares || 0;
      dailyMap[dateStr].saves += a.saves || 0;
      dailyMap[dateStr].engagements +=
        (a.likes || 0) + (a.comments || 0) + (a.shares || 0) + (a.saves || 0);
    }
  }

  const daily = Object.values(dailyMap).sort(
    (a: any, b: any) => new Date(a.date).getTime() - new Date(b.date).getTime()
  );

  // --- Platform breakdown from posts ---
  const platMap: Record<string, any> = {};
  for (const post of posts) {
    const platform = (post.platform || "unknown").toLowerCase();
    if (!platMap[platform]) {
      const meta = PLATFORM_META[platform] || {
        name: platform,
        color: "#6b7280",
      };
      platMap[platform] = {
        platform,
        name: meta.name,
        color: meta.color,
        impressions: 0,
        engagements: 0,
        posts: 0,
      };
    }
    const a = post.analytics || {};
    platMap[platform].impressions += a.impressions || 0;
    platMap[platform].engagements +=
      (a.likes || 0) + (a.comments || 0) + (a.shares || 0) + (a.saves || 0);
    platMap[platform].posts += 1;
  }

  const platforms = Object.values(platMap).sort(
    (a: any, b: any) => b.impressions - a.impressions
  );

  // --- Accounts from the raw Late response ---
  const accounts = (raw.accounts || []).map((acc: any) => ({
    platform: acc.platform,
    username: acc.username,
  }));

  // --- Top posts by engagement ---
  const topPosts = [...posts]
    .map((post) => {
      const a = post.analytics || {};
      const eng = (a.likes || 0) + (a.comments || 0) + (a.shares || 0) + (a.saves || 0);
      const imprs = a.impressions || 0;
      return {
        id: post._id,
        content: post.content || "(No text)",
        platform: (post.platform || "unknown").toLowerCase(),
        publishedAt: post.publishedAt || post.scheduledFor || "",
        impressions: imprs,
        engagements: eng,
        likes: a.likes || 0,
        comments: a.comments || 0,
        shares: a.shares || 0,
        saves: a.saves || 0,
        engagementRate: imprs > 0 ? ((eng / imprs) * 100).toFixed(1) : "0",
        thumbnailUrl: post.thumbnailUrl || null,
        platformPostUrl: post.platformPostUrl || null,
      };
    })
    .sort((a, b) => b.engagements - a.engagements)
    .slice(0, 10);

  // --- Best times to post (from actual data) ---
  const hourBuckets: Record<string, { total: number; count: number }> = {};
  const dayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

  for (const post of posts) {
    if (!post.publishedAt) continue;
    const d = new Date(post.publishedAt);
    const dayName = dayNames[d.getUTCDay()];
    const hour = d.getUTCHours();
    const key = `${dayName}-${hour}`;
    const a = post.analytics || {};
    const eng = (a.likes || 0) + (a.comments || 0) + (a.shares || 0) + (a.saves || 0);
    if (!hourBuckets[key]) hourBuckets[key] = { total: 0, count: 0 };
    hourBuckets[key].total += eng;
    hourBuckets[key].count += 1;
  }

  // Find best hour per day
  const bestTimesMap: Record<string, { hour: number; avg: number }> = {};
  for (const [key, val] of Object.entries(hourBuckets)) {
    const [day] = key.split("-");
    const avg = val.count > 0 ? val.total / val.count : 0;
    if (!bestTimesMap[day] || avg > bestTimesMap[day].avg) {
      const hour = parseInt(key.split("-")[1]);
      bestTimesMap[day] = { hour, avg };
    }
  }

  const maxAvg = Math.max(...Object.values(bestTimesMap).map((v) => v.avg), 1);
  const bestTimes = [
    "Monday",
    "Tuesday",
    "Wednesday",
    "Thursday",
    "Friday",
    "Saturday",
    "Sunday",
  ].map((day) => {
    const bt = bestTimesMap[day];
    const hour = bt ? bt.hour : 9;
    const score = bt ? Math.round((bt.avg / maxAvg) * 100) : 50;
    const ampm = hour >= 12 ? "PM" : "AM";
    const h12 = hour === 0 ? 12 : hour > 12 ? hour - 12 : hour;
    return { day, hour: `${h12}:00 ${ampm}`, score };
  });

  return {
    overview: raw.overview || {},
    totals: {
      ...totals,
      engagementRate,
      totalPosts: raw.overview?.totalPosts || posts.length,
      publishedPosts: raw.overview?.publishedPosts || posts.length,
    },
    daily,
    platforms,
    topPosts,
    bestTimes,
    accounts,
  };
}
