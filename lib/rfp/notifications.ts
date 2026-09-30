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

export interface DigestQueueItem {
  id_queue: string;
  id_workspace: string;
  name_search: string;
  title: string;
  organisation_name: string;
  date_deadline: string | null;
  document_scope: string | null;
  units_relevance_score: number;
  url_source: string | null;
  date_created: string;
}

// ── Real-time scan notifications ──
// Only sends to users with type_frequency = 'realtime'
export async function sendScanNotifications(
  workspaceId: string,
  searchName: string,
  newOpps: NotificationOpp[]
): Promise<number> {
  if (!process.env.RESEND_API_KEY) return 0;

  // Only get REAL-TIME notification settings for this workspace
  const { data: settings } = await intelligenceDb
    .from("rfp_notification_settings")
    .select("*")
    .eq("id_workspace", workspaceId)
    .eq("flag_enabled", 1)
    .eq("type_frequency", "realtime");

  if (!settings || settings.length === 0) return 0;

  // Verify RFP tool access for each user
  const userIds = settings.map((s: any) => s.user_target);
  const { data: accessRows } = await intelligenceDb
    .from("users_access")
    .select("user_target, flag_access_rfptool")
    .in("user_target", userIds);

  const accessMap = new Map(
    (accessRows || []).map((a: any) => [a.user_target, !!a.flag_access_rfptool])
  );

  // Get user emails
  const { data: users } = await supabase
    .from("users")
    .select("id_user, name_user, email_user")
    .in("id_user", userIds);

  const userMap = new Map(
    (users || []).map((u: any) => [u.id_user, { name: u.name_user, email: u.email_user }])
  );

  // Send emails
  const resend = new Resend(process.env.RESEND_API_KEY);
  const baseUrl = process.env.NEXTAUTH_URL || "https://engine.thecontentengine.com";
  let sentCount = 0;

  for (const setting of settings) {
    const userId = setting.user_target;
    const minRelevance = setting.units_min_relevance || 70;

    if (!accessMap.get(userId)) continue;

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

// ── Digest notifications ──
// Called by the digest cron job. Sends daily/weekly digest emails.
export async function sendDigestNotifications(
  workspaceId: string,
  digestType: "daily" | "weekly",
  queueItems: DigestQueueItem[]
): Promise<number> {
  if (!process.env.RESEND_API_KEY || queueItems.length === 0) return 0;

  // Get notification settings for this digest type
  const { data: settings } = await intelligenceDb
    .from("rfp_notification_settings")
    .select("*")
    .eq("id_workspace", workspaceId)
    .eq("flag_enabled", 1)
    .eq("type_frequency", digestType);

  if (!settings || settings.length === 0) return 0;

  // For weekly: only include users whose digest day matches today
  const todayDow = new Date().getDay(); // 0=Sun..6=Sat
  // Convert to ISO week day: 1=Mon..7=Sun
  const todayIsoDow = todayDow === 0 ? 7 : todayDow;

  const eligibleSettings = digestType === "weekly"
    ? settings.filter((s: any) => (s.units_digest_day || 1) === todayIsoDow)
    : settings;

  if (eligibleSettings.length === 0) return 0;

  // Verify RFP access
  const userIds = eligibleSettings.map((s: any) => s.user_target);
  const { data: accessRows } = await intelligenceDb
    .from("users_access")
    .select("user_target, flag_access_rfptool")
    .in("user_target", userIds);

  const accessMap = new Map(
    (accessRows || []).map((a: any) => [a.user_target, !!a.flag_access_rfptool])
  );

  // Get user emails
  const { data: users } = await supabase
    .from("users")
    .select("id_user, name_user, email_user")
    .in("id_user", userIds);

  const userMap = new Map(
    (users || []).map((u: any) => [u.id_user, { name: u.name_user, email: u.email_user }])
  );

  const resend = new Resend(process.env.RESEND_API_KEY);
  const baseUrl = process.env.NEXTAUTH_URL || "https://engine.thecontentengine.com";
  let sentCount = 0;

  for (const setting of eligibleSettings) {
    const userId = setting.user_target;
    const minRelevance = setting.units_min_relevance || 70;

    if (!accessMap.get(userId)) continue;

    const relevantItems = queueItems.filter(
      (item) => item.units_relevance_score >= minRelevance
    );
    if (relevantItems.length === 0) continue;

    const user = userMap.get(userId);
    if (!user?.email) continue;

    try {
      const emailHtml = buildDigestEmailHtml(
        user.name || "there",
        digestType,
        relevantItems,
        minRelevance,
        baseUrl
      );

      const periodLabel = digestType === "daily" ? "Daily" : "Weekly";
      await resend.emails.send({
        from: "RFP Tool <noreply@tasks.thecontentengine.com>",
        to: user.email,
        subject: `Your ${periodLabel} RFP Digest: ${relevantItems.length} new opportunit${relevantItems.length === 1 ? "y" : "ies"}`,
        html: emailHtml,
      });

      sentCount++;

      // Update last digest date
      await intelligenceDb
        .from("rfp_notification_settings")
        .update({ date_last_digest: new Date().toISOString() })
        .eq("id_workspace", workspaceId)
        .eq("user_target", userId);
    } catch (emailErr) {
      console.error(`[RFP Digest] Failed to email user ${userId}:`, emailErr);
    }
  }

  return sentCount;
}

// ── Email builders ──

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
        You received this because you have real-time RFP notifications enabled.
        Manage your settings in the RFP Tool.
      </p>
    </div>
  `;
}

export function buildDigestEmailHtml(
  userName: string,
  digestType: "daily" | "weekly",
  items: DigestQueueItem[],
  minRelevance: number,
  baseUrl: string
): string {
  const periodLabel = digestType === "daily" ? "Daily" : "Weekly";

  // Group items by search name
  const grouped: Record<string, DigestQueueItem[]> = {};
  for (const item of items) {
    const key = item.name_search;
    if (!grouped[key]) grouped[key] = [];
    grouped[key].push(item);
  }

  let sectionsHtml = "";
  const searchNames = Object.keys(grouped);
  for (const searchName of searchNames) {
    const searchItems = grouped[searchName];
    const shown = searchItems.slice(0, 5);
    const remaining = searchItems.length - shown.length;

    const cards = shown
      .map(
        (item) => `
      <div style="background: #f7f7f8; border-radius: 12px; padding: 16px 20px; margin: 0 0 12px;">
        <p style="font-size: 15px; font-weight: 600; color: #111; margin: 0 0 4px;">
          ${escapeHtml(item.title)}
        </p>
        <p style="font-size: 13px; color: #666; margin: 0 0 4px;">
          ${escapeHtml(item.organisation_name)}${item.date_deadline ? ` &middot; Deadline: ${new Date(item.date_deadline).toLocaleDateString()}` : ""}
        </p>
        ${item.document_scope ? `<p style="font-size: 13px; color: #666; margin: 0 0 8px;">${escapeHtml(item.document_scope.slice(0, 120))}${item.document_scope.length > 120 ? "..." : ""}</p>` : ""}
        <span style="display: inline-block; background: ${item.units_relevance_score >= 80 ? "#dcfce7" : "#fef9c3"}; color: ${item.units_relevance_score >= 80 ? "#166534" : "#854d0e"}; font-size: 12px; font-weight: 600; padding: 2px 8px; border-radius: 9999px;">
          Score: ${item.units_relevance_score}%
        </span>
      </div>
    `
      )
      .join("");

    const moreText =
      remaining > 0
        ? `<p style="font-size: 13px; color: #666; margin: 0 0 12px; text-align: center;">...and ${remaining} more.</p>`
        : "";

    sectionsHtml += `
      <div style="margin: 0 0 24px;">
        <p style="font-size: 13px; font-weight: 600; color: #555; text-transform: uppercase; letter-spacing: 0.5px; margin: 0 0 12px; padding-bottom: 6px; border-bottom: 1px solid #eee;">
          ${escapeHtml(searchName)}
        </p>
        ${cards}
        ${moreText}
      </div>
    `;
  }

  const rfpToolUrl = `${baseUrl}/rfp-tool?tab=discover`;

  return `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 480px; margin: 0 auto; padding: 32px 0;">
      <p style="font-size: 15px; color: #333; line-height: 1.6; margin: 0 0 16px;">
        Hi ${escapeHtml(userName)},
      </p>
      <p style="font-size: 15px; color: #333; line-height: 1.6; margin: 0 0 24px;">
        Here's your <strong>${periodLabel.toLowerCase()} RFP digest</strong> with
        <strong>${items.length}</strong> new opportunit${items.length === 1 ? "y" : "ies"}
        scoring above ${minRelevance}%:
      </p>
      ${sectionsHtml}
      <a href="${rfpToolUrl}" style="display: inline-block; background: #111; color: #fff; padding: 10px 24px; border-radius: 8px; font-size: 14px; font-weight: 500; text-decoration: none;">
        View All in RFP Tool
      </a>
      <p style="font-size: 12px; color: #999; margin: 24px 0 0; line-height: 1.5;">
        You received this because you have ${periodLabel.toLowerCase()} RFP digest enabled.
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
