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
  document_last_snapshot?: any;
}

const BRIEF_STYLE = `

# Scheduled brief — output rules
This is an automated scheduled run, delivered to the user's inbox and saved to a thread. No one is chatting with you live.
- Start with a single bold dated headline stating the most important change/number (e.g. "**Operations Brief — Wed 16 Jul**: 36 CU commissioned MTD, Hiscox leads").
- Lead with what CHANGED or matters most; then short, skimmable sections. One phone screen of content — be selective, not exhaustive.
- Use the workspace tools to ground EVERY figure; include "Data as of <time>" at the end.
- No greetings, no "let me check", no questions back to the user.`;

const MONITOR_STYLE = `

# Monitor run — additional rules
This task is a MONITOR: it checks on a schedule but the user is only notified when something changed. Your job every run:
1. Use the tools to gather the CURRENT values for exactly what the prompt watches.
2. Write the normal brief describing the current state and anything that moved.
3. End your response with a machine-readable state block, EXACTLY in this form (single line, valid JSON):
[MONITOR_STATE]{"facts": {"<stable_key>": <value>, ...}, "condition_met": true|false, "changed_summary": "<max 100 chars>"}[/MONITOR_STATE]
- "facts": the key observed values. Keys MUST be stable across runs (same names, same units) so runs can be compared — derive them from the prompt, not from today's data.
- "condition_met": ONLY if the prompt states a threshold/condition (e.g. "when utilisation exceeds 80%"): true if currently met. Omit the field if no condition is defined.
- "changed_summary": one short clause naming the most important change, e.g. "Hiscox utilisation 78%→84%".
The block is stripped before delivery — never mention it.`;

/** Lean copy of the chat route's workspace-config loader (route files can't export helpers). */
async function loadWorkspaceConfig(workspaceId: string) {
  const [typesRes, cuRes, settingsRes] = await Promise.all([
    supabase.from("types_content").select("id_type, key_type, type_content, flag_active").eq("flag_active", 1),
    supabase.from("calculator_content").select("id, name, format, units_content").order("sort_order"),
    intelligenceDb.from("ai_settings").select("information_format_descriptions, information_type_instructions, information_company_context").eq("id_workspace", workspaceId).maybeSingle(),
  ]);
  // Unknown-column fallback while the migration is pending: an unknown column
  // fails the whole select, which would silently drop format descriptions too.
  const settingsData: any = settingsRes.error
    ? (await intelligenceDb.from("ai_settings").select("information_format_descriptions, information_type_instructions").eq("id_workspace", workspaceId).maybeSingle()).data
    : settingsRes.data;
  const cuData = cuRes.data || [];
  const idToName: Record<string, string> = {};
  cuData.forEach((c: any) => { idToName[c.id] = c.name; });
  const formatDescriptions: Record<string, string> = {};
  for (const [id, desc] of Object.entries((settingsData?.information_format_descriptions as Record<string, string>) || {})) {
    if (desc?.trim()) formatDescriptions[idToName[id] || id] = desc;
  }
  return {
    contentTypes: (typesRes.data || []).map((t: any) => ({ key: t.key_type, name: t.type_content, aiPrompt: null })),
    cuDefinitions: cuData.map((c: any) => ({ format: c.name, category: c.format, units: c.units_content })),
    formatDescriptions,
    typeInstructions: (settingsData?.information_type_instructions as Record<string, string>) || {},
    companyContext: (settingsData?.information_company_context as string) || null,
  };
}

export interface RunResult {
  status: "delivered" | "no_change" | "failed";
  messageId: string | null;
  inputTokens: number;
  outputTokens: number;
  durationMs: number;
  error?: string;
}

