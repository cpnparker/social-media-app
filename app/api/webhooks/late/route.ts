import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";

function verifyWebhookSignature(
  body: string,
  signature: string | null,
  secret: string | undefined
): boolean {
  if (!signature || !secret) return false;
  const expected = crypto
    .createHmac("sha256", secret)
    .update(body)
    .digest("hex");
  return crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(expected)
  );
}

// POST /api/webhooks/late — receive Late API webhook events
export async function POST(req: NextRequest) {
  const signature = req.headers.get("x-late-signature");
  const body = await req.text();

  // Verify webhook signature
  const isValid = verifyWebhookSignature(
    body,
    signature,
    process.env.LATE_WEBHOOK_SECRET
  );

  // In development, skip verification if no secret is configured
  if (!isValid && process.env.LATE_WEBHOOK_SECRET) {
    return new Response("Unauthorized", { status: 401 });
  }

  try {
    const event = JSON.parse(body);

    console.log(`[Webhook] Received event: ${event.type}`, event);

    switch (event.type) {
      case "post.published":
        // Update post status in DB
        console.log("[Webhook] Post published:", event.data);
        break;

      case "post.failed":
        // Update post status, notify user
        console.log("[Webhook] Post failed:", event.data);
        break;

      case "inbox.message":
        // New DM received — push to real-time
        console.log("[Webhook] New message:", event.data);
        break;

      case "comment.received":
        // New comment on a post
        console.log("[Webhook] New comment:", event.data);
        break;

      case "account.connected":
        // Account successfully connected via OAuth
        console.log("[Webhook] Account connected:", event.data);
        break;

      case "account.disconnected":
        // Account disconnected or token expired
        console.log("[Webhook] Account disconnected:", event.data);
        break;

      default:
        console.log(`[Webhook] Unhandled event type: ${event.type}`);
    }

    return new Response("OK", { status: 200 });
  } catch (error) {
    console.error("[Webhook] Error processing event:", error);
    return new Response("Internal Server Error", { status: 500 });
  }
}
