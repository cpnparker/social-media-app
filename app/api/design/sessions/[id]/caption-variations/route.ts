import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { auth } from "@/lib/auth";
import { intelligenceDb } from "@/lib/supabase-intelligence";
import { supabase } from "@/lib/supabase";
import { checkSessionAccess } from "@/lib/ai/access";

/**
 * POST /api/design/sessions/[id]/caption-variations
 *
 * Generates 3 alternative captions for the publish sheet — same content brief
 * and brand voice, but distinct tonal angles. Uses Claude Haiku for speed/cost.
 *
 * Body: { current?: string } — the current caption text; the generator riffs
 * around it rather than rewriting from scratch.
 *
 * Returns: { variations: [string, string, string] }
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const userId = parseInt(session.user.id, 10);
  const sessionId = params.id;
  const body = await req.json().catch(() => ({}));
  const current: string = body.current || "";

  // Access check (read-only is fine — just generating, not persisting)
  const { data: sessionRow } = await intelligenceDb
    .from("design_sessions")
    .select("type_visibility, user_created, id_workspace, id_client, id_content, id_brand_kit_snapshot")
    .eq("id_session", sessionId)
    .maybeSingle();
  if (!sessionRow) return NextResponse.json({ error: "Session not found" }, { status: 404 });
  const access = await checkSessionAccess(sessionId, userId, {
    visibility: (sessionRow as any).type_visibility,
    userCreated: (sessionRow as any).user_created,
    workspaceId: (sessionRow as any).id_workspace,
  });
  if (!access.allowed) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  // Pull brand voice + content brief for context
  let brandVoice: string | null = null;
  let clientName: string | null = null;
  if ((sessionRow as any).id_brand_kit_snapshot) {
    const { data: kit } = await intelligenceDb
      .from("design_brand_kits")
      .select("visual_identity")
      .eq("id_brand_kit", (sessionRow as any).id_brand_kit_snapshot)
      .maybeSingle();
    brandVoice = (kit as any)?.visual_identity?.voice || null;
  }
  if ((sessionRow as any).id_client) {
    const { data: c } = await supabase
      .from("app_clients")
      .select("name_client")
      .eq("id_client", (sessionRow as any).id_client)
      .maybeSingle();
    clientName = (c as any)?.name_client || null;
  }

  let brief: string | null = null;
  let contentTitle: string | null = null;
  if ((sessionRow as any).id_content) {
    const { data: ct } = await supabase
      .from("app_content")
      .select("name_content, information_brief")
      .eq("id_content", (sessionRow as any).id_content)
      .maybeSingle();
    contentTitle = (ct as any)?.name_content || null;
    brief = (ct as any)?.information_brief || null;
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json({ error: "ANTHROPIC_API_KEY not configured" }, { status: 500 });
  }
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const systemPrompt = `You write social captions for a content engine. Output ONLY a JSON array of exactly 3 short caption strings — no other text, no preamble, no markdown.

Each caption should be:
- 80–160 chars (rough — readability matters more than length)
- Distinct in angle: one declarative, one reflective, one with a hook
- On-voice for the brand
- Include 2–3 well-chosen hashtags at the end
- No emojis unless the existing caption uses them

DO NOT include the existing caption verbatim — vary the angle.`;

  const userPrompt = [
    contentTitle ? `Content: ${contentTitle}` : null,
    brief ? `Brief: ${brief.slice(0, 400)}` : null,
    clientName ? `Brand: ${clientName}` : null,
    brandVoice ? `Brand voice: ${brandVoice}` : null,
    current ? `Current caption: ${current}` : null,
  ].filter(Boolean).join("\n\n");

  try {
    const res = await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 700,
      temperature: 0.7,
      system: systemPrompt,
      messages: [{ role: "user", content: userPrompt }],
    });
    const text = res.content
      .filter((c: any) => c.type === "text")
      .map((c: any) => c.text)
      .join("");

    // Parse JSON array from the response — be lenient about leading/trailing junk
    const jsonMatch = text.match(/\[[\s\S]*\]/);
    if (!jsonMatch) {
      return NextResponse.json({ error: "Couldn't parse caption variations", raw: text }, { status: 502 });
    }
    const variations = JSON.parse(jsonMatch[0]);
    if (!Array.isArray(variations) || variations.length === 0) {
      return NextResponse.json({ error: "No variations returned" }, { status: 502 });
    }
    return NextResponse.json({ variations: variations.slice(0, 3).map(String) });
  } catch (err: any) {
    console.error("[caption-variations] failed:", err?.message);
    return NextResponse.json({ error: err?.message || "Generation failed" }, { status: 500 });
  }
}