/** Deterministic key-sorted stringify so snapshot comparison is order-independent. */
function stableStringify(v: any): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(",")}]`;
  return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${stableStringify(v[k])}`).join(",")}}`;
}

/** Extract + strip the [MONITOR_STATE] block. Returns null state if absent/garbled. */
function extractMonitorState(text: string): { state: { facts?: any; condition_met?: boolean; changed_summary?: string } | null; cleanText: string } {
  const re = /\[MONITOR_STATE\]([\s\S]*?)\[\/MONITOR_STATE\]/;
  const m = text.match(re);
  if (!m) return { state: null, cleanText: text };
  let state: any = null;
  try { state = JSON.parse(m[1]); } catch { /* garbled — fail open (deliver) */ }
  return { state, cleanText: text.replace(/\[MONITOR_STATE\][\s\S]*?\[\/MONITOR_STATE\]/g, "").replace(/\n{3,}/g, "\n\n").trim() };
}

export async function runScheduledPrompt(task: ScheduledPromptRow): Promise<RunResult> {
  const started = Date.now();
  try {
    const [workspaceConfig, clientsRes, financeRes] = await Promise.all([
      loadWorkspaceConfig(task.id_workspace),
      supabase.from("app_clients").select("id_client"),
      // Scheduled runs execute with the task OWNER's finance access — a
      // non-finance user's task must not reach Xero.
      intelligenceDb.from("users_access").select("flag_access_finance").eq("id_workspace", task.id_workspace).eq("user_target", task.user_created).maybeSingle(),
    ]);
    const workspaceClientIds = (clientsRes.data || []).map((c: any) => c.id_client).filter(Boolean) as number[];

    // config_context also carries meta keys (proposalId from NL-confirmed tasks).
    // Strip them first: normalizeContextConfig(null) and ({}) resolve to different
    // defaults, so a meta-only object must behave exactly like null.
    const { proposalId: _meta, ...ctxRest } = (task.config_context || {}) as Record<string, any>;
    const contextConfig = normalizeContextConfig(Object.keys(ctxRest).length ? ctxRest : null);
    const queryRoute = routeQuery(task.document_prompt, contextConfig);

    // Model: resolve 'auto' like the chat route (incl. the grounded-search override),
    // but FLOOR auto at the reasoning tier: scheduled runs are unattended — nobody
    // is watching to catch grok-4-1-fast fabricating a tool arg or a figure.
    let model = task.name_model || "auto";
    if (model === "auto") {
      model = routeModel(task.document_prompt);
      if (model === "grok-4-1-fast") model = "grok-4-3";
    }
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
    if (task.type_task === "monitor") {
      systemPrompt += MONITOR_STYLE;
      // The model can only truthfully describe movement if it SEES the baseline —
      // without this, "78%→84%"-style deltas are fabricated.
      const prev = task.document_last_snapshot;
      if (prev && typeof prev === "object" && prev.facts && Object.keys(prev.facts).length > 0) {
        systemPrompt += `\n\n# Previous snapshot (your baseline)\nMeasured ${prev.checked_at || "on the previous run"}: ${JSON.stringify(prev.facts).slice(0, 2000)}\nDescribe movement ONLY relative to these baseline values, and reuse the same fact keys. If a value has no baseline entry, state its current value without inventing a prior one.`;
      } else {
        systemPrompt += `\n\n# No baseline yet\nThis is the first measured run. State CURRENT values only — do not claim anything "changed" or invent prior values. Use changed_summary for the current headline value (e.g. "Hiscox utilisation 84%").`;
      }
    }

    // Read the thread's CURRENT audience rather than assuming "private".
    // Scheduled threads are created private, but the owner (or previously an
    // admin) can flip one to Team, and every run appends its output there. A
    // hardcoded "private" meant a flipped thread kept executing personal-scope
    // tools — unattended, for ever, into a workspace-readable thread. Shared
    // threads count as team too: a share recipient is an extra reader.
    let runAudience: "private" | "team" = "private";
    if (task.id_conversation) {
      const [{ data: conv }, { count: shareCount }] = await Promise.all([
        intelligenceDb
          .from("ai_conversations")
          .select("type_visibility")
          .eq("id_conversation", task.id_conversation)
          .maybeSingle(),
        intelligenceDb
          .from("ai_shares")
          .select("id_conversation", { count: "exact", head: true })
          .eq("id_conversation", task.id_conversation),
      ]);
      if (conv?.type_visibility === "team" || (shareCount || 0) > 0) {
        runAudience = "team";
        console.log(`[Scheduled] Task ${task.id_prompt}: thread is ${conv?.type_visibility === "team" ? "team-visible" : "shared"} — personal-scope tools blocked this run`);
      }
    }

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
          conversationVisibility: runAudience,
          selectedClientId: task.id_client || undefined,
          financeAccess: !!financeRes?.data?.flag_access_finance,
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

    logAiUsage({
      workspaceId: task.id_workspace,
      userId: task.user_created,
      model,
      source: "scheduled-prompt",
      inputTokens,
      outputTokens,
    });

    // Monitor gate: compare this run's state block against the stored snapshot
    // and stay QUIET when nothing changed (the whole point of a monitor).
    // Threshold semantics re-arm: condition_met fires only on false→true.
    let deliverText = fullText;
    let changedSummary: string | null = null;
    if (task.type_task === "monitor") {
      const { state, cleanText } = extractMonitorState(fullText);
      // Never deliver the raw machine block: if the model wrote nothing but the
      // block, fall back to the changed_summary as the body.
      deliverText = cleanText
        || (state && typeof state.changed_summary === "string" && state.changed_summary
              ? `**${task.name_title}** — ${state.changed_summary}`
              : fullText);
      const hasCondition = !!state && typeof state.condition_met === "boolean";
      const factsUsable = !!state && !!state.facts && typeof state.facts === "object" && Object.keys(state.facts).length > 0;
      if (state && (factsUsable || hasCondition)) {
        const prev = task.document_last_snapshot && typeof task.document_last_snapshot === "object"
          ? task.document_last_snapshot
          : null;
        const newSnap = {
          facts: factsUsable ? state.facts : null,
          ...(hasCondition ? { condition_met: state.condition_met } : {}),
          checked_at: new Date().toISOString(),
        };
        // Persist the latest state whatever the outcome — this IS the re-arm.
        await intelligenceDb
          .from("ai_scheduled_prompts")
          .update({ document_last_snapshot: newSnap })
          .eq("id_prompt", task.id_prompt);

        let notify: boolean;
        if (!prev) {
          notify = true; // first run = baseline delivery so the user sees it working
        } else if (hasCondition) {
          notify = state.condition_met === true && prev.condition_met !== true;
        } else {
          notify = stableStringify(state.facts ?? null) !== stableStringify(prev.facts ?? null);
        }
        if (!notify) {
          return { status: "no_change", messageId: null, inputTokens, outputTokens, durationMs: Date.now() - started };
        }
        changedSummary = typeof state.changed_summary === "string" ? state.changed_summary.slice(0, 100) : null;
      } else if (state) {
        // Parseable block but NOTHING comparable (no facts, no condition) — the
        // semantic twin of garbled JSON. Fail OPEN (deliver) and keep the old
        // snapshot: a good baseline must survive one bad run, otherwise the
        // monitor goes permanently silent while looking healthy.
        console.warn(`[Scheduled] Monitor ${task.id_prompt} state block had no usable facts/condition — delivering (fail open)`);
      }
      // No/garbled state block → fail open and deliver (never silently swallow a run).
    }

    // Append to the task's conversation
    let messageId: string | null = null;
    if (task.id_conversation) {
      const { data: msg } = await intelligenceDb
        .from("ai_messages")
        .insert({ id_conversation: task.id_conversation, role_message: "assistant", document_message: deliverText, name_model: model })
        .select("id_message")
        .single();
      messageId = msg?.id_message || null;
      await intelligenceDb.from("ai_conversations").update({ date_updated: new Date().toISOString() }).eq("id_conversation", task.id_conversation);
    }

    // Email delivery (short summary + deep link — the email is the teaser,
    // the thread is the product)
    if (task.flag_email === 1 && task.email_user && process.env.RESEND_API_KEY) {
      try {
        const base = process.env.NEXTAUTH_URL || "https://engine.thecontentengine.com";
        const link = `${base}/engineai?thread=${task.id_conversation}`;
        const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
        const bodyHtml = esc(deliverText.slice(0, 2200)).replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>").replace(/\n/g, "<br/>");
        const subject = task.type_task === "monitor"
          ? `🔔 ${task.name_title}${changedSummary ? `: ${changedSummary}` : ""}`
          : `⏰ ${task.name_title}`;
        await new Resend(process.env.RESEND_API_KEY).emails.send({
          from: "EngineAI <noreply@tasks.thecontentengine.com>",
          to: task.email_user,
          subject,
          html: `<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:600px;margin:0 auto;padding:16px;color:#111">
            <p style="font-size:14px;line-height:1.6">${bodyHtml}${deliverText.length > 2200 ? "<br/><em>…continued in the thread</em>" : ""}</p>
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
