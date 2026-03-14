import { intelligenceDb } from "@/lib/supabase-intelligence";
import { supabase } from "@/lib/supabase";
import { Resend } from "resend";

interface NotificationOpp {
  title: string;
  organisation: string;
  deadline: string | null;
  scope: string;
  relevanceScore: number;
  sourceUrl: string | null;
}

export async function sendScanNotifications(
  workspaceId: string,
  searchName: string,
  newOpps: NotificationOpp[]
): Promise<number> {
  if (!process.env.RESEND_API_KEY) return 0;

  // 1. Get all enabled notification settings for this workspace
  const { data: settings } = await intelligenceDb
    .from("rfp_notification_settings")
    .select("*")
    .eq("id_workspace", workspaceId)
    .eq("flag_enabled", 1);

  if (!settings || settings.length === 0) return 0;

  // 2. Verify RFP tool access for each user
  const userIds = settings.map((s: any) => s.user_target);
  const { data: accessRows } = await intelligenceDb
    .from("users_access")
    .select("user_target, flag_access_rfptool")
    .in("user_target", userIds);

  const accessMap = new Map(
    (accessRows || []).map((a: any) => [a.user_target, !!a.flag_access_rfptool])
  );

  // 3. Get user emails
  const { data: users } = await supabase
    .from("users")
    .select("id_user, name_user, email_user")
    .in("id_user", userIds);

  const userMap = new Map(
    (users || []).map((u: any) => [u.id_user, { name: u.name_user, email: u.email_user }])
  );

  // 4. Send emails
  const resend = new Resend(process.env.RESEND_API_KEY);
  const baseUrl = process.env.NEXTAUTH_URL || "https://engine.thecontentengine.com";
  let sentCount = 0;

  for (const setting of settings) {
    const userId = setting.user_target;
    const minRelevance = setting.units_min_relevance || 70;

    // Skip users without RFP access
    if (!accessMap.get(userId)) continue;

    // Filter opportunities by user's relevance threshold
    const relevantOpps = newOpps.filter((opp) => opp.relevanceScore >= minRelevance);
    if (relevantOpps.length === 0) continue;

    const user = userMap.get(userId);
    if (!user?.email) continue;

    try {
      const emailHtml = buildScanEmailHtml(
        user.name || "there",
        searchName,
        relevantOpps,
        minRelevance,
        baseUrl
      );

      await resend.emails.send({
        from: "RFP Tool <noreply@tasks.thecontentengine.com>",
        to: user.email,
        subject: `RFP Scan: ${relevantOpps.length} new opportunit${relevantOpps.length === 1 ? "y" : "ies"} found — ${searchName}`,
        html: emailHtml,
      });

      sentCount++;
    } catch (emailErr) {
      console.error(`[RFP Notify] Failed to email user ${userId}:`, emailErr);
    }
  }

  return sentCount;
}

function buildScanEmailHtml(
  userName: string,
  searchName: string,
  opportunities: NotificationOpp[],
  minRelevance: number,
  baseUrl: string
): string {
  const shown = opportunities.slice(0, 5);
  const remaining = opportunities.length - shown.length;

  const oppCards = shown
    .map(
      (opp) => `
    <div style="background: #f7f7f8; border-radius: 12px; padding: 16px 20px; margin: 0 0 12px;">
      <p style="font-size: 15px; font-weight: 600; color: #111; margin: 0 0 4px;">
        ${escapeHtml(opp.title)}
      </p>
      <p style="font-size: 13px; color: #666; margin: 0 0 4px;">
        ${escapeHtml(opp.organisation)}${opp.deadline ? ` &middot; Deadline: ${opp.deadline}` : ""}
      </p>
      <p style="font-size: 13px; color: #666; margin: 0 0 8px;">
        ${escapeHtml(opp.scope.slice(0, 120))}${opp.scope.length > 120 ? "..." : ""}
      </p>
      <span style="display: inline-block; background: ${opp.relevanceScore >= 80 ? "#dcfce7" : "#fef9c3"}; color: ${opp.relevanceScore >= 80 ? "#166534" : "#854d0e"}; font-size: 12px; font-weight: 600; padding: 2px 8px; border-radius: 9999px;">
        Score: ${opp.relevanceScore}%
      </span>
    </div>
  `
    )
    .join("");

  const moreText =
    remaining > 0
      ? `<p style="font-size: 13px; color: #666; margin: 0 0 24px; text-align: center;">...and ${remaining} more opportunit${remaining === 1 ? "y" : "ies"}.</p>`
      : "";

  const rfpToolUrl = `${baseUrl}/rfp-tool?tab=discover`;

  return `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 480px; margin: 0 auto; padding: 32px 0;">
      <p style="font-size: 15px; color: #333; line-height: 1.6; margin: 0 0 16px;">
        Hi ${escapeHtml(userName)},
      </p>
      <p style="font-size: 15px; color: #333; line-height: 1.6; margin: 0 0 24px;">
        Your scheduled scan <strong>${escapeHtml(searchName)}</strong> found
        <strong>${opportunities.length}</strong> new opportunit${opportunities.length === 1 ? "y" : "ies"}
        scoring above ${minRelevance}%:
      </p>
      ${oppCards}
      ${moreText}
      <a href="${rfpToolUrl}" style="display: inline-block; background: #111; color: #fff; padding: 10px 24px; border-radius: 8px; font-size: 14px; font-weight: 500; text-decoration: none;">
        View All Results
      </a>
      <p style="font-size: 12px; color: #999; margin: 24px 0 0; line-height: 1.5;">
        You received this because you have RFP scan notifications enabled.
        Manage your settings in the RFP Tool.
      </p>
    </div>
  `;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
