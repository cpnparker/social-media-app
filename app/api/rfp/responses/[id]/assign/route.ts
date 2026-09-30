import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { intelligenceDb } from "@/lib/supabase-intelligence";
import { supabase } from "@/lib/supabase";
import { verifyWorkspaceMembership } from "@/lib/permissions";
import { Resend } from "resend";

// POST /api/rfp/responses/[id]/assign
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const currentUserId = parseInt(session.user.id, 10);
  const { id } = await params;

  try {
    // Fetch the response and verify workspace membership
    const { data: existing } = await intelligenceDb
      .from("rfp_responses")
      .select("id_workspace, title")
      .eq("id_response", id)
      .single();

    if (!existing) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const memberRole = await verifyWorkspaceMembership(currentUserId, existing.id_workspace);
    if (!memberRole) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const body = await req.json();
    const { userId, userName } = body;

    // Update the response with assignment
    const { data, error } = await intelligenceDb
      .from("rfp_responses")
      .update({
        id_user_assigned: userId || null,
        name_user_assigned: userName || null,
        date_updated: new Date().toISOString(),
      })
      .eq("id_response", id)
      .select()
      .single();

    if (error) throw error;

    // Send email notification if assigning a user (not removing)
    if (userId && process.env.RESEND_API_KEY) {
      try {
        const resend = new Resend(process.env.RESEND_API_KEY);

        // Get assignee's email
        const { data: assignee } = await supabase
          .from("users")
          .select("name_user, email_user")
          .eq("id_user", userId)
          .single();

        // Get assigner's name
        const { data: assigner } = await supabase
          .from("users")
          .select("name_user")
          .eq("id_user", currentUserId)
          .single();

        if (assignee?.email_user) {
          const assignerName = assigner?.name_user || "Someone";
          const assigneeName = assignee.name_user || "there";
          const baseUrl = process.env.NEXTAUTH_URL || "https://engine.thecontentengine.com";
          const proposalUrl = `${baseUrl}/rfp-tool?tab=pipeline&response=${id}`;

          await resend.emails.send({
            from: "RFP Tool <noreply@tasks.thecontentengine.com>",
            to: assignee.email_user,
            subject: `${assignerName} assigned you to a proposal: ${existing.title}`,
            html: `
              <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 480px; margin: 0 auto; padding: 32px 0;">
                <p style="font-size: 15px; color: #333; line-height: 1.6; margin: 0 0 16px;">
                  Hi ${assigneeName},
                </p>
                <p style="font-size: 15px; color: #333; line-height: 1.6; margin: 0 0 24px;">
                  <strong>${assignerName}</strong> assigned you to the following proposal:
                </p>
                <div style="background: #f7f7f8; border-radius: 12px; padding: 16px 20px; margin: 0 0 24px;">
                  <p style="font-size: 15px; font-weight: 600; color: #111; margin: 0;">
                    ${existing.title}
                  </p>
                </div>
                <a href="${proposalUrl}" style="display: inline-block; background: #111; color: #fff; padding: 10px 24px; border-radius: 8px; font-size: 14px; font-weight: 500; text-decoration: none;">
                  Open Proposal
                </a>
                <p style="font-size: 12px; color: #999; margin: 24px 0 0; line-height: 1.5;">
                  You received this because ${assignerName} assigned you to a proposal in the RFP Tool.
                </p>
              </div>
            `,
          });
        }
      } catch (emailErr) {
        console.error("[RFP Assign] Failed to send notification email:", emailErr);
        // Email errors don't fail the operation
      }
    }

    return NextResponse.json({ response: data });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
