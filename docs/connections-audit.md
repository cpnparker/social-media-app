# EngineAI connections audit

**Run:** 2026-07-30. Seven parallel auditors over Engine, MeetingBrain, Finance/Xero, Gmail, Slack, Drive, Notebook and client context; every finding then adversarially refuted by a second agent reading the code independently.

**Result:** 22 findings survived refutation, 9 were refuted and dropped.

Brief: *“check all of the connections work as a user would expect, especially with multi connection queries, with personal privacy intact and client knowledge shared across all users.”*

---

## Findings

### 1. "Continue in EngineAI" publishes an internal 1:1's verbatim transcript to the whole workspace, triggered by a client name spoken once

**HIGH · Privacy leak** — `app/api/ai/meeting/handoff/route.ts:70`

**What happens:** Alice runs an EngineAI Live session for a 1:1 with Bob (performance review, salary, someone's health). She picks no client at setup, so the meeting thread is created private. Mid-call one of them says "we still owe UBS the campaign edit" — a toast says "Now tracking UBS" and nothing else. At the end Alice clicks the primary button, "Continue in EngineAI (linked to client)", whose helper text only says it "opens a new chat with the transcript, summary, actions & context". That new chat is created type_visibility "team", and every workspace member can now open it and read the entire word-for-word transcript of the 1:1, including the salary and performance discussion.

**Why:** The handoff route derives team visibility from `meetingSession.id_client`, but that field is set SILENTLY and AUTOMATICALLY by the live transcript matcher with no user confirmation. So any internal meeting in which a registered client's name is spoken once becomes a team-visible conversation containing the full verbatim transcript.

**Fix:** Do not infer publication from an auto-bound id_client. Either (a) create the handoff conversation `type_visibility: "private"` always and let the host share it deliberately (the same reasoning bind-client already applies when it refuses to promote), or (b) mirror the meeting/end approval gate — require an explicit, labelled confirmation in the review screen ("this will be readable by everyone in the workspace") and record that the client bind was user-confirmed rather than transcript-inferred. Note that meeting/end/route.ts:150-158 already got this right for the digest path (five conditions incl. userMsgCount === 0); handoff is strictly more dangerous because it is the only path that writes the transcript.

---

### 2. A client-anchored thread silently forces EVERY query_engine report to that one client

**HIGH · Over-restriction (client knowledge withheld)** — `lib/ai/providers.ts:6123`

**What happens:** In a Galderma-anchored thread a user asks "which contracts are up for renewal next month?" or "how many CUs did we complete across all clients in June?". They get Galderma-only rows presented as the workspace-wide answer, with no hint a filter was applied — cross-client knowledge is invisible and the totals shown are wrong.

**Why:** When the conversation row has id_client set (a thread opened from a client page / a design or voice session with a client selected), the executor ORs the model's client_id argument with config.selectedClientId. Omitting client_id — the only way the model can ask for a workspace-wide report — is silently reinterpreted as "scope to the anchored client". There is no escape hatch (null/undefined both fall through to the anchor), and neither the tool result nor formatToolResult mentions that a client filter was applied. The system prompt tells the model the opposite: "Add client_id to scope to one client" (lib/ai/system-prompts.ts:935) and "Use this in ALL query_engine calls **when the question is about this client**" (lib/ai/system-prompts.ts:1053) — i.e. the model is told omission means all clients.

**Fix:** Distinguish "argument absent" from "argument null": only fall back to config.selectedClientId when the model omits client_id AND the question is client-scoped, or better, give the tool an explicit scope: "client" | "workspace" argument. At minimum, when the anchor is applied without the model asking, prepend a line to formatToolResult: "NOTE: this report was scoped to <client name> because the conversation is anchored to them — it is NOT a workspace-wide figure."

---

### 3. Whether a meeting counts as shared "client knowledge" depends entirely on app_clients.link_website, with a 2-entry hardcoded rescue list

**HIGH · Over-restriction (client knowledge withheld)** — `lib/ai/providers.ts:3422`

**What happens:** For a real client whose record has no website filled in, a colleague who wasn't in the room asks in a team thread about their last meeting and is told "that meeting has no registered client attendee, so it counts as a PERSONAL or internal meeting… switch to a private chat" — and the client never appears in client_meetings or in get_client_context's meeting section. Client knowledge is withheld from the team because of a blank CRM field, and nothing tells anyone why.

**Why:** The definition of "a client meeting" is built solely from app_clients.link_website, normalised and filtered (normalizeClientDomain drops NULL/short/social/free-mail/own-domain values). link_website is nullable and the customers API writes `link_website: body.website || null` (app/api/customers/route.ts:109). So for any client registered without a website — or with a LinkedIn/Squarespace-style URL — no domain enters the allowlist, and every meeting with them is classified as personal/internal: excluded from client_meetings, and blocked by the team-thread gate in meeting_details. The only remedy is CLIENT_DOMAIN_ALIASES, a hand-maintained list of two entries whose own comment admits the case ("Hiscox Insurance (registered with no website)"). The MeetingBrain mirror that feeds get_client_context has the same dependency and no alias list at all, so it drops even Hiscox.

**Fix:** Give app_clients a first-class multi-valued email-domain field (or a lookup_client_domains table) that both EngineAI and the MeetingBrain sync read, seeded from link_website and editable in the customer admin UI; retire CLIENT_DOMAIN_ALIASES into it. Add an admin-visible warning listing clients with no usable domain, since today those clients silently lose workspace-wide meeting sharing.

---

### 4. query_engine silently DROPS the identity filters the system prompt orders it to use — "my tasks" returns everyone's

**HIGH · Wrong data** — `lib/ai/providers.ts:2380`

**What happens:** User asks "what have I got on across the Engine and MeetingBrain?". MeetingBrain returns their real action items; the Engine returns the 100 most recent open tasks for the WHOLE workspace, and the reply lists colleagues' work as the user's. Same failure for "which clients do I manage?" (user_account_manager filter is dropped → every contract comes back).

**Why:** The system prompt tells the model to scope "my work" by numeric user id (id_user_assignee, user_account_manager, id_user_content_lead). None of those columns are in ALLOWED_COLUMNS, and queryEngine skips a filter on an unlisted column with a bare `continue` — no error, no warning. The query then runs UNFILTERED (workspace-scoped, limit 100) and the model presents the result as the user's own work. This is exactly the Engine half of the cross-source question "what's on my plate?" — the MeetingBrain half is correctly scoped by session email, so the two halves of one answer describe two different populations.

**Fix:** Two changes: (1) add id_user_assignee / id_user_completed to app_tasks_content and app_tasks_social, user_account_manager to app_contracts, id_user_content_lead / id_user_commissioned to app_content in ALLOWED_COLUMNS, so the prompt's instruction is actually executable; (2) stop failing silently at line 2380 — collect the dropped filter names and return them as a `warning` through formatToolResult ("the filter on id_user_assignee was ignored — this result is NOT scoped to one person"), the same honesty pattern already used for truncation.

---

### 5. Engine assignee matching is a name SUBSTRING while every other connection joins on email

**HIGH · Wrong data** — `lib/ai/providers.ts:2035`

**What happens:** "What tasks have I got?" in a workspace with two people sharing a first name returns a merged list: the user's real MeetingBrain items plus a second person's Engine tasks, presented as one plate of work. Conversely, a user whose Engine record uses a different form of their name ("Cath" vs "Catherine") gets "you have no Engine tasks" while tasks are open against them.

**Why:** reportAssignedTasks — the report the prompt designates as THE route for Engine tasks — accepts only assignee_name and matches it with `ilike %name%`. The prompt then instructs "Use first name only… it does partial matching". MeetingBrain (my_tasks), Slack and Gmail all key off config.userEmail. So in a combined "Engine + MeetingBrain tasks" answer, one half is an exact identity and the other is a name fragment. With two "Mike Parsons" in production, or "Chris" matching both "Chris Parker" and "Christine …", the Engine half is another person's workload. There is no assignee_id parameter anywhere in the query_engine schema (only assignee_name, line 1404-1406).

**Fix:** Add an `assignee_id` parameter to the assigned_tasks report and resolve it server-side from the session (findUserIdByEmail in lib/user-lookup.ts already does the case-correct email→id_user lookup), filtering on id_user_assignee. Keep assignee_name only as a colleague lookup, and when it matches more than one distinct name_user_assignee value, return the distinct names as a disambiguation notice instead of silently unioning them.

---

### 6. client_meetings ignores the `days` argument — the shared client-history report is hard-wired to 90 days

**HIGH · Wrong data** — `lib/ai/providers.ts:3918`

**What happens:** "What's the commercial position with UBS and when did we last meet them?" — the Engine half is right, and the meeting half says "no client meetings on record" or "nothing since April" for a client last met five months ago. The user reads that as the relationship having gone quiet.

**Why:** The query_meetingbrain schema advertises `days` as the lookback window, and client_meetings is the ONLY workspace-shared meeting report (the bridge for "what did we last discuss with X"). But the client_meetings branch computes `since` from a hard-coded 90 and never reads options.days. A model that correctly passes days: 365 for "have we met them this year?" gets a 90-day answer and no indication the window was overridden. The synced fallback (3950-3957) applies no date filter at all, so the same call returns a different window depending on whether the RPC is deployed.

**Fix:** Use `const d = options.days || 90;` in client_meetings as the other branches do, and pass the resolved window back in the result (`hint: "covers the last N days"`) so the model can qualify a negative answer instead of stating an absence it never checked for.

---

### 7. flag_access_enginegpt — the front-door gate for the whole assistant — is enforced only in the browser

**HIGH · Privacy leak** — `app/api/ai/conversations/[id]/messages/route.ts:537`

**What happens:** An admin opens Settings → Users and unticks GPT for an off-boarded contractor (or hits the 'restrict access' button at app/api/admin/restrict-access/route.ts:55, which zeroes flag_access_enginegpt for everyone). The web UI dutifully bounces them out. Their session cookie still works: a direct POST to /api/ai/conversations then /api/ai/conversations/{id}/messages runs a full assistant turn with query_engine, lookup_client_context, query_meetingbrain, query_slack, query_drive_docs and search_memory all registered. Revoking EngineAI access does not actually revoke it.

**Why:** Every per-user gate except flag_access_enginegpt is enforced in an API route. flag_access_enginegpt is checked ONLY in two client components. The chat API's own gate at line 537 is `assertServiceAllowed("engine", "enginegpt")`, which lib/admin/service-control.ts:145 shows is a global kill-switch + spend cap, not a per-user read. The only other check is `checkConversationAccess` (line 579), which lib/ai/access.ts:22-34 resolves purely from ownership / type_visibility='team' + workspace_members / ai_shares — it never touches users_access. A full grep for `enginegpt`/`accessEngineGpt` across app/ and lib/ returns no server-side per-user enforcement, and middleware.ts treats every `/api/` path as passthrough (middleware.ts:19).

**Fix:** Add a server-side per-user check in the chat entrypoints, mirroring the finance/gmail read at messages/route.ts:1139-1146: select flag_access_enginegpt for (conversation.id_workspace, userId), require `=== 1`, 403 otherwise. Apply it in POST /api/ai/conversations (route.ts:224) and POST /api/ai/conversations/[id]/messages, and ideally fold it into checkConversationAccess so the GET/voice/design/fact-check routes inherit it.

---

### 8. get_client_context never returns contracts — it filters app_contracts on a column that does not exist, and discards the error

**HIGH · Broken connection** — `lib/ai/providers.ts:1583`

**What happens:** Ask "brief me on Hiscox before my call" and the client card comes back with brand context and recent meetings but NO commercial position — no CU balance, no contract end date, no utilisation. The assistant reads that as the client having no active contracts and says so, or just silently omits the commercial half of the briefing. This is the exact "client knowledge shared across all users" surface the owner asked about, and it is dead for every client.

**Why:** lookupClientContext's "Active Contracts" section selects and filters `type_status`, but app_contracts has no such column — it has `flag_active`. PostgREST returns 42703/400, the `{ error }` is not destructured, so `contracts` is null and the whole contracts block is skipped for EVERY client, every time. Nothing in the tool result says the lookup failed.

**Fix:** Filter on `.eq("flag_active", 1)` and drop type_status from the select. Destructure `error` on all four queries and surface it (e.g. push a line "Contract lookup failed — do not tell the user this client has no contracts") instead of silently omitting the section. Raise `.limit(5)` or label the header "first 5 of N" so "## Active Contracts (5)" cannot read as the total. Consider typing the shared client with <Database> so bogus columns fail at build.

---

### 9. Xero unpaid_invoices: the 6000-char formatter cut severs the summary block, so the model reports a total owed it computed from a partial list

**HIGH · Wrong data** — `lib/ai/providers.ts:4551`

**What happens:** "How much is outstanding?" — the assistant sees maybe 33 of 60 invoices, no total_due, no count, and the tool text ordering it to use exact figures. It adds up the invoices it can see and states a total that is materially lower than the real receivables, with no hedge. Aged-receivables follow-ups then chase the wrong clients.

**Why:** queryXero returns the honest totals in a `summary` object placed AFTER the `invoices` array. formatXeroResult stringifies the whole payload and hard-cuts it at 6000 chars, which with ~180 chars per invoice row means the summary (count, total_due, overdue) is severed at roughly 33+ unpaid invoices — and the JSON is cut mid-object. `result.count` is never printed either, so nothing tells the model the list is partial.

**Fix:** In formatXeroResult, render summary/count FIRST (outside the truncated blob), then the rows, and append an explicit "⚠ showing N of M invoices — use summary.total_due, do not add these up" whenever rows were dropped by either the 60-row slice or the char budget.

---

### 10. Drive documents are silently truncated at 8000 characters — the model summarises a third of a brief as if it read the whole thing

**HIGH · Wrong data** — `lib/gdrive/docs.ts:108`

**What happens:** Ask "what does the Galderma brief say about budget?" on a 10-page brief where budget is on page 6 — the assistant answers "the brief doesn't cover budget", confidently and wrongly. Same for "summarise the plan": the summary silently covers only the opening third.

**Why:** readFileText caps extracted text at 8000 chars (~1,300 words) with no marker and no flag on the returned object, for Google Docs, Slides, PDFs and Word files. The tool's own description tells the model to "Ground answers in the ACTUAL document content", and it has no way to know the content stopped early.

**Fix:** Append a literal `\n\n… [TRUNCATED — showing the first 8000 of N characters]` when the slice bites, and return a `truncated: true` flag that formatDriveDocsResult turns into an instruction ("do not conclude the document omits something you did not see; ask for a narrower section"). Raise MAX_CHARS while you are there — the transcript path already allows 100k.

---

### 11. MeetingBrain + client-document text is injected into the SYSTEM PROMPT unfenced, bypassing fenceUntrusted entirely

**HIGH · Other** — `lib/ai/system-prompts.ts:455`

**What happens:** A sentence planted in a meeting (any external attendee can say it, and it lands in the summary), or in a PDF/DOCX/PPTX a client uploads as a brand asset, becomes standing instruction text at the top of every future conversation scoped to that client. The user asks an ordinary question and gets an answer shaped by an outsider's words with no indication anything is wrong — and unlike the tool path, the model was never told to distrust it.

**Why:** The tool-result path for third-party text is carefully fenced (fenceUntrusted, providers.ts:235), but the SAME third-party text also reaches the model through the system prompt, where it is concatenated raw with no fence, no nonce, no "this is DATA not instructions" wrapper, and no taint flag. The system prompt is the highest-trust position in the request — text there is indistinguishable from operator instructions, and it arrives on EVERY turn of a client-scoped or MeetingBrain-enabled conversation before the user has typed anything.

**Fix:** Run both blocks through fenceUntrusted before appending (source: "a cached MeetingBrain snapshot — titles and summaries authored by meeting participants" / "summaries of client-supplied asset files"), and set config.sawThirdPartyContent when either block is non-empty so the turn is treated as soft-tainted like the equivalent tool call is.

---

### 12. Design/Studio toolset exists only on the Claude chain, and the automatic Claude→Grok fallback keeps designMode on

**MEDIUM · Broken connection** — `lib/ai/providers.ts:5133`

**What happens:** In a Design/Studio session, after a transient Claude hiccup the user sees the banner "Claude unavailable — using Grok" and then asks "add a shot for the opening beat" / "regenerate shot 3" / "find a stock clip". Nothing happens in the Studio — no shot is created, no video, no Artlist result — and the model answers in prose as if it had. If an image does get generated on that turn it is never written to ai_design_assets and never linked to the shot, so it disappears from the session.

**Why:** VIDEO_GEN_TOOL, ARTLIST_SEARCH/LICENSE, the four DESIGN_*_SHOT tools and the saved-prompt library are registered and executed ONLY inside streamAnthropic. `config.designMode` is referenced nowhere in streamXAI / streamGemini / streamOpenAI registration. But createStreamingResponse falls back from Anthropic to Grok on ANY Anthropic error, passing the SAME config with designMode still true — so a Studio turn silently lands on a chain with zero design tools. Claude also force-enables generate_image in design mode (5299) while the xAI chain only registers it when the user's image toggle is on, and the xAI generate_image executor has none of the design-asset persistence or shot linking.

**Fix:** Either (a) make the fallback design-aware — refuse to fall back to Grok when config.designMode is true and surface "Studio needs Claude, try again" instead of a silent tool-less turn; or (b) port the design tool block (OpenAI-format defs already exist for video) into the three OpenAI-shaped chains. (a) is the smaller, safer change and matches the existing "pin to Anthropic for v1" decision at app/api/ai/conversations/route.ts:277-281.

---

### 13. client_meetings — the only client-meeting route in a team thread — is capped at 90 days / 100 rows with no client filter and silently ignores `days`

**MEDIUM · Over-restriction (client knowledge withheld)** — `lib/ai/providers.ts:3918`

**What happens:** In a team thread, "what did we agree with Hiscox in the April QBR?" or "prep me on Galderma" returns "I have no record of meetings with them" whenever the client was last met more than 90 days ago — or, at agency volume (>100 client meetings in 90 days), whenever their meeting falls outside the 100 most recent workspace-wide. This is the same absence-of-evidence failure already fixed for contracts, on the meetings side.

**Why:** In a team thread search_meetings, meetings and upcoming_meetings are all blocked (only client_meetings and meeting_details are exempt, providers.ts:3543-3546), so client_meetings is the only keyword-free path to client meeting knowledge. It hardcodes a 90-day window and a 100-row workspace-wide cap, accepts no client_id/client_name filter, and ignores options.days even though the tool schema advertises days as "Lookback window in days. Default: 90 for meetings" (providers.ts:3334). Nothing detects hitting the cap: formatMeetingBrainResult only adds a truncation note when rows.length > MAX_TOOL_RESULT_ROWS, and MAX_TOOL_RESULT_ROWS is exactly 100 (providers.ts:186, :290), so a result that hit p_limit:100 is indistinguishable from a complete one.

**Fix:** Honour options.days for client_meetings; add a client_name/client_id filter (resolve to the client's domain(s) and pass a one-element p_client_domains, or filter server-side) so a briefing does not depend on the client appearing in the last 100 workspace meetings; and when returned rows === p_limit, surface the same "INCOMPLETE RESULT" warning the Engine reports now emit so the model never says "no meetings" from a truncated page.

---

### 14. A swallowed app_clients error unregisters query_engine AND lookup_client_context entirely, in all four chains

**MEDIUM · Over-restriction (client knowledge withheld)** — `app/api/ai/conversations/[id]/messages/route.ts:903`

**What happens:** After a blip on the clients query, a user asks "what contracts do we have with Amrize?" and is told the assistant does not have access to client data / gets a snapshot recital, with no error and no retry — while the same question works a minute later.

**Why:** workspaceClientIds is fetched with the error discarded (`const { data } = await ...`), so any transient failure yields []. Tool registration in all four provider chains is gated on `config.workspaceClientIds?.length`, so an empty array means the Content Engine tool and the client-context tool are never offered to the model at all — the failure is invisible to the model, which then answers from the thin cached snapshot or says it cannot access client data. The gate is also redundant as scoping: the array is every client row in the workspace (no per-user narrowing anywhere), so its only real effect is this all-or-nothing failure mode.

**Fix:** Bind and log the error, and gate tool registration on workspaceId (which is what queryEngine/lookupClientContext actually need) rather than on a non-empty client-id array; pass workspaceClientIds through as an optional filter that is simply absent when the fetch failed, so a blip degrades a filter rather than deleting the whole Content Engine connection.

---

### 15. Reading Gmail cancels the sibling tool calls already issued in the SAME batch, so a multi-source answer silently loses its other sources

**MEDIUM · Broken connection** — `lib/ai/providers.ts:5553`

**What happens:** In a private chat, "what did Galderma email about the renewal and where are we on the contract?" — the model fans out [query_gmail, lookup_client_context, query_engine] in one round (which the prompt explicitly encourages). Gmail runs, the other two are refused, and the user gets an email-only answer with no contract position and no mention that the Engine was never checked. The same question asked twice can give different coverage.

**Why:** The HARD Gmail taint is applied inside the per-tool-call loop: query_gmail sets config.sawUntrustedContent while the loop is still iterating the batch, and every remaining tool call in that SAME assistant message is refused. Those calls were emitted by the model BEFORE any email text existed in context, so they cannot have been influenced by an injected instruction — the taint's actual purpose is served by `suppressTools` on the next round (line 5399). The result is that whether a multi-source question gets its Engine/MeetingBrain data depends purely on where Gmail happened to land in the batch ordering, and the refusal text does not require the model to tell the user anything was skipped.

**Fix:** Snapshot the flag before the batch (`const taintedBeforeBatch = config.sawUntrustedContent === true;`) and gate the refusal on that snapshot rather than the live value, so a batch decided pre-email completes; suppression from the following round is unchanged and still enforced by tool_choice "none". If the current behaviour is kept deliberately, add the disclosure requirement to the refusal text ("tell the user which lookups you skipped and why") so a partial answer is never presented as complete.

---

### 16. query_xero has no audience gate — finance data lands in team threads that non-finance users read

**MEDIUM · Privacy leak** — `lib/ai/providers.ts:5348`

**What happens:** A finance-flagged user asks 'what's our P&L this quarter?' in a Team thread (or a private thread they later share). Full profit & loss lines, aged receivables and the revenue-forecast workbook are written into the transcript. Every workspace member — including everyone whose Finance tick is off — opens that thread and reads the figures. The per-user finance gate silently becomes 'whoever asks first publishes it to everyone'.

**Why:** Every other personal-scope tool is registered with an audience condition. query_xero is registered on `config.workspaceId && config.financeAccess` alone — the caller's own flag — with no `conversationVisibility` term, in all four chains (5348, 6498, 7247, 7840). Compare GMAIL_TOOL two lines above, which requires `config.conversationVisibility === "private"` (5339). The system prompt names no finance rule either: lib/ai/system-prompts.ts:462-468 and 902-903 block only the personal MeetingBrain reports and narrow search_memory in team threads; 'Xero'/'finance' appear nowhere in the audience section. The output is then persisted to ai_messages and readable by any workspace member, because lib/ai/access.ts:22-34 grants 'collaborate' on any team thread to any member regardless of flags.

**Fix:** Either (a) add `config.conversationVisibility === "private"` to the four query_xero registrations, matching the Gmail treatment, or (b) if finance is deliberately a team surface, make that explicit: gate on the audience's *weakest* reader rather than the caller — e.g. block query_xero in team threads and, for shared threads, require every ai_shares recipient to have flag_access_finance = 1. Whichever is chosen, state it in the tool comment the way the Gmail four-gate comment does, so the next reader doesn't have to infer it.

---

### 17. Raw table-query mode caps at 100 rows with no exact count and reports the page as the whole result

**MEDIUM · Wrong data** — `lib/ai/providers.ts:2409`

**What happens:** "List our contracts" or "how many clients do we have?" via table mode returns exactly 100 and the assistant states it as the full set — the codebase's own comment records that app_contracts holds 231 rows. Worse, an absence check ("is there anything for Hiscox in the content pipeline?") answered from a silently-truncated page produces the same false negative the contracts report was fixed for.

**Why:** queryEngine's table mode clamps any requested limit to a maximum of 100, selects without `{ count: "exact" }`, and returns `count: data?.length`. formatToolResult then prints "Query returned 100 rows." with no truncation line, because `truncated`/`matched_total` are never set on this path. Every pre-built report was fixed to use runCapped + count:exact; the table mode was not.

**Fix:** Select with `{ count: "exact" }`, return `matched_total` and `truncated: count > rows.length`, and set the same warning string the reports use. formatToolResult already renders it. Also reconsider the hard 100 ceiling now that the reports allow 25k rows.

---

### 18. lookup_client_context returns external meeting summaries and client-document text unfenced and sets no taint flag, in all four chains

**MEDIUM · Inconsistency** — `lib/ai/providers.ts:6156`

**What happens:** Asking "what do we know about <client>?" pulls in text an outsider wrote, presented to the model as trusted app output. Because no taint flag is set, background memory extraction also runs over that turn, so an attacker-chosen "fact" can be persisted as a memory and reappear in unrelated future conversations for that user.

**Why:** lookupClientContext concatenates ai_client_context.document_context (summaries of client-supplied files) and ai_client_meetings rows (meeting_summary, key_topics, next_steps, attendees_external — derived from transcripts of meetings with external client attendees) into a plain string, and every chain pushes that string as the tool result with no fenceUntrusted call and without setting sawThirdPartyContent. The same class of content routed through query_meetingbrain or query_drive_docs gets both.

**Fix:** Wrap the meeting/document portions of lookupClientContext's return in fenceUntrusted (keep the client name, id and contract figures outside the fence — those are first-party), and set config.sawThirdPartyContent = true in all four executor branches when the result contains a meetings or brand-context section.

---

### 19. Model-authored HTML is rendered with dangerouslySetInnerHTML and no sanitizer in the content editor

**MEDIUM · Other** — `app/(app)/content/[id]/page.tsx:809`

**What happens:** If any of that upstream text steers the model into emitting a tag with an event handler or a script, it executes in the author's authenticated session on app.thecontentengine.com rather than being displayed. Nothing in the UI would look different beforehand.

**Why:** The generate-content endpoint explicitly instructs the model to emit raw HTML, and the editor renders that string straight into the DOM with no DOMPurify pass. Every other innerHTML sink in the app sanitizes (MessageBubble.tsx:217, DesignChat.tsx), which makes this one a gap rather than a deliberate choice. The model's inputs here include free text from Content Engine records (brief, working title, customer name) and an operator-pasted example passage — fields that in practice are pasted in from client emails and documents.

**Fix:** Wrap aiPreview in DOMPurify.sanitize() at the render site, with the same ADD_ATTR allowlist used in MessageBubble.

---

### 20. Per-tool call budget, identical-call dedup and the Gmail taint block are missing from the GPT and Gemini chains

**LOW · Inconsistency** — `lib/ai/providers.ts:8002`

**What happens:** On GPT-4o, Gemini 3 Flash or DeepSeek, a multi-connection question ("pull everything we have on Hiscox") that hits an empty result can re-issue the identical query_engine / query_meetingbrain call every round for all 8 rounds, producing the wall-of-repeated-text spiral the guard was written to stop — the same query works cleanly on Claude and Grok. Separately, the Gmail taint stop is absent on these two chains as defence in depth; it is unreachable today only because query_gmail is registration-gated to `/^claude/`, so the moment that processor gate widens, these chains have no post-mailbox tool block at all.

**Why:** The no-progress guard (executedToolSigs + toolCallCounts + READ_ONLY_TOOL_BUDGET + `if (!executedAnyTool) break`) and the hard-taint block `if (config.sawUntrustedContent) { … continue; }` are implemented in streamAnthropic (5379-5391, 5553, 6337) and streamXAIChatCompletions (6524-6536, 6691, 7052) and in neither streamGemini nor streamOpenAI. Both of those executor loops go straight from `for (const tc of toolCallsArray)` into `if (tc.function.name === "generate_image")` with no guard of any kind. streamOpenAI is also the DeepSeek chain (5150-5157).

**Fix:** Lift the guard block (taint check + toolSig dedup + budgetFor + executedAnyTool break) into a shared helper and call it at the top of all four executor loops, so a tool added later inherits it everywhere.

---

### 21. Google Drive is registered on every chain but named nowhere in the system prompt, so it never joins a multi-source answer

**LOW · Broken connection** — `lib/ai/system-prompts.ts:883`

**What happens:** "Tell me everything we know about client X before tomorrow's call" returns meetings, contracts, pipeline, notebook and finance — but never the brief, plan or deck sitting in the shared Drive folder, even though the assistant could have read it. The user has to know to say "check the Drive docs" by name.

**Why:** query_drive_docs is registered and executed on all four chains for every user with a workspaceId, but the word "drive" does not appear anywhere in lib/ai/system-prompts.ts. Every other connection gets an explicit when-to-use section, and the "Client & Meeting Briefings" playbook — the one place that tells the model to fan out across connections in one pass — lists lookup_client_context, query_meetingbrain, query_engine x2, search_notebook, search_memory, query_xero and web_search, but not Drive.

**Fix:** Add a `query_drive_docs` bullet to the briefing gather list at system-prompts.ts:883-890 ("the brief, plan or deck the team shared — often the only place the actual scope is written down") and a short when-to-use line alongside the other connections around line 989.

---

### 22. Voice session mints its audience from raw type_visibility, diverging from the audience model every other surface uses

**LOW · Inconsistency** — `app/api/ai/voice/session/route.ts:79`

**What happens:** In a private thread that has been shared with colleagues (or in someone else's thread a collaborator is posting in), the voice assistant is never told it is in a multi-reader room. Asked "what's on my plate today", it confidently attempts a personal MeetingBrain lookup, gets a server-side block, and has to backtrack mid-sentence into "personal tasks need a private chat" — and it never volunteers up front that the thread has other readers. Enforcement still holds (no data escapes), but the assistant's account of itself is wrong.

**Why:** voice/session computes `isTeamThread` as `conversation.type_visibility === "team"`, ignoring share count and non-owner callers — the exact bug that was found and fixed in the sibling voice/tools route, which carries a comment about it.

**Fix:** Replace line 79 with the same three-part computation used at voice/tools/route.ts:85-95 (fetch the ai_shares count and include `conversation.user_created !== userId`). Better still, extract that computation into one exported helper — e.g. `resolveThreadAudience(conversationId, userId, conversation)` in lib/ai/access.ts — and call it from messages/route.ts:781, voice/tools:85, voice/session:79 and scheduled/runner.ts:168, so a fourth copy cannot drift again.

---

## Refuted and dropped

Raised by an auditor, then disproved by an independent reader. Recorded so they are not re-raised:

- Contracts truncation warning tells the model to call a tool name that does not exist
- Voice chain is missing Notebook, Google Drive and Finance/Xero entirely
- Sharing a thread does not re-check what is already in it — mailbox extracts written under a solo audience become readable by the recipient
- client_meetings rows carry no client identifier and lose their attendees after 14 days — the Engine↔MeetingBrain client join is guesswork
- The share gate defaults to ALLOW on an absent users_access row — the only fail-open gate in the codebase
- Registration is the only gate — the query_gmail and query_xero executors never re-check the flag
- Four different comparison styles across the five flags — the owner has to remember which is which
- Web search results are never fenced and never set a taint flag, in all four provider chains
- The HARD taint block is written into the Gemini and GPT chains but never read there — the flag is set and then ignored

---

## Verified correct

Checked and found sound — this is the coverage half of the audit.

### tool-parity

- Full tool x chain matrix for the eight read connections: query_engine, lookup_client_context, query_meetingbrain, query_slack, query_gmail, query_xero, query_drive_docs, search_notebook (plus search_memory) are ALL registered AND executed on all four chat chains. Verified mechanically by extracting `tools.push(X)` and `tool.name ===` / `tc.function.name ===` within each function range: streamAnthropic 5261-6402, streamXAIChatCompletions 6421-7109, streamGemini 7180-7771, streamOpenAI 7772-8365. No read connection is missing from any chain.
- The known Gemini footgun did NOT recur: every executor branch in streamGemini pushes to geminiMessages, not openaiMessages (lib/ai/providers.ts:7514-7729). All eight read tools are present and correctly targeted.
- The default/auto path is safe. lib/ai/models.ts:33 DEFAULT_MODEL = "auto"; lib/ai/auto-router.ts:129 defaults to grok-4-1-fast, which routes to streamXAIChatCompletions — the chain with the most complete guard set (dedup, per-tool budget, taint block) and every read connection wired.
- Gmail's Claude-only registration is deliberate and correctly plumbed: gated on `/^claude/.test(apiModel)` (the CHAIN's model, not config.model, so the Anthropic→Grok fallback cannot leak it) at providers.ts:5344/6494/7243/7836, and the messages route re-routes auto-selected mail-intent turns to claude-sonnet-5 so the connection does not silently vanish (app/api/ai/conversations/[id]/messages/route.ts:1181-1204).
- DeepSeek is not a fifth unwired chain — it reuses streamOpenAI with a client override (providers.ts:5140-5160) and inherits that chain's full tool set. streamPerplexity (8366) registers no tools, but no perplexity model is exposed in lib/ai/models.ts, so it is unreachable from the model picker. streamXAIResponses (7110) is dead code — streamXAI always delegates to Chat Completions (6417).
- Argument plumbing is identical across the four chains for every read tool — same 13-arg queryEngine call, same MeetingBrain options bag including workspaceId/meetingId/visibility, same Slack options, same searchNotebook(query, workspaceId, userId, conversationVisibility), same Xero forecast-vs-report split. No chain silently drops a scoping parameter.
- The scheduled-task headless runner passes a complete config (lib/scheduled/runner.ts:194-210): workspaceClientIds, workspaceId, userId, userEmail, financeAccess and a freshly computed runAudience — so Engine, MeetingBrain, Slack, Drive, Notebook and Finance all remain reachable in unattended runs, and it correctly withholds gmailAccess/allowPersonalData.
- Design mode's Claude pinning is enforced at conversation creation (app/api/ai/conversations/route.ts:277-281) and the design rail sends no model override (components/design-mode/ai-rail/AIRailSide.tsx:146-155), so the only route onto a non-Claude chain in a Studio thread is the provider fallback — which is finding #1.
- The voice surface computes its audience with the same multi-reader rule as the text pipeline (app/api/ai/voice/tools/route.ts:85-94: type_visibility === "team" || shareCount > 0 || user_created !== userId) and passes it into query_meetingbrain, query_slack and search_memory.

**Could not verify:**

- Whether the Gemini OpenAI-compatibility endpoint actually honours the `tools` array in this shape at runtime — registration and execution are correct in code, but I could not exercise the live API. Worth one manual smoke test per chain ("how many CUs did we commission this month, and what did we discuss with them last?") since that is the cheapest way to confirm all four chains really fire tools.
- streamGemini's create call (providers.ts:7271-7278) omits `stream_options: { include_usage: true }`, which both streamXAI (6544) and streamOpenAI (7870) pass. If Gemini's compat layer only emits usage when asked, Gemini turns would log zero input/output tokens. That is a cost-accounting question, not a connection one, and I did not verify Gemini's default behaviour.
- lib/scheduled/runner.ts:208 reads the finance flag as `!!financeRes?.data?.flag_access_finance` rather than the `=== 1` convention used in the chat route (messages/route.ts:1145). For a genuine integer column the two agree; they diverge only if the column is ever TEXT, where `!!"0"` is true. I did not confirm the deployed column type for intelligence.users_access.flag_access_finance.
- Whether the voice chain's omission of Notebook/Drive/Xero (finding #4) is a deliberate latency decision. Nothing in lib/ai/voice.ts documents it as intentional, unlike the Gmail processor gate which is commented at every registration site — that asymmetry is why I reported it rather than assuming design intent.

### personal-privacy

- Gmail registration is gated identically in ALL FOUR provider chains — providers.ts:5336-5344 (Claude), 6485-6495 (xAI), 7235-7243 (Gemini), 7828-7836 (OpenAI) — each requiring userEmail && gmailAccess && allowPersonalData && conversationVisibility === "private" && /^claude/.test(apiModel). No chain was missed.
- queryGmail fails closed independently of registration: providers.ts:4121-4126 `if (options.audience !== "solo") { … return { error: "BLOCKED_AUDIENCE", statusCode: "audience_not_solo" } }`, and the identity is appended last in the request body (4139-4145) so no spread can override the mailbox. A mailbox mismatch in the bridge response discards results (4160-4164).
- An OMITTED visibility blocks everywhere I checked. queryMeetingBrain:3546-3548 (`options.visibility !== "private"` with an explicit no-visibility warn), querySlack:4254-4256, searchMemory:4852-4855, searchNotebook (lib/notebook/search.ts:50-53). All four are "is this explicitly private?", never "is this team?".
- search_notebook withholds BOTH other people's entries and the author's own private-sourced ones in a team thread: lib/notebook/search.ts:63-65 restricts to team-visible notebooks, and line 101 passes `soloAudience ? userId : -1` into visibleEntries specifically to suppress the author bypass (lib/notebook/access.ts:91). The stamped floor (flag_private_source) plus the live source-thread lookup (access.ts:93-97) both apply, and an unresolvable source thread is treated as private.
- notebookIndex uses the same audience as the memory query (messages/route.ts:966-970, `isMultiReaderThread ? "team" : "private"`) and builds its topic list from user-written annotations/source titles only, never the clipped text (search.ts:162-172) — so the prompt cannot hint at a private clipping's contents.
- The interactive chat route computes isMultiReaderThread BEFORE any personal read (messages/route.ts:776-786) and applies it consistently to memory injection (802-808), MeetingBrain user_app_context (1048), personalContext (1101), the notebook index, conversationVisibility (1110, 1288) and the mail-intent model override (1197).
- Write path to memories is safe: background extraction is hard-coded `const scope = "private"; const memUserId = userId;` (messages/route.ts:1544-1546), and createMemory forces private for any non-team or unverifiable source conversation (lib/ai/memory-create.ts:81-85), requires admin for team scope (88-105), and honours a caller-supplied forcePrivate floor (53-56).
- Live meeting card path does not persist third-party material: deck/route.ts:264-272 replaces any MeetingBrain-derived card body with `{ mb: true, note: "MeetingBrain-derived — shown live, deliberately not persisted" }`, and all three card routes gate on consent_attested_by === userId (lookup:118, deck:123, cards/route.ts:32), so the Live feed is provably host-only.
- meeting/end promotes a meeting thread to team only under five simultaneous conditions including `userMsgCount === 0` and `shareCount === 0` (end/route.ts:150-158), so a host who asked about their mail inside a meeting thread does not get that history republished.
- coaching_notes (per-person performance feedback about a colleague) is unconditionally dropped from meeting_details regardless of audience — providers.ts:3880 `coaching_notes: undefined` — and internal attendee addresses are redacted for any non-private audience (3841-3850).
- Scheduled runs read the thread's CURRENT audience including share count rather than assuming private (lib/scheduled/runner.ts:164-186), and email delivery targets only `to: task.email_user` (runner.ts:319).
- No cross-user caching or content logging of tool results: the only Maps in providers.ts are per-invocation locals (4348, 5380, 6525), and logAiUsage writes token counts and cost only, never content (lib/ai/usage-logger.ts:18-28).
- Write-guards on other people's threads hold: voice/tools:76-78, voice/transcript:45-48 and fact-check:92-95 all reject `access.permission === "view"`, and PATCH /conversations/[id]:251-254 refuses to let even a workspace admin publish someone else's private thread.

**Could not verify:**

- Notebook entries created with no source conversation are stamped flag_private_source = 1 (lib/notebook/access.ts:112), which makes visibleEntries' "No source thread and not stamped private: an authored-in-place note → return true" branch (access.ts:98-99) unreachable. That would be an over-restriction — a hand-written note in a TEAM notebook invisible to every colleague — but the only writer today (components/ai-writer/MessageBubble.tsx:149 via lib/notebook/client.ts:72) always passes a conversationId, and no UI creates the `note` entry type, so I could not demonstrate a user-visible symptom. It becomes a real bug the moment a compose-in-panel UI ships.
- I did not read the MeetingBrain side of the bridge (/api/engineai/gmail/query and /api/engineai/slack/query live in /Users/chris/meetingbrain, outside this repo). EngineAI's own defences are sound, but the actual mailbox/DM scoping on the far side is unverified beyond the mailbox-mismatch check at providers.ts:4160-4164.
- get_meeting_details returns "the RICHEST sibling row across everyone who recorded the event" (providers.ts:3846-3848). With visibility "private" the attendee list comes back unredacted and the transcript is returned in full (3853, 3841-3850) — including, after client-meetings-workspace-wide.sql, for a client meeting the caller never attended. Whether the deployed RPC restricts which colleague's sibling row a non-attendee can reach depends on SQL I could not inspect from here (per project notes, MeetingBrain RPCs are deployed manually and no Postgres creds exist on this machine).
- app/api/ai/meeting/mb-context/route.ts:105-137 walks a "previous meeting in the same series" chain using search_meetings, which the route's own comment (lines 118-122) notes "full-text matches transcript content and, via the client-domain allowlist, reaches meetings the caller never attended". The title-corroboration filter at 124-130 looks sound, but I could not exercise it against real data to confirm a colleague's unrelated meeting cannot match.

### client-knowledge-sharing

- lookup_client_context / get_client_context is NOT user-restricted: it matches by name across all of app_clients and reads ai_client_context + ai_client_meetings scoped only by workspace and client (lib/ai/providers.ts:1505-1600). Any user gets the same client picture, and it fuzzy-matches misspelled names.
- workspaceClientIds is not per-user anywhere. All three entry points fetch every app_clients row with no role or assignment filter — app/api/ai/conversations/[id]/messages/route.ts:903-908, app/api/ai/voice/tools/route.ts:101, lib/scheduled/runner.ts:119 — so a user assigned to only some clients does not lose commercial client knowledge in chat. (Note the per-user narrowing that DOES exist, lib/permissions getAllowedClientIds, is used only by the app UI at app/api/me/customers/route.ts:32, never by the assistant.)
- Team threads genuinely do allow client knowledge: client_meetings and meeting_details are exempted from the personal-report block (lib/ai/providers.ts:3546) and meeting_details is released when a registered client attendee is present (:3817), with the system prompt telling the model so (lib/ai/system-prompts.ts:465 and :903).
- The soft taint does not suppress client answers. sawThirdPartyContent (set by MeetingBrain/Slack/Drive results, e.g. lib/ai/providers.ts:6245) only skips background memory extraction; summaries still run and the reply itself is unaffected (app/api/ai/conversations/[id]/messages/route.ts:1455-1477). Only Gmail's hard taint stops further tool calls.
- All four provider chains register AND execute the client tools: registration at lib/ai/providers.ts:5316 / 6463 / 7215 / 7808; query_engine executed at :6130 / :6831 / :7524 / :8118; lookup_client_context at :6158 / :6859 / :7552 / :8146; query_meetingbrain at :6241 / :6960 / :7642 / :8236. The Gemini chain correctly appends its tool results to geminiMessages (verified across lines 7400-7725), so the known 3-of-4 footgun is not present here.
- The client-domain allowlist is correctly hardened against forgery in the sharing direction: whole-domain comparison rather than substring, email-field-only inspection with display names ignored, and unparseable attendees failing closed (lib/ai/providers.ts:3441-3470).
- query_engine's workspaceClientIds filter is an all-clients no-op rather than a per-user restriction (lib/ai/providers.ts:2373-2375), and the pre-built reports apply it the same way (:1860, :1956) — so contract, pipeline and CU knowledge is workspace-wide by construction.

**Could not verify:**

- Row caps on the two unpaginated all-client fetches: lib/ai/providers.ts:3422 (`select("link_website")`) and app/api/ai/conversations/[id]/messages/route.ts:904 (`select("id_client")`) have no .range()/.limit(), so both inherit PostgREST's default max-rows (1000 on stock Supabase). I could not check the live client count, so I cannot say whether this workspace is near that ceiling — if it ever is, clients past the cap silently lose both query_engine visibility and client-meeting sharing.
- Whether the deployed meetingbrain.get_client_meetings / search_meetings / get_meeting_details actually accept p_client_domains in production. scripts/fix-get-client-meetings-rpc.sql exists precisely because the 4-arg version was never run, and mbRpcWithClientDomains (lib/ai/providers.ts:3480-3499) silently falls back to attendee-scoped calls. If the SQL is still unapplied, EVERY colleague who did not attend a client meeting loses access to it — a much larger over-restriction than anything above. This needs checking against the live DB (introspect the PostgREST OpenAPI), which I could not do here.
- Whether ai_client_meetings (the mirror behind get_client_context's meeting section and the client_meetings fallback) covers meetings that no synced user attended. I read the domain→client mapping in /Users/chris/meetingbrain/lib/enginegpt-context-sync.ts:594-612 but not the cron's per-user loop, so the mirror's true coverage is unverified.
- get_client_meetings' `AND pm.summary IS NOT NULL` inclusion gate (scripts/fix-get-client-meetings-rpc.sql) drops any client meeting that has a transcript but no generated summary. I could not measure how many real meetings that excludes.

### multi-source-queries

- All six read connectors are registered AND executed in ALL FOUR provider chains — the known 3-of-4 Gemini footgun is not present here. Execution sites: query_engine 6121/6821/7514/8108, query_meetingbrain 6239/6957/7639/8233, query_slack 6253/6972/7654/8248, query_xero 6297/7017/7699/8293, query_drive_docs 6309/7030/7712/8306, search_notebook 6173/6893/7575/8169, lookup_client_context 6156/6856/7549/8143 (all lib/ai/providers.ts).
- READ_ONLY_TOOL_BUDGET is generous enough that a genuine multi-source turn cannot exhaust it on Claude or Grok: query_xero 8, query_engine 8, query_meetingbrain 6, query_drive_docs 6, search_notebook 6 (providers.ts:5387-5390, 6532-6535), against MAX_TOOL_ROUNDS = 8 — a three- or four-source question runs out of ROUNDS long before it runs out of any per-tool budget, and rounds can carry parallel calls.
- Hitting the ceiling does not produce a partial answer dressed as complete: every non-natural exit (round cap, no-progress break, stall) falls through to FORCED_FINAL_NUDGE, which states "If something could not be retrieved, say what you found and what remains unverified" (providers.ts:175-177), wired in at 6344 (Claude), 7061 (Grok), 7736 (Gemini), 8330 (GPT).
- The no-progress guard cannot cut off a legitimate multi-source query: it only fires when a round executed NOTHING — `if (!executedAnyTool) break;` (providers.ts:6337, 7052) — i.e. every call in the round was an exact-argument repeat or over-cap. A fan-out to a new source always counts as progress.
- Router hints are additive, not restrictive: they are appended as "## Required tool calls for this turn … you MUST call these tools before answering" (app/api/ai/conversations/[id]/messages/route.ts:1114-1115) and never tell the model to stop at one source. The client hint explicitly mandates the fan-out — lookup_client_context, then query_meetingbrain client_meetings + query_engine contracts_summary + search_notebook IN THE SAME ROUND (lib/ai/query-router.ts:134), with "Commercial figures alone are not an answer to a question about a client."
- Cross-source personal scoping is on the session email, never a model-supplied name: MeetingBrain (p_user_email, providers.ts:3573/3653/3712), Slack and Gmail all take config.userEmail from the server session, and the prompt forbids passing a person's name to query_meetingbrain (system-prompts.ts:1020). lib/user-lookup.ts handles the case-sensitivity and the ILIKE-underscore hazard correctly.
- The MeetingBrain visibility gate is genuinely fail-closed on an OMITTED visibility (`options.visibility !== "private"`, providers.ts:3546) while correctly exempting the two workspace-shared reports (`const decidesOwnAudience = report === "client_meetings" || report === "meeting_details"`, 3545) — so client knowledge is not over-restricted by the same gate that protects personal meetings.
- loadClientDomains throws rather than returning an empty allowlist on query failure (providers.ts:3426-3431), and client_meetings refuses to run on an empty allowlist (3910-3916) — both correct, since a NULL allowlist would fail OPEN and publish every external meeting.

**Could not verify:**

- Verified but left off the list for space: the Gemini and OpenAI/DeepSeek chains have NO per-tool budget, NO identical-argument dedup and NO no-progress break — the guards exist only at providers.ts:5379-5391 (Claude) and 6524-6536 (Grok); the loops at 7407 and 8002 go straight into execution. Those two chains also SET config.sawUntrustedContent (7691, 8285) but never read it, and `suppressTools`/tool_choice "none" exists only at 5399. Live impact looks bounded because Gmail is registered only when /^claude/.test(apiModel) in all four chains (5335-5346, 6486-6496, 7234-7245, 7827-7838) and the only fallback path is Anthropic→xAI (5124-5133) — but I could not verify whether an admin model override (5093-5101) can land a Gemini/GPT model on a config that has already been tainted.
- Whether app_tasks_content.id_user_assignee etc. are populated in production — I only verified the columns exist in lib/types/supabase.ts:813-814, not that they are reliably filled. If they are sparse, adding them to ALLOWED_COLUMNS is necessary but not sufficient for finding 1.
- How often client_meetings actually hits its 100-row cap — that needs live volume (client meetings per 90 days across the workspace), which I did not query.
- intelligence.ai_client_meetings, which lookupClientContext reads for the client-meeting section (providers.ts:1564), is written only by the sibling repo's cron (/Users/chris/meetingbrain/app/api/cron/sync-context, upsert confirmed in the built chunks). Nothing in this repo writes it — a comment at app/api/ai/meeting/deck/route.ts:191 says exactly that. Freshness of that cross-repo sync (and whether it runs for every user, not just those who have connected MeetingBrain) determines how stale the client briefing's meeting section is, and I could not check it from here.

### gating-consistency

- GATE TABLE — Gmail (query_gmail): read at app/api/ai/conversations/[id]/messages/route.ts:1145-1146 with explicit `=== 1`; absent row → DENIED; DB error → data null → DENIED (fail closed); enforced server-side at registration in all 4 chains; NOT registered when the flag is off, so the model cannot mention or promise it.
- GATE TABLE — Finance (query_xero): read at messages/route.ts:1145 with `=== 1` (and lib/scheduled/runner.ts:122+208 with `!!` for cron runs, using the task OWNER's flag); absent row → DENIED; DB error → DENIED; server-side at registration in all 4 chains; not registered when off. Its only weakness is the missing audience term (finding 2).
- GATE TABLE — EngineAI Live (flag_access_engineai_live): app/api/ai/meeting/session/route.ts:51-62, truthy check; absent row → DENIED; DB error → data null → DENIED; server-side 403 with a helpful message; nothing is registered with a model here, so no leak of the feature's existence beyond the UI toggle.
- GATE TABLE — Engine tasks (flag_access_engine_tasks): /Users/chris/meetingbrain/lib/engine-tasks.ts:88-107, `=== 1`, with an EXPLICIT `if (error) return false` that names 42703 (column not yet added) — the strongest of the five, and the model the others should copy. Not surfaced in EngineAI at all.
- GATE TABLE — EngineAI itself (flag_access_enginegpt): app/(app)/layout.tsx:106 + app/engineai/EngineAIShell.tsx:122 only. Client-side. Absent row → the API never looks, so it is moot. See finding 1.
- Gmail's four-gate registration is present and IDENTICAL in all four provider chains — lib/ai/providers.ts:5335-5347 (Claude), 6485-6496 (xAI), 7234-7245 (Gemini), 7827-7838 (GPT). The documented 3-of-4 footgun did not occur here; I checked the Gemini site pushes into `geminiMessages` (7275) and still carries the gate.
- The Gmail flag read has a deliberate deploy-safe fallback (messages/route.ts:1148-1169): if selecting flag_access_gmail fails because the column does not exist yet, the whole two-column select fails, so finance is re-read on its own rather than being silently revoked. Both re-reads still require `=== 1`.
- query_gmail is additionally gated on `allowPersonalData`, which is set in exactly one place — messages/route.ts:1289 `allowPersonalData: true` — so no cron, scheduled run, voice turn or meeting surface can reach a mailbox. The scheduled runner (lib/scheduled/runner.ts:194-210) passes financeAccess but never gmailAccess or allowPersonalData.
- The Gmail gate keys on the CHAIN's `apiModel`, not `config.model` (providers.ts:5340-5344), so the Anthropic→xAI fallback path cannot carry the mailbox tool onto Grok. Verified in all four chains.
- The MeetingBrain Gmail bridge independently re-gates: dedicated shared secret compared with timingSafeEqual, audience must be 'solo', surface must be 'chat', per-user users.gmail_query_enabled consent, gmail.readonly scope verification, DISABLED-account refusal, and an assertion that the mailbox actually read matches the requested identity (/Users/chris/meetingbrain/app/api/engineai/gmail/query/route.ts:1-29). This is genuine defence in depth and does not depend on EngineAI being correct.
- EngineAI Live has no sideways entry: session creation is the only flag-gated route, and every other Live route independently requires `consent_attested_by === userId` — token:52, cards:32, deck:127, triggers:58, end:70, handoff:47, bind-client:29, lookup:130, export-to-mb:67. An unflagged user cannot attach to someone else's session.
- CLIENT KNOWLEDGE IS NOT OVER-RESTRICTED: query_engine and lookup_client_context register on `config.workspaceClientIds?.length` alone (providers.ts:5316-5319 and the three mirrors) — no per-user flag, no visibility term. query_drive_docs registers on `config.workspaceId` alone (5351-5353). Client contracts, content, tasks and Drive docs are available to every user in every thread, which matches the stated intent.
- search_notebook is correctly audience-scoped and fail-closed: lib/notebook/search.ts:50-53 warns and restricts to team-shareable entries when visibility is omitted, 63-65 excludes private notebooks entirely in a team thread, and 88-95 deliberately withholds the author's own-entry bypass so a private clipping cannot be read back out to colleagues.
- Xero's connect/disconnect routes require owner/admin role (app/api/xero/connect/route.ts:16-17, app/api/xero/status/route.ts:33-34) — the OAuth grant itself is not reachable by a finance-flagged non-admin.

**Could not verify:**

- I did not read the users_access DDL. If flag_* are true `integer` columns, PostgREST returns JS numbers and the `!!` sites (runner.ts:208, workspace-members/route.ts:110-118, me/workspaces/route.ts:64-70) are exactly equivalent to `=== 1`. If any were ever migrated to bigint/numeric, PostgREST serialises those as STRINGS and `!!"0"` is true — the `!!` sites would then grant access where the `=== 1` sites deny it. Worth a one-line schema check rather than a code change.
- Finding 1's blast radius depends on whether off-boarding deletes the workspace_members row. If it does, the exposure narrows to users whose flags were zeroed while membership was kept (which is precisely what Settings → Users and app/api/admin/restrict-access/route.ts do — neither touches workspace_members). I did not find any code path that removes a workspace_members row, but I did not exhaustively search for one.
- /Users/chris/meetingbrain/app/api/me/access/route.ts:35 and :55 return `accessMeetingBrain: true` when the Engine user cannot be resolved or the users_access row is missing — a fail-open default in the sibling product. It appears to feed only components/layout/Sidebar.tsx:178, and MeetingBrain is invite-only, so I did not treat it as an EngineAI finding; someone should confirm MB's own API routes do not rely on that response.
- query_slack and query_meetingbrain in EngineAI register on `config.userEmail` alone (providers.ts:5324-5327) with no per-user flag, even though Settings → Users exposes a MeetingBrain tick (flag_access_meetingbrain). I believe this is intended — the tools scope by the caller's own email plus the client-domain allowlist, and the flag gates the MB *section*, not the data — but if the owner's mental model is 'unticking MB stops that person reading MB data', it does not.

### data-correctness

- Tool registration and execution across all FOUR provider chains — query_engine, lookup_client_context, query_meetingbrain, query_slack, query_gmail, query_xero, query_drive_docs, search_notebook and search_memory each have an execution branch in Anthropic (providers.ts ~6121-6309), xAI (~6821-7030), Gemini (~7514-7712) and OpenAI (~8108-8306). I checked the known Gemini footgun specifically: the Gemini branches push to `geminiMessages` (e.g. :7646, :7671, :7692), not openaiMessages. No 3-of-4 gap.
- MeetingBrain client-domain allowlist fails closed: loadClientDomains throws on query error rather than returning [] (providers.ts:3427-3430), and client_meetings refuses to run on an empty allowlist rather than letting the RPC's NULL fallback publish every external meeting (:3903-3910).
- hasClientAttendee inspects only the `email` field of parsed attendees and returns false on unparseable input (providers.ts:3448-3479) — display names cannot forge client status.
- queryMeetingBrain my_tasks handles a deployment whose get_active_tasks predates p_status_mode by returning an explicit hint/notice instead of "you have no completed tasks" (providers.ts:3591-3620), and mbRpcWithClientDomains sets `degraded` so an unreachable client meeting is not reported as a bad meeting id (:3502-3512, :3793-3799).
- The already-fixed truncation set is intact and honest: reportContractsSummary, reportCommissionedUnits, reportCompletedUnits, reportPipelineSummary and reportAssignedTasks all select with { count: "exact" }, go through runCapped (providers.ts:1652-1659), and surface matched_total/truncated/warning, which formatToolResult prints BEFORE the data as "⚠ INCOMPLETE RESULT" (:194-197).
- Xero's data layer is honest even where the formatter is not — unpaid_invoices carries the true `count` and `total_due` over the full row set (lib/xero/client.ts:176), and aged_receivables buckets every row before slicing only the top-8 worst contacts (:179-192). The defect is confined to the 6000-char formatter cut.
- Gmail bridge: results are discarded on a mailbox mismatch (providers.ts:4164-4168), and the bridge's `dropped` count is surfaced to the model as "say the list may be incomplete" (:4227).
- Notebook search applies the UI's own visibility ceiling rather than a second implementation, and deliberately passes -1 instead of userId in team threads to withhold the author bypass (lib/notebook/search.ts:95-104); its no-results summary distinguishes "nothing matched" from "private-source entries were not searched" (:115-119).
- Third-party content is consistently fenced with a per-call nonce and instructions kept outside the fence — MeetingBrain, Slack, Gmail and Drive all route through fenceUntrusted (providers.ts:230-253).

**Could not verify:**

- VERIFIED IN CODE but ranked below the top five (impact depends on data volume I could not measure): reportSocialPerformance caps the raw publishing query at 1000 rows ordered by metrics_score DESC — providers.ts:2173-2175 `const { data: rawPosts, error: postsErr } = await postsQ.order("metrics_score", { ascending: false, nullsFirst: false }).limit(1000);`. There is no { count: "exact" }, and the social_performance dispatch at :2343 forwards only data/count/total/error/summary — never truncated or warning. Because the cap drops the LOWEST-scoring rows, a year that exceeds 1000 publishing events yields per-network `published` counts that are too low AND an `avgScore` biased upward, both presented as the network's real performance. Worth fixing with the same runCapped treatment.
- VERIFIED IN CODE, second instance of the repo's recurring error-as-empty bug: reportCommissionedUnits (providers.ts:1709-1717) and reportAssignedTasks (:2062-2065) both check only `contentRes.error` and never `socialRes.error`. runCapped returns `{ rows: [], matched: 0, truncated: false, error }` on failure, so a failed app_tasks_social query silently contributes zero rows, zero matched and no truncation flag — the CU total comes back understated with no warning. I ranked it low only because a prior investigation found app_tasks_social is effectively dead data (44 rows ever, newest 2024-02-22); the code defect is real regardless.
- Two more discarded { data, error } destructures I confirmed but did not rank: providers.ts:3737 `const { data: recent } = await mbRpcWithClientDomains(...)` — a failure of the fuzzy-enrichment pass silently disables misspelling tolerance in search_meetings; and lib/notebook/search.ts:63 and :78 — a PostgREST or() grammar failure becomes "No notebook entries match", the exact false negative the comment at :32-34 warns about.
- lib/xero/client.ts:105-118 xeroGet sends no `page` parameter and never loops, so if the Xero Accounting API paginates Invoices (I believe it caps at 100/page, but could not verify against the live tenant) every unpaid-invoice and aged-receivable figure is computed over the first page only. Worth confirming against the real tenant before treating as a finding.
- lib/gdrive/docs.ts:36 lists with `pageSize: "100"` and no pagination loop, ordered by name — if more than 100 files are shared with the service account, `list` under-reports and `read` returns "No shared document matching X" for a document that is genuinely shared. I could not check how many files the service account can see.

### injection-and-trust

- fenceUntrusted itself is well built: per-call random nonce, all instructions outside the fence, and control-marker stripping done on the SERIALIZED payload rather than field by field, so a sender display name or filename cannot smuggle a forged [SCHEDULED_PROPOSAL]/[MONITOR_STATE] marker (lib/ai/providers.ts:235-254).
- All four named tool-result formatters route through it: Gmail (providers.ts:4225), MeetingBrain (:294), Slack (:4382), Drive (:4584).
- Ordering cannot bypass the HARD tier within a round on the two chains that enforce it: the check sits inside the per-tool execution loop (providers.ts:5553, :6691), so any tool the model emitted alongside query_gmail is refused once Gmail's result lands. Tools that ran BEFORE the email arrived had arguments the email could not have influenced.
- No model-driven write is reachable from untrusted content. create_scheduled_task and update_scheduled_task build a proposal only — buildScheduledUpdateProposal is documented "NO DB write" (providers.ts:4747-4749), the user confirms via a card, and neither takes a model-controlled email recipient. Notebook saves are user-initiated from a text selection in the UI, not a tool.
- Tool arguments lifted from untrusted text are validated server-side, not by prose: meeting_details passes p_user_email plus the client-domain allowlist to the get_meeting_details RPC (providers.ts:3789-3792), so a fabricated or overheard meeting_id resolves only if the caller is an attendee or it is a registered client meeting (:3806).
- Untrusted text cannot forge client status: hasClientAttendee inspects only the attendee email field, compares whole domains so someone@hiscox.com.attacker.io fails, and fails CLOSED on unparseable input (providers.ts:3457-3479).
- Image-beacon exfiltration is closed — all markdown images whose URL does not start with /api/media/ are stripped from the final reply regardless of web-search state (providers.ts:5203-5221).
- The SOFT tier does what it claims: sawThirdPartyContent blocks background memory extraction, and the HARD tier additionally blocks the conversation summary (app/api/ai/conversations/[id]/messages/route.ts:1456-1479). Background extraction is further restricted to preference/fact/client_insight, with "instruction" and "style" excluded (lib/ai/memory-extraction.ts:51-63).
- Personal-source gates fail closed on an omitted visibility: querySlack blocks and logs "caller passed no visibility (fail-closed)" when options.visibility is absent (providers.ts:4254-4268), and formatGmailResult surfaces BLOCKED_AUDIENCE as a plain explanation rather than an error (:4193-4199).

**Could not verify:**

- Whether app_clients/app_content free-text fields reaching formatToolResult (providers.ts:190) should count as third-party. They are first-party workspace records by design, but briefs and content bodies are routinely pasted in from client emails. I did not find an ingestion path that writes external text into them automatically, so I did not report it.
- Whether the content-editor XSS sink is actually reachable end-to-end. I confirmed the sink and confirmed the endpoint asks for raw HTML, but I did not verify that any specific upstream field (brief, customer name, example content) is populated from outside the workspace, nor did I attempt to make the model emit an executing tag.
- preserveLinks (providers.ts:5226) — when set, no markdown link is stripped at all, and with config.webSearch on every http/https link survives regardless (:5234). I did not trace which surfaces set preserveLinks, so I cannot say whether a click-through exfiltration link authored by injected content survives on any user-facing surface.
- Anthropic's server-side web_search (providers.ts:5290) returns results inside the API call, so they cannot be fenced by us at all. The suppressTools/tool_choice "none" mitigation at :5399 covers the post-Gmail case; I did not assess what other guardrails apply to those server-side results.

