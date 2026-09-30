import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { anthropicCallParams } from "@/lib/ai/anthropic-params";
import { auth } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { intelligenceDb } from "@/lib/supabase-intelligence";
import { checkConversationAccess } from "@/lib/ai/access";
import { hasEngineAiAccess } from "@/lib/permissions";
import { VOICE_TOOL_NAMES, VOICE_GATED_TOOLS } from "@/lib/ai/voice";
import { calculateCostTenths } from "@/lib/ai/model-costs";
import {
  queryEngine,
  lookupClientContext,
  searchMemory,
  queryMeetingBrain,
  querySlack,
  formatToolResult,
  formatMeetingBrainResult,
  formatSlackResult,
  formatXeroResult,
} from "@/lib/ai/providers";

export const maxDuration = 60;

// POST /api/ai/voice/tools — execute a function call emitted by the voice model.
// Body: { conversationId, name, arguments } (arguments = parsed object or JSON string)
// Returns: { output: string } to send back as function_call_output.
//
// Privacy: the same conversation-visibility gate as the text pipeline — in
// team threads, personal MeetingBrain reports and Slack are blocked inside
// queryMeetingBrain/querySlack via the visibility option.
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = parseInt(session.user.id, 10);
  const userEmail = session.user.email || "";

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const { conversationId, name } = body || {};
  let args = body?.arguments ?? {};
  if (typeof args === "string") {
    try { args = JSON.parse(args || "{}"); } catch { args = {}; }
  }

  if (!conversationId || !name) {
    return NextResponse.json({ error: "conversationId and name are required" }, { status: 400 });
  }
  if (!VOICE_TOOL_NAMES.includes(name)) {
    return NextResponse.json({ error: `Unknown tool: ${name}` }, { status: 400 });
  }

  try {
    const { data: conversation } = await intelligenceDb
      .from("ai_conversations")
      .select("id_conversation, type_visibility, user_created, id_workspace, id_client")
      .eq("id_conversation", conversationId)
      .maybeSingle();
    if (!conversation) {
      return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
    }
    const access = await checkConversationAccess(conversationId, userId, {
      visibility: conversation.type_visibility,
      userCreated: conversation.user_created,
      workspaceId: conversation.id_workspace,
    });
    if (!access.allowed) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    // A VIEW-only share recipient must not write here. Without this, they can
    // inject a voice tool execution into someone else's thread — which the owner's
    // next turn reads back as trusted prior context.
    if (access.permission === "view") {
      return NextResponse.json({ error: "Read-only access to this conversation" }, { status: 403 });
    }

    // Reaching a conversation is not entitlement to run a turn against it —
    // the voice surface reaches Engine, client context, MeetingBrain and Slack
    // with the same reach as chat, so it needs the same front door.
    if (!(await hasEngineAiAccess(userId, conversation.id_workspace))) {
      return NextResponse.json(
        { error: "You do not have access to EngineAI" },
        { status: 403 }
      );
    }

    // Audience must match the text pipeline's definition: a "private" thread
    // shared with colleagues has more than one reader, and voice turns are
    // persisted into the owner's thread for all of them to read. Using raw
    // type_visibility here meant personal MeetingBrain tasks, Slack DMs and
    // private memories were fully unlocked inside a shared thread.
    const { count: shareCount, error: shareErr } = await intelligenceDb
      .from("ai_shares")
      .select("id_conversation", { count: "exact", head: true })
      .eq("id_conversation", conversationId);
    const visibility: "private" | "team" =
      conversation.type_visibility === "team" ||
      // FAIL CLOSED — supabase-js resolves a failed query as {count:null,error},
      // and `(null || 0) > 0` is false, so discarding the error turned "cannot
      // tell how many readers" into "only one" and unlocked personal-scope data
      // in a shared thread. This gate decides whether Slack DMs, personal
      // MeetingBrain reports and finance figures are reachable; not knowing has
      // to mean treating the thread as shared.
      shareErr != null ||
      (shareCount || 0) > 0 ||
      conversation.user_created !== userId
        ? "team"
        : "private";
    const workspaceId: string = conversation.id_workspace;

    // The tool list was handed to the BROWSER at session mint. What comes back
    // is a request, not a permission, so every gated tool is re-checked here
    // against the flag — never against the fact that the name was offered.
    // Each flag reads in its own select: an unknown column fails the whole
    // PostgREST select, so a combined query would let a missing migration
    // revoke finance rather than merely deny the newer flag.
    const gate = VOICE_GATED_TOOLS[name];
    if (gate) {
      const column = gate === "finance" ? "flag_access_finance" : "flag_access_resourcing";
      let granted = false;
      try {
        const { data } = await intelligenceDb
          .from("users_access")
          .select(column)
          .eq("id_workspace", workspaceId)
          .eq("user_target", userId)
          .maybeSingle();
        granted = (data as any)?.[column] === 1;
      } catch { /* pre-migration or no row = denied */ }

      // Finance additionally follows the text pipeline's audience rule: a
      // multi-reader thread must not surface receivables or forecasts.
      if (gate === "finance" && visibility === "team") granted = false;

      if (!granted) {
        return NextResponse.json({
          output:
            gate === "finance"
              ? "You do not have finance access in this workspace, or this is a shared thread where financial figures are not available. Say so briefly — do NOT answer the question from other data."
              : "You do not have resourcing access in this workspace. Say so briefly — do NOT answer the question from other data.",
        });
      }
    }

    let output: string;

    switch (name) {
      case "query_engine": {
        const { data: clients } = await supabase.from("app_clients").select("id_client");
        const workspaceClientIds = (clients || []).map((c: any) => c.id_client).filter(Boolean) as number[];
        // Voice is the FIFTH query_engine call site — the four text chains are
        // in providers.ts. It used to resolve the client anchor here and pass
        // it in the clientId slot, which meant queryEngine saw a caller-supplied
        // client: scope:"workspace" could not override it and no scoping note
        // was produced. Pass the model's own client_id, and the thread's client
        // as the ANCHOR, so voice behaves exactly like the text chains.
        const result = await queryEngine(
          args.table,
          args.columns,
          args.filters,
          args.order,
          args.limit,
          workspaceClientIds,
          args.report,
          args.date_from,
          args.date_to,
          args.client_id,
          args.group_by,
          args.assignee_name,
          args,
          conversation.id_client || undefined
        );
        output = formatToolResult(result);
        break;
      }
      case "lookup_client_context": {
        output = await lookupClientContext(args.client_name, workspaceId);
        break;
      }
      case "search_memory": {
        const result = await searchMemory(args.query, args.scope || "both", workspaceId, userId, visibility);
        output = `${result.summary}\n\nMemories:\n${result.memories.map((m: any) => `- [${m.category}] ${m.content} (${m.date})`).join("\n") || "None found"}`;
        break;
      }
      case "query_meetingbrain": {
        const result = await queryMeetingBrain(args.report, userEmail, {
          query: args.query,
          status: args.status,
          days: args.days,
          workspaceId,
          meetingId: args.meeting_id,
          visibility,
        });
        output = formatMeetingBrainResult(args.report, result);
        break;
      }
      case "query_xero": {
        const result =
          args.report === "forecast"
            ? await (await import("@/lib/finance/forecast")).queryForecast(args.sheet, args.match)
            : await (await import("@/lib/xero/client")).queryXero(args.report, workspaceId, {
                date_from: args.date_from,
                date_to: args.date_to,
                client_name: args.client_name,
                audience: visibility === "team" ? "team" : "solo",
              });
        output = formatXeroResult(args.report, result);
        break;
      }
      case "query_resourcing": {
        const { queryResourcing, formatResourcingResult } = await import("@/lib/airtable/query");
        output = formatResourcingResult(await queryResourcing(args));
        break;
      }
      case "query_slack": {
        const result = await querySlack(args.report, userEmail, {
          query: args.query,
          channel: args.channel,
          channel_id: args.channel_id,
          thread_ts: args.thread_ts,
          days: args.days,
          limit: args.limit,
          visibility,
        });
        output = formatSlackResult(args.report, result);
        break;
      }
      case "search_thread": {
        // THIS conversation's own earlier messages, scoped to the conversation
        // the session is already bound to and already access-checked above. The
        // model supplies only a search term — never a conversation id — so it
        // cannot reach a thread the caller could not read.
        const q = String(args.query || "").trim();
        if (!q) {
          output = "search_thread needs a `query` — one or two distinctive words to look for in this conversation.";
          break;
        }
        // ilike with the term as a substring. Deliberately simple: the model is
        // told to pass ONE distinctive word, because a long phrase matches
        // nothing in prose that has been paraphrased since.
        const { data: hits, error: searchErr } = await intelligenceDb
          .from("ai_messages")
          .select("role_message, document_message, date_created")
          .eq("id_conversation", conversationId)
          .ilike("document_message", `%${q.replace(/[%_]/g, "")}%`)
          .order("date_created", { ascending: true })
          .limit(6);
        if (searchErr) {
          output = `The search of this conversation failed: ${searchErr.message}. Say you could not check, not that the thing does not exist.`;
          break;
        }
        const rows = (hits || []) as any[];
        if (rows.length === 0) {
          // A miss is a fact about the WORD, not about the conversation — the
          // distinction this whole surface keeps getting wrong.
          output =
            `No message in this conversation contains "${q}". That means this SEARCH TERM did not match, not that the thing is absent. ` +
            `Try one different distinctive word (a surname, a client name, a single noun) before telling the user you cannot find it. ` +
            `Never ask them to paste back something they already put in this conversation.`;
          break;
        }
        // CENTRED ON THE MATCH, not clipped from the start.
        //
        // Clipping from the start looked fine and was not: the thing being
        // retrieved is typically a pasted document, and the one that prompted
        // this tool is 6,888 characters. A clip from the front returned the
        // first third of a handover list and dropped the rest — which reads as
        // an answer while containing none of what was asked for. Measured on
        // that thread: 4 of 15 list items survived a front clip, all 15 survive
        // a window round the match.
        // THE LONGEST MATCH COMES BACK WHOLE; the rest get a window.
        //
        // What people ask this tool to find is almost always a DOCUMENT they
        // pasted — a handover list, a brief, an email chain — and the useful
        // answer is the document, not an excerpt of it. Centring a 3,200-char
        // window on the match was still wrong for the case that prompted this:
        // the word "handover" sits in the list's first line, so the window
        // covered its opening third and returned 5 of 15 items. Whether the
        // retrieval works should not depend on where in the document the search
        // term happens to fall.
        //
        // So the biggest hit — the document — is returned in full up to 9,000
        // characters, and the others are windowed around their match. That
        // reads as one long tool result, which the model handles fine; it is
        // never spoken aloud.
        const WINDOW = 1500;
        const FULL_CAP = 9000;
        let longest = 0;
        for (let i = 1; i < rows.length; i++) {
          if (String(rows[i].document_message || "").length > String(rows[longest].document_message || "").length) longest = i;
        }
        const parts = rows.map((r, i) => {
          const who = r.role_message === "user" ? "They wrote" : "You wrote";
          const when = String(r.date_created || "").slice(0, 10);
          const full = String(r.document_message || "");
          const cap = i === longest ? FULL_CAP : WINDOW;
          if (full.length <= cap) return `${who} (${when}):\n${full}`;
          const at = full.toLowerCase().indexOf(q.toLowerCase());
          const start = i === longest ? 0 : Math.max(0, (at < 0 ? 0 : at) - Math.floor(cap / 3));
          const clip = full.slice(start, start + cap);
          return `${who} (${when}, ${clip.length} of ${full.length} characters):\n${start > 0 ? "…" : ""}${clip}${start + cap < full.length ? "…" : ""}`;
        });
        output = `Found ${rows.length} earlier message(s) in this conversation matching "${q}":\n\n${parts.join("\n\n---\n\n")}`;
        break;
      }
      case "end_conversation": {
        // Normally intercepted client-side; harmless if it lands here.
        output = "Conversation ending — say one short, warm sign-off now.";
        break;
      }
      case "ask_engine": {
        // The escalation hatch, WITH TOOLS.
        //
        // consult_analyst had none, so it answered from priors — and its reply
        // came back as a tool result, which the voice prompt says to relay, so
        // an invented figure was laundered into a spoken answer carrying the
        // same confidence as one from Xero. This one can look things up, and
        // its whole job is the class of question voice keeps getting wrong:
        // ones needing two sources cross-referenced, or a judgement about what
        // is DONE rather than merely listed.
        const question = String(args.question || "").trim();
        if (!question) { output = "ask_engine needs a `question`."; break; }

        const { data: clientRows } = await supabase.from("app_clients").select("id_client");
        const clientIds = (clientRows || []).map((c: any) => c.id_client).filter(Boolean) as number[];

        /** Run one tool for the escalated model, reusing the same executors and
         *  the same formatters the voice path uses — so a result reaching Claude
         *  carries the identical caveats, including the ones about absence. */
        const runTool = async (n: string, a: any): Promise<string> => {
          try {
            if (n === "query_engine") {
              return formatToolResult(await queryEngine(
                a.table, a.columns, a.filters, a.order, a.limit, clientIds, a.report,
                a.date_from, a.date_to, a.client_id, a.group_by, a.assignee_name, a,
                conversation.id_client || undefined
              ));
            }
            if (n === "query_meetingbrain") {
              return formatMeetingBrainResult(a.report, await queryMeetingBrain(
                a.report, userEmail,
                { query: a.query, status: a.status, days: a.days, workspaceId, meetingId: a.meeting_id, visibility }
              ));
            }
            if (n === "search_thread") {
              const term = String(a.query || "").replace(/[%_]/g, "").trim();
              if (!term) return "search_thread needs a query.";
              const { data: hits } = await intelligenceDb
                .from("ai_messages")
                .select("role_message, document_message, date_created")
                .eq("id_conversation", conversationId)
                .ilike("document_message", `%${term}%`)
                .order("date_created", { ascending: true })
                .limit(6);
              const hr = (hits || []) as any[];
              if (!hr.length) return `Nothing in this conversation contains "${term}". That is a fact about the WORD, not about the world — try another distinctive term before concluding anything is absent.`;
              let big = 0;
              for (let i = 1; i < hr.length; i++) {
                if (String(hr[i].document_message || "").length > String(hr[big].document_message || "").length) big = i;
              }
              return hr.map((r, i) => {
                const cap = i === big ? 9000 : 1500;
                return `${r.role_message === "user" ? "They wrote" : "You wrote"} (${String(r.date_created).slice(0, 10)}):\n${String(r.document_message || "").slice(0, cap)}`;
              }).join("\n\n---\n\n");
            }
            if (n === "search_memory") {
              const m = await searchMemory(a.query, a.scope || "both", workspaceId, userId, visibility);
              return `${m.summary}\n\nMemories:\n${m.memories.map((x: any) => `- [${x.category}] ${x.content} (${x.date})`).join("\n") || "None found"}`;
            }
            if (n === "lookup_client_context") {
              return await lookupClientContext(a.client_name, workspaceId);
            }
            return `Unknown tool ${n}.`;
          } catch (e: any) {
            // A failed tool must read as a failure, never as an empty result —
            // an empty result is what gets reported to the user as "there
            // isn't any", which is the error this whole tool exists to stop.
            return `${n} FAILED: ${e?.message || e}. This is a failure to look, not a finding. Do not report the thing as absent.`;
          }
        };

        const ESCALATION_TOOLS = [
          { name: "query_engine", description: "Workspace data: contracts, content pipeline, tasks, clients, social performance. Pass a `report` such as contracts_summary, pipeline_summary or assigned_tasks.", input_schema: { type: "object" as const, properties: { report: { type: "string" }, table: { type: "string" }, client_id: { type: "number" }, assignee_name: { type: "string" }, date_from: { type: "string" }, date_to: { type: "string" }, limit: { type: "number" } } } },
          { name: "query_meetingbrain", description: "The user's meetings and tasks. Reports: my_tasks, meetings, upcoming_meetings, search_meetings, meeting_details, client_meetings.", input_schema: { type: "object" as const, properties: { report: { type: "string" }, query: { type: "string" }, meeting_id: { type: "string" }, status: { type: "string" }, days: { type: "number" } }, required: ["report"] } },
          { name: "search_thread", description: "Search THIS conversation's earlier messages, however far back. One distinctive word works best.", input_schema: { type: "object" as const, properties: { query: { type: "string" } }, required: ["query"] } },
          { name: "search_memory", description: "Things the user told the assistant in past conversations.", input_schema: { type: "object" as const, properties: { query: { type: "string" } }, required: ["query"] } },
          { name: "lookup_client_context", description: "A client's profile, brand background, contracts and recent meetings.", input_schema: { type: "object" as const, properties: { client_name: { type: "string" } }, required: ["client_name"] } },
        ];

        // One constant for the model that is CALLED, the model that is NAMED in
        // the ledger, and the model that is PRICED. Three literals is how the
        // sibling insert below ended up billing Sonnet 5 at the Sonnet 4.6 rate.
        const ESCALATION_MODEL = "claude-sonnet-5";
        let escIn = 0, escOut = 0, escCacheRead = 0, escCacheWrite = 0;
        const anthropicEsc = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });
        const convo: any[] = [{ role: "user", content: question }];
        let answer = "";
        // Bounded. A voice turn is waiting on this, and an unbounded loop would
        // hold the line open indefinitely; four rounds is enough to fetch two
        // or three sources and reconcile them.
        for (let round = 0; round < 4; round++) {
          const res: any = await anthropicEsc.messages.create({
            model: ESCALATION_MODEL,
            max_tokens: 1600,
            ...anthropicCallParams(ESCALATION_MODEL, 0.2),
            system:
              "You are EngineAI answering a question escalated from a live VOICE conversation. You have tools — USE THEM before answering, and never answer a factual question about this workspace from memory.\n\n" +
              "THE ERROR YOU EXIST TO PREVENT: reporting something as done, absent or nonexistent on the strength of ONE source that did not mention it. A task missing from an open-task list is not evidence it was completed — it may never have been tracked. A search returning nothing means that SEARCH found nothing. When you cannot establish something, say which sources you checked and what you could not confirm.\n\n" +
              "If the question is about a list, a handover or anything the user pasted earlier, call search_thread FIRST — the conversation is often the only place it exists.\n\n" +
              "Write for a person reading it on screen: plain prose or short lines, no markdown headers, no bullet symbols. Lead with the direct answer. Then, on a final line beginning 'SPOKEN: ', give one or two sentences the voice assistant can say aloud — the headline only, no lists.",
            tools: ESCALATION_TOOLS as any,
            messages: convo,
          });
          // Every round is a billable call. Accumulated rather than logged per
          // round so the ledger shows one row per escalation, matching how the
          // rest of the app records a single answer.
          escIn += res.usage?.input_tokens || 0;
          escOut += res.usage?.output_tokens || 0;
          escCacheRead += res.usage?.cache_read_input_tokens || 0;
          escCacheWrite += res.usage?.cache_creation_input_tokens || 0;
          const toolUses = (res.content || []).filter((c: any) => c.type === "tool_use");
          const text = (res.content || []).filter((c: any) => c.type === "text").map((c: any) => c.text).join("");
          if (!toolUses.length) { answer = text; break; }
          convo.push({ role: "assistant", content: res.content });
          const results = [];
          for (const tu of toolUses) {
            results.push({ type: "tool_result", tool_use_id: tu.id, content: (await runTool(tu.name, tu.input || {})).slice(0, 20000) });
          }
          convo.push({ role: "user", content: results });
          answer = text || answer;
        }

        // Logged before the early return below. ask_engine runs up to four
        // Sonnet 5 calls with tool results of up to 20,000 characters each, and
        // logged NOTHING — the most expensive tool on the voice surface was the
        // only one absent from the ledger. A failed escalation costs the same as
        // a successful one, so a row is written even when no answer came back.
        if (escIn || escOut) {
          const { error: escUsageErr } = await intelligenceDb.from("ai_usage").insert({
            id_workspace: workspaceId,
            user_usage: userId,
            name_model: ESCALATION_MODEL,
            type_source: "engineai-voice",
            units_input: escIn,
            units_output: escOut,
            units_cache_read: escCacheRead,
            units_cache_write: escCacheWrite,
            units_cost_tenths: calculateCostTenths(ESCALATION_MODEL, escIn, escOut, escCacheRead, escCacheWrite),
            id_conversation: conversationId,
          });
          if (escUsageErr) console.error("[Voice] ask_engine usage log failed:", escUsageErr.message);
        }

        if (!answer.trim()) {
          output = "EngineAI could not complete that in time. Tell the user you could not get it, and offer to try again — do not answer from what you already have.";
          break;
        }
        // The written answer goes into the THREAD, where a cross-referenced
        // list is usable, and only the SPOKEN line is read aloud. Speak the
        // conclusion, render the evidence.
        const spokenAt = answer.lastIndexOf("SPOKEN:");
        const written = (spokenAt >= 0 ? answer.slice(0, spokenAt) : answer).trim();
        const spoken = spokenAt >= 0 ? answer.slice(spokenAt + 7).trim() : "";
        try {
          await intelligenceDb.from("ai_messages").insert({
            id_conversation: conversationId,
            role_message: "assistant",
            document_message: written,
            name_model: "claude-sonnet-5",
          });
        } catch (e: any) {
          console.error("[Voice] ask_engine could not write to the thread:", e?.message || e);
        }
        output =
          `EngineAI has answered and the full detail is now written in the thread. Say ONLY the headline aloud, in one or two sentences, then tell them the detail is in the thread. Do NOT read the whole answer out.\n\n` +
          `HEADLINE TO SAY: ${spoken || written.slice(0, 300)}\n\n` +
          `(The full written answer, already in the thread — do not read this aloud:)\n${written.slice(0, 4000)}`;
        break;
      }
      case "consult_analyst": {
        const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });
        const msg = await anthropic.messages.create({
          model: "claude-sonnet-5",
          max_tokens: 1200,
          ...anthropicCallParams("claude-sonnet-5", 0.3),
          // GROUNDING. This model has NO TOOLS — it cannot look anything up.
          // Without the constraint below it answered from priors, and its reply
          // came back as a TOOL RESULT, which the voice prompt tells the model
          // to relay and which the model treats as retrieved fact by
          // convention. That laundered an invented figure into a spoken answer
          // with the same confidence as one from Xero. Every other tool in this
          // codebase passes through a formatter carrying exactly this rule;
          // this one returned raw model output.
          system:
            "You are EngineAI's senior analyst. You receive questions escalated from a live voice conversation. " +
            "Reply with a tight, well-reasoned analysis the voice assistant can relay aloud: plain prose, no markdown, " +
            "no headers, no bullet symbols. Lead with the answer, then the two or three considerations that matter most. " +
            "Under 150 words unless the question truly demands more.\n\n" +
            "CRITICAL — you have NO access to any data source. You cannot query the database, the finance system, the " +
            "resourcing base or anyone's calendar. Reason ONLY from what is given to you in this message. Never state a " +
            "figure, date, name or status that is not present in the text you were given: no revenue numbers, no CU " +
            "counts, no headcounts, no deadlines. If the answer needs a fact you were not given, say plainly which fact " +
            "is missing and where it would come from, and answer around it. A named gap is useful; a plausible " +
            "invention is worse than silence, because it will be spoken aloud as though it were looked up.",
          messages: [
            {
              role: "user",
              content: `${args.question}${args.context ? `\n\nRelevant data from the conversation:\n${args.context}` : ""}`,
            },
          ],
        });
        // Labelled as REASONING, not data. The voice model cannot otherwise
        // distinguish this from a tool that actually retrieved something, and
        // it is the only tool on the surface whose output is generated rather
        // than fetched.
        output =
          "ANALYST REASONING — this is considered opinion from a reasoning model with NO data access, not a lookup. " +
          "Relay it as analysis and reasoning. Do NOT present any figure in it as a retrieved fact, and if it names a " +
          "missing input, say so to the user rather than glossing over it.\n\n" +
          msg.content
            .filter((b): b is Anthropic.TextBlock => b.type === "text")
            .map((b) => b.text)
            .join("\n");
        // Log analyst usage for cost tracking
        await intelligenceDb.from("ai_usage").insert({
          id_workspace: workspaceId,
          user_usage: userId,
          name_model: "claude-sonnet-5",
          type_source: "engineai-voice",
          units_input: msg.usage?.input_tokens || 0,
          units_output: msg.usage?.output_tokens || 0,
          // Was inline arithmetic at $3/$15 — the Sonnet 4.6 rate — while
          // model-costs.ts has had claude-sonnet-5 at $2/$10 since the price
          // cliff was cancelled. Billed 50% over, silently, for the same reason
          // the voice minutes billed 37.5% under: a rate copied next to a model
          // id stops matching it, and nothing announces the day it does.
          units_cost_tenths: calculateCostTenths(
            "claude-sonnet-5",
            msg.usage?.input_tokens || 0,
            msg.usage?.output_tokens || 0,
            (msg.usage as any)?.cache_read_input_tokens || 0,
            (msg.usage as any)?.cache_creation_input_tokens || 0
          ),
          id_conversation: conversationId,
        });
        break;
      }
      default:
        return NextResponse.json({ error: `Unknown tool: ${name}` }, { status: 400 });
    }

    return NextResponse.json({ output });
  } catch (err: any) {
    console.error(`[VoiceTools] ${name} failed:`, err.message);
    // Return a model-readable failure so the voice agent can explain gracefully
    return NextResponse.json({
      output: `Tool ${name} failed: ${err.message}. Tell the user you couldn't reach that system right now.`,
    });
  }
}
