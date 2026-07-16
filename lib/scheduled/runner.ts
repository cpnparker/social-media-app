/**
 * Headless runner for recurring prompts.
 *
 * Runs a standing prompt through the SAME grounded pipeline as interactive
 * chat (system prompt, query router, full tool belt via
 * createStreamingResponse) with no browser attached — the stream's work
 * completes server-side regardless of consumers (the proven fact-check /
 * client-disconnect semantics). Results append to the task's persistent
 * conversation and optionally go out by email (Resend + deep link).
 */

import { Resend } from "resend";
import { supabase } from "@/lib/supabase";
import { intelligenceDb } from "@/lib/supabase-intelligence";
import { createStreamingResponse, type AIMessage } from "@/lib/ai/providers";
import { buildSystemPrompt, normalizeContextConfig } from "@/lib/ai/system-prompts";
import { routeQuery } from "@/lib/ai/query-router";
import { routeModel } from "@/lib/ai/auto-router";
import { logAiUsage } from "@/lib/ai/usage-logger";

export interface ScheduledPromptRow {
  id_prompt: string;
  id_workspace: string;
  user_created: number;
  email_user: string | null;
  name_title: string;
  document_prompt: string;
  type_task: string;
  name_model: string;
  id_client: number | null;
  config_context: any;
  flag_email: number;
  id_conversation: string | null;
}

const BRIEF_STYLE = `

# Scheduled brief — output rules
This is an automated scheduled run, delivered to the user's inbox and saved to a thread. No one is chatting with you live.
- Start with a single bold dated headline stating the most important change/number (e.g. "**Operations Brief — Wed 16 Jul**: 36 CU commissioned MTD, Hiscox leads").
- Lead with what CHANGED or matters most; then short, skimmable sections. One phone screen of content — be selective, not exhaustive.
- Use the workspace tools to ground EVERY figure; include "Data as of <time>" at the end.
- No greetings, no "let me check", no questions back to the user.`;

/** Lean copy of the chat route's workspace-config loader (route files can't export helpers). */
async function loadWorkspaceConfig(workspaceId: string) {
  const [typesRes, cuRes, settingsRes] = await Promise.all([
    supabase.from("types_content").select("id_type, key_type, type_content, flag_active").eq("flag_active", 1),
    supabase.from("calculator_content").select("id, name, format, units_content").order("sort_order"),
    intelligenceDb.from("ai_settings").select("information_format_descriptions, information_type_instructions").eq("id_workspace", workspaceId).maybeSingle(),
  ]);
  const cuData = cuRes.data || [];
  const idToName: Record<string, string> = {};
  cuData.forEach((c: any) => { idToName[c.id] = c.name; });
  const formatDescriptions: Record<string, string> = {};
  for (const [id, desc] of Object.entries((settingsRes.data?.information_format_descriptions as Record<string, string>) || {})) {
    if (desc?.trim()) formatDescriptions[idToName[id] || id] = desc;
  }
  return {
    contentTypes: (typesRes.data || []).map((t: any) => ({ key: t.key_type, name: t.type_content, aiPrompt: null })),
    cuDefinitions: cuData.map((c: any) => ({ format: c.name, category: c.format, units: c.units_content })),
    formatDescriptions,
    typeInstructions: (settingsRes.data?.information_type_instructions as Record<string, string>) || {},
  };
}

export interface RunResult {
  status: "delivered" | "failed";
  messageId: string | null;
  inputTokens: number;
  outputTokens: number;
  durationMs: number;
  error?: string;
}

