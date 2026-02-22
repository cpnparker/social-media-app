import { NextRequest, NextResponse } from "next/server";
import { lateApiFetch } from "@/lib/late";

// GET /api/analytics/growth — Fetch historical analytics data for account growth deck
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const accountId = searchParams.get("accountId"); // optional: filter to single account

  try {
    // Fetch all accounts
    const accountsData = await lateApiFetch("/accounts");
    const accounts = (accountsData.accounts || []).map((a: any) => ({
      _id: a._id,
      platform: a.platform,
      displayName: a.displayName,
      username: a.username,
      avatarUrl: a.avatarUrl,
    }));

    // Fetch analytics for the maximum available time range (365 days)
    const endDate = new Date().toISOString().split("T")[0];
    const startDate = new Date(Date.now() - 365 * 86400000)
      .toISOString()
      .split("T")[0];

    const raw = await lateApiFetch(
      `/analytics?startDate=${startDate}&endDate=${endDate}&limit=200`
    );

    let posts = raw.posts || [];

    // Filter by account if specified
    if (accountId) {
      // Resolve the account's platform for fallback matching
      const targetAcct = accounts.find((a: any) => a._id === accountId);
      const targetPlatform = targetAcct?.platform?.toLowerCase();

      posts = posts.filter((p: any) => {
        // Check direct accountId matches
        const raw = p.accountId;
        const id = (typeof raw === "object" && raw !== null) ? raw._id : raw;
        if (id === accountId) return true;
        if (p.account?._id === accountId || p.account?.id === accountId) return true;
        // Check platform-level accountId
        if (p.platforms) {
          for (const plat of p.platforms) {
            const platRaw = plat.accountId;
            const platId = (typeof platRaw === "object" && platRaw !== null) ? platRaw._id : platRaw;
            if (platId === accountId) return true;
          }
        }
        // Fallback: match by platform name when analytics API doesn't include accountId
        if (targetPlatform) {
          const postPlatform = (p.platform || p.platforms?.[0]?.platform || "").toLowerCase();
          if (postPlatform === targetPlatform) return true;
        }
        return false;
      });
    }

    // --- Build monthly aggregates ---
    const monthlyMap: Record<
      string,
      {
        month: string;
        impressions: number;
        engagements: number;
        likes: number;
        comments: number;
        shares: number;
        saves: number;
        views: number;
        posts: number;
      }
    > = {};

    // Pre-fill last 12 months
    for (let i = 11; i >= 0; i--) {
      const d = new Date();
      d.setMonth(d.getMonth() - i);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      monthlyMap[key] = {
        month: key,
        impressions: 0,
        engagements: 0,
        likes: 0,
        comments: 0,
        shares: 0,
        saves: 0,
        views: 0,
        posts: 0,
      };
    }

    // --- Build weekly aggregates for the last 13 weeks ---
    const weeklyMap: Record<
      string,
      {
        week: string;
        impressions: number;
        engagements: number;
        posts: number;
      }
    > = {};

    for (let i = 12; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i * 7);
      const key = d.toISOString().split("T")[0];
      weeklyMap[key] = {
        week: key,
        impressions: 0,
        engagements: 0,
        posts: 0,
      };
    }

    // --- Per-account performance ---
    const accountPerfMap: Record<
      string,
      {
        accountId: string;
        platform: string;
        displayName: string;
        username: string;
        avatarUrl: string;
        impressions: number;
        engagements: number;
        likes: number;
        comments: number;
        shares: number;
        posts: number;
        engagementRate: number;
      }
    > = {};

    for (const post of posts) {
      const a = post.analytics || {};
      const dateStr = (post.publishedAt || post.scheduledFor || "").split("T")[0];
      const eng =
        (a.likes || 0) + (a.comments || 0) + (a.shares || 0) + (a.saves || 0);

      // Monthly
      const monthKey = dateStr.substring(0, 7); // YYYY-MM
      if (monthlyMap[monthKey]) {
        monthlyMap[monthKey].impressions += a.impressions || 0;
        monthlyMap[monthKey].engagements += eng;
        monthlyMap[monthKey].likes += a.likes || 0;
        monthlyMap[monthKey].comments += a.comments || 0;
        monthlyMap[monthKey].shares += a.shares || 0;
        monthlyMap[monthKey].saves += a.saves || 0;
        monthlyMap[monthKey].views += a.views || 0;
        monthlyMap[monthKey].posts += 1;
      }

      // Weekly — find closest week bucket
      const postDate = new Date(dateStr);
      for (const weekDate of Object.keys(weeklyMap).sort()) {
        const wd = new Date(weekDate);
        const nextWeek = new Date(wd);
        nextWeek.setDate(nextWeek.getDate() + 7);
        if (postDate >= wd && postDate < nextWeek) {
          weeklyMap[weekDate].impressions += a.impressions || 0;
          weeklyMap[weekDate].engagements += eng;
          weeklyMap[weekDate].posts += 1;
          break;
        }
      }

      // Per-account — the analytics endpoint doesn't include accountId,
      // so we resolve by matching platform name to known accounts.
      // If accountId IS present (populated object or string), use it; otherwise match by platform.
      const rawAccountId = post.accountId || post.platforms?.[0]?.accountId;
      const populatedAcct = typeof rawAccountId === "object" && rawAccountId !== null ? rawAccountId : null;
      let postAccountId = populatedAcct?._id || (typeof rawAccountId === "string" ? rawAccountId : null) || post.account?._id || post.account?.id;

      // Fallback: match by platform name when no accountId is available
      const postPlatform = (post.platform || post.platforms?.[0]?.platform || "unknown").toLowerCase();
      if (!postAccountId) {
        const acctByPlatform = accounts.find((ac: any) => ac.platform?.toLowerCase() === postPlatform);
        postAccountId = acctByPlatform?._id || `platform:${postPlatform}`;
      }

      if (!accountPerfMap[postAccountId]) {
        const acct = accounts.find((ac: any) => ac._id === postAccountId);
        const acctByPlatform = !acct ? accounts.find((ac: any) => ac.platform?.toLowerCase() === postPlatform) : null;
        const resolvedAcct = acct || acctByPlatform;
        accountPerfMap[postAccountId] = {
          accountId: postAccountId,
          platform: (populatedAcct?.platform || resolvedAcct?.platform || postPlatform).toLowerCase(),
          displayName: populatedAcct?.displayName || resolvedAcct?.displayName || "Unknown",
          username: populatedAcct?.username || resolvedAcct?.username || "",
          avatarUrl: populatedAcct?.profilePicture || populatedAcct?.avatarUrl || resolvedAcct?.avatarUrl || "",
          impressions: 0,
          engagements: 0,
          likes: 0,
          comments: 0,
          shares: 0,
          posts: 0,
          engagementRate: 0,
        };
      }
      accountPerfMap[postAccountId].impressions += a.impressions || 0;
      accountPerfMap[postAccountId].engagements += eng;
      accountPerfMap[postAccountId].likes += a.likes || 0;
      accountPerfMap[postAccountId].comments += a.comments || 0;
      accountPerfMap[postAccountId].shares += a.shares || 0;
      accountPerfMap[postAccountId].posts += 1;
    }

    // Calculate engagement rates per account
    for (const perf of Object.values(accountPerfMap)) {
      perf.engagementRate =
        perf.impressions > 0
          ? parseFloat(((perf.engagements / perf.impressions) * 100).toFixed(1))
          : 0;
    }

    const monthly = Object.values(monthlyMap).sort((a, b) =>
      a.month.localeCompare(b.month)
    );

    const weekly = Object.values(weeklyMap).sort((a, b) =>
      a.week.localeCompare(b.week)
    );

    const accountPerformance = Object.values(accountPerfMap).sort(
      (a, b) => b.impressions - a.impressions
    );

    // Calculate overall metrics
    const totalPosts = posts.length;
    const totalImpressions = posts.reduce(
      (sum: number, p: any) => sum + (p.analytics?.impressions || 0),
      0
    );
    const totalEngagements = posts.reduce((sum: number, p: any) => {
      const a = p.analytics || {};
      return sum + (a.likes || 0) + (a.comments || 0) + (a.shares || 0) + (a.saves || 0);
    }, 0);

    // Date range info
    const postDates = posts
      .map((p: any) => p.publishedAt || p.scheduledFor)
      .filter(Boolean)
      .sort();
    const earliestDate = postDates[0] || null;
    const latestDate = postDates[postDates.length - 1] || null;

    // Try follower stats (will likely fail without analytics add-on)
    let followerStats = null;
    try {
      const targetAccountId = accountId || accounts[0]?._id;
      if (targetAccountId) {
        const stats = await lateApiFetch(
          `/analytics/follower-stats?accountId=${targetAccountId}`
        );
        followerStats = stats;
      }
    } catch {
      // Expected — analytics add-on required
    }

    return NextResponse.json({
      accounts,
      monthly,
      weekly,
      accountPerformance,
      summary: {
        totalPosts,
        totalImpressions,
        totalEngagements,
        overallEngagementRate:
          totalImpressions > 0
            ? parseFloat(
                ((totalEngagements / totalImpressions) * 100).toFixed(1)
              )
            : 0,
        earliestDate,
        latestDate,
        dataRangeDays: earliestDate
          ? Math.ceil(
              (Date.now() - new Date(earliestDate).getTime()) / 86400000
            )
          : 0,
      },
      followerStats,
      followerStatsAvailable: followerStats !== null,
    });
  } catch (error: any) {
    console.error("Growth analytics error:", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