export async function runScheduledPrompt(task: ScheduledPromptRow): Promise<RunResult> {
  const started = Date.now();
  try {
    const [workspaceConfig, clientsRes] = await Promise.all([
      loadWorkspaceConfig(task.id_workspace),
      supabase.from("app_clients").select("id_client"),
    ]);
    const workspaceClientIds = (clientsRes.data || []).map((c: any) => c.id_client).filter(Boolean) as number[];

    // config_context also carries meta keys (proposalId from NL-confirmed tasks).
    // Strip them first: normalizeContextConfig(null) and ({}) resolve to different
    // defaults, so a meta-only object must behave exactly like null.
    const { proposalId: _meta, ...ctxRest } = (task.config_context || {}) as Record<string, any>;
    const contextConfig = normalizeContextConfig(Object.keys(ctxRest).length ? ctxRest : null);
    const queryRoute = routeQuery(task.document_prompt, contextConfig);

    // Model: resolve 'auto' like the chat route (incl. the grounded-search override).
    let model = task.name_model || "auto";
    if (model === "auto") model = routeModel(task.document_prompt);
    if (queryRoute.searchMode === "on" && model.startsWith("grok")) model = "claude-sonnet-5";

    let systemPrompt = buildSystemPrompt({
      workspaceConfig,
      clientContext: null,
      contentDetail: null,
      contextConfig,
      latestUserMessage: task.document_prompt,
    });
    if (queryRoute.hints.length) systemPrompt += `\n\n${queryRoute.hints.join("\n")}`;
    systemPrompt += BRIEF_STYLE;

    const messages: AIMessage[] = [{ role: "user", content: task.document_prompt }];

    // Drain the stream server-side; capture the completion via onComplete.
    let completion: { fullText: string; inputTokens: number; outputTokens: number } | null = null;
    const done = new Promise<void>((resolve) => {
      const stream = createStreamingResponse(
        messages,
        {
          model,
          systemPrompt,
          maxTokens: 4096,
          webSearch: queryRoute.searchMode === "on",
          imageGeneration: false,
          workspaceClientIds,
          workspaceId: task.id_workspace,
          userId: task.user_created,
          userEmail: task.email_user || undefined,
          conversationVisibility: "private",
          selectedClientId: task.id_client || undefined,
          source: "scheduled-prompt",
        } as any,
        async (result) => {
          completion = result;
          resolve();
        }
      );
      // Consume to completion (belt-and-braces; upstream work runs regardless)
      void (async () => {
        const reader = stream.getReader();
        try { while (!(await reader.read()).done) { /* drain */ } } catch { /* stream error surfaces via completion */ }
      })();
    });
    await done;

    const fullText = completion ? (completion as any).fullText?.trim() || "" : "";
    const inputTokens = completion ? (completion as any).inputTokens || 0 : 0;
    const outputTokens = completion ? (completion as any).outputTokens || 0 : 0;
    if (!fullText) throw new Error("Run produced no output");

    // Append to the task's conversation
    let messageId: string | null = null;
    if (task.id_conversation) {
      const { data: msg } = await intelligenceDb
        .from("ai_messages")
        .insert({ id_conversation: task.id_conversation, role_message: "assistant", document_message: fullText, name_model: model })
        .select("id_message")
        .single();
      messageId = msg?.id_message || null;
      await intelligenceDb.from("ai_conversations").update({ date_updated: new Date().toISOString() }).eq("id_conversation", task.id_conversation);
    }

    logAiUsage({
      workspaceId: task.id_workspace,
      userId: task.user_created,
      model,
      source: "scheduled-prompt",
      inputTokens,
      outputTokens,
    });

    // Email delivery (short summary + deep link — the email is the teaser,
    // the thread is the product)
    if (task.flag_email === 1 && task.email_user && process.env.RESEND_API_KEY) {
      try {
        const base = process.env.NEXTAUTH_URL || "https://engine.thecontentengine.com";
        const link = `${base}/engineai?thread=${task.id_conversation}`;
        const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
        const bodyHtml = esc(fullText.slice(0, 2200)).replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>").replace(/\n/g, "<br/>");
        await new Resend(process.env.RESEND_API_KEY).emails.send({
          from: "EngineAI <noreply@tasks.thecontentengine.com>",
          to: task.email_user,
          subject: `⏰ ${task.name_title}`,
          html: `<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:600px;margin:0 auto;padding:16px;color:#111">
            <p style="font-size:14px;line-height:1.6">${bodyHtml}${fullText.length > 2200 ? "<br/><em>…continued in the thread</em>" : ""}</p>
            <p style="margin:20px 0"><a href="${link}" style="background:#111;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;font-size:14px">Open in EngineAI</a></p>
            <p style="font-size:11px;color:#888">Scheduled prompt "${esc(task.name_title)}" — manage it in EngineAI → Scheduled.</p>
          </div>`,
        });
      } catch (e: any) {
        console.error(`[Scheduled] Email failed for ${task.id_prompt}:`, e.message);
      }
    }

    return { status: "delivered", messageId, inputTokens, outputTokens, durationMs: Date.now() - started };
  } catch (err: any) {
    console.error(`[Scheduled] Run failed for ${task.id_prompt}:`, err.message);
    return { status: "failed", messageId: null, inputTokens: 0, outputTokens: 0, durationMs: Date.now() - started, error: String(err.message || err).slice(0, 500) };
  }
}
