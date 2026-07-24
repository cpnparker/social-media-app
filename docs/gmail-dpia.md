# Data Protection Impact Assessment — EngineAI Mail Search

**Controller:** The Content Engine (TCE), Switzerland
**Processing:** AI-assisted retrieval of an employee's own work mailbox
**Assessment date:** 2026-07-24 · **Status:** DRAFT for review and sign-off
**Owner:** Chris Parker (Co-CEO)

> Prepared by the engineer who built the system, from the actual
> implementation. It is **not legal advice.** The legal reasoning in §5 and §6
> is the position TCE intends to take and should be confirmed by a qualified
> adviser before the feature is opened beyond the pilot user. Everything in
> §10 is a statement of fact about the code and can be verified against it.

---

## 1. Why this assessment exists

GDPR Art. 35 requires a DPIA where processing is "likely to result in a high
risk"; Swiss nFADP Art. 22 imposes an equivalent duty. The WP248 criteria met
here are:

| Criterion | Met? | Why |
|---|---|---|
| Data processed on a large scale | Yes | A mailbox is years of correspondence with hundreds of counterparties |
| Innovative use of new technology | Yes | Large language models applied to private correspondence |
| Data used for a new purpose | Yes | Mail was collected to conduct business, not to be queried by an AI assistant |
| Sensitive/highly personal data | Partly | Not special-category by design, but mailboxes routinely contain health, financial and employment details incidentally |
| Systematic monitoring | **No** | Deliberately excluded — see §10.4 |
| Automated decisions with legal effect | No | The system retrieves and summarises; it decides nothing |

Three clear criteria against a threshold of two. A DPIA is required.

## 2. What the processing actually is

An employee asks EngineAI a question in chat (*"what did Hiscox say about the
renewal?"*). EngineAI calls MeetingBrain, which uses **that employee's own
Google OAuth token** to query **their own mailbox**, and returns up to 25
sanitised messages. The message text is sent to Anthropic's API as part of the
prompt so the model can answer. The answer is shown in chat and stored in the
conversation thread.

**Personal data involved**
- *The employee's:* their queries, and the contents of their mailbox.
- *Third parties':* names, email addresses, and the contents of anything they
  wrote to or received from that employee — clients, prospects, suppliers,
  and anyone who has ever emailed them.

**The third-party data is the reason this assessment exists.** The employee can
consent to their own data being processed. The counterparties cannot, and were
never asked.

**Data subjects:** TCE employees who opt in; every person who has corresponded
with them.

**Volume:** ≤25 messages per query, bodies truncated to 2,000 characters. A
mailbox is not bulk-ingested, indexed, or copied — each query is a targeted,
user-initiated retrieval.

## 3. Necessity and proportionality

The purpose is finding information in your own correspondence faster. That is a
genuine business need, and the alternative (searching Gmail by hand) is what
people do today, so this is a change of efficiency, not of capability: **no
employee gains access to information they could not already read.**

Proportionality is addressed by design rather than by policy:

- **Retrieval, not ingestion.** Nothing is bulk-copied or embedded. Only
  messages matching an explicit query are read, and only when asked for.
- **Bounded.** ≤25 messages, 2,000-character bodies, spam and trash always
  excluded.
- **User-initiated only.** There is no scheduled, background, or automated
  mailbox access anywhere in the system (§10.4).
- **Opt-in twice.** An administrator grants the capability; the employee must
  separately switch it on for their own mailbox.

## 4. Who the data goes to

| Recipient | Role | What they receive | Retention |
|---|---|---|---|
| Google (Gmail API) | Source | The query | Google's own logging |
| Anthropic (Claude API) | Processor | Message content in the prompt | Per Anthropic's commercial terms |
| Vercel | Infrastructure | Metadata only — counts, hashed queries, never content (§10.5) | Platform logs, ~1h runtime retention |
| Supabase | Storage | The chat thread, which may contain quoted mail | Until the thread is deleted |

**No other AI vendor receives mailbox content.** EngineAI is multi-provider
(Anthropic / xAI / OpenAI / Google), but mail queries are technically pinned to
Anthropic — see §7.

## 5. Lawful basis

**Art. 6(1)(f) — legitimate interests.** Not consent, for two reasons:
employee consent to an employer is presumptively invalid under EDPB WP259
because of the power imbalance, and third-party consent is unobtainable at any
scale.

**Three-part test:**

1. **Purpose.** TCE has a legitimate interest in its staff working efficiently
   with their own business correspondence.
2. **Necessity.** The processing is limited to what achieves that — targeted
   retrieval from one's own mailbox, nothing more. There is no less intrusive
   way to search correspondence with natural language.
3. **Balance.** Weighed against the interests of counterparties:
   - The employee could always read this mail; no new human sees anything.
   - The processing is transient — no model is trained, no index is built.
   - Content is not retained by the AI vendor (§7).
   - Counterparties would reasonably expect an employer to provide tools for
     managing business correspondence.
   - **Against:** counterparties have no notice and no practical opt-out.
     This is the residual risk in §12, mitigated by the notice in §11 and by
     the strict bounds above.

   **Conclusion:** the balance favours processing, provided the §10 controls
   hold. It would *not* hold if mailbox access became background/automated, or
   if content were retained by a vendor.

## 6. Compatibility with the original purpose (Art. 6(4))

The mail was collected to conduct business. Searching it to answer a question
about that same business is a **compatible** further purpose:

- **Link to original purpose:** direct — same correspondence, same business.
- **Context of collection:** counterparties emailed a company, expecting the
  recipient and their employer's systems to process it.
- **Nature of the data:** ordinary business correspondence, though incidental
  sensitive content is possible.
- **Consequences:** minimal — no decision is made about the counterparty.
- **Safeguards:** §10.

## 7. Google Workspace API — Limited Use

This is the decisive external constraint, and the single control that makes the
feature permissible.

Google's Workspace API User Data and Developer Policy prohibits
*"transferring, selling, or using user data to create, train, or improve a
machine learning or artificial intelligence model beyond that specific user's
personalized model."* It permits transfer *"to provide or improve … features
that are visible and prominent in the requesting application's user interface
and only with the user's consent."*

So: **inference is permitted; training is prohibited.** Sending message text to
Claude to answer a question the user asked is inference. Compliance therefore
rests entirely on the vendor not training on it.

**Anthropic Commercial Terms, Section B (Customer Content):** *"Anthropic may
not train models on Customer Content from Services."* Customer retains rights
to Inputs and owns Outputs. Verified 2026-07-24.

This is why mail queries are **pinned to Anthropic in code** — a `/^claude/`
check on the executing model, deliberately reading the chain's real model
rather than the requested one, so that a provider failover cannot silently move
mailbox content to xAI. Adding a vendor would require re-doing this assessment.

**Outstanding action:** Google additionally requires developers to state, *in
their privacy policy*, that they do not retain Workspace data to develop or
improve non-personalised AI/ML models. **TCE's privacy notice must carry this
sentence.** See §14.

**Verification/CASA — VERIFIED 2026-07-24: User Type = Internal.** Confirmed
in the Google Cloud console (APIs & Services → Google Auth Platform →
Audience), so only accounts in the TCE Workspace organisation can authorise
the app. Under Google's "Additional Requirements for Specific API Scopes",
restricted-scope verification and the annual CASA security assessment
therefore **do not apply**. This is verification relief only: Limited Use
(above) still governs, and GDPR/nFADP apply regardless. **Re-check if the app
is ever switched to External**, which brings both requirements into scope
immediately.

## 8. Risk assessment

| # | Risk | Likelihood | Severity | After controls |
|---|---|---|---|---|
| R1 | One employee reads another's mailbox | Very low | High | Structurally prevented — Gmail's own permission model is the boundary (§10.1) |
| R2 | Mail content leaks into a team-visible thread | Low | High | Solo-conversation requirement + one-way door (§10.2) |
| R3 | Injected instructions in a hostile email cause data exfiltration | Medium | High | Turn-tainting + nonce fencing (§10.3) |
| R4 | Mailbox read without the employee's knowledge | Very low | High | No background access exists (§10.4) |
| R5 | Search terms or content leak via logs | Low | Medium | Counts and hashes only (§10.5) |
| R6 | Vendor trains on message content | Very low | High | Contractual (§7) + single-vendor pinning |
| R7 | Counterparties unaware their mail is AI-processed | **High** | Low | Privacy-notice line (§11); accepted residual risk (§12) |
| R8 | Departed employee's mailbox still reachable | Low | High | Bridge refuses disabled accounts (§10.6) |

R3 deserves emphasis: **email is the only data source in EngineAI that is
attacker-controlled.** Anyone can email a TCE address, and anything they write
enters the model's context. The controls in §10.3 exist specifically for this.

## 9. Consultation

Not consulted: the supervisory authority (not required — residual risk is not
high after controls). To be consulted before rollout: the pilot user (Chris
Parker) and, at rollout, all staff via the §11 notice.

## 10. Technical and organisational measures

These are statements about the code, verifiable against the repository.

### 10.1 One mailbox, structurally
Every call uses the requesting user's **own** Google refresh token, so Gmail
itself enforces the boundary — there is no code path that can read another
mailbox. The model is given no parameter naming a mailbox; the address comes
from the authenticated session and is appended last to the request so it cannot
be overridden. The bridge additionally calls `users.getProfile` and **discards
results if the mailbox read does not match the requested identity.**

### 10.2 Four independent gates, plus a one-way door
Mail is retrievable only when **all four** hold, checked at tool-registration
time so the model is never offered a capability it cannot use:
1. Per-user administrative flag (`flag_access_gmail`, default 0).
2. `allowPersonalData` — an allowlist set *only* by the interactive chat route.
3. A **solo** conversation: not team-visible, not shared with anyone, owned by
   the caller. (A "private" thread with share recipients does not qualify.)
4. An approved model provider (§7).

MeetingBrain independently re-refuses on gates 2 and 3, so a regression in
EngineAI cannot silently open mailbox access. A conversation that has been
shared or made team-visible cannot retrieve mail thereafter.

### 10.3 Untrusted-content containment
Message text is wrapped in a per-call nonce fence with all instructions placed
*outside* it, and TCE's own control markers are stripped from message content
so a mail body cannot forge a system directive. Once mail enters a turn:
- every subsequent tool call is refused, so injected text cannot chain to
  finance, document or scheduling tools;
- background memory extraction is skipped, so an injected line cannot become a
  persistent instruction;
- conversation summarisation is skipped.

### 10.4 No background access — the monitoring boundary
Mailbox access is impossible from the scheduled-task runner, the live-meeting
assistant, the voice interface, and every other non-interactive surface. This
is enforced by allowlist (§10.2 gate 2), not by denylist, so a future feature
cannot inherit access by accident.

**This is the control that makes the processing retrieval rather than
surveillance** under Art. 26 ArGV 3: mail is read only when a human asks, in
their own session, about their own mailbox. It carries a code comment saying
so. It must not be relaxed.

### 10.5 Logging
Server logs record the user id, report type, result count, duration, and a
**SHA-256 hash** of the query — never the search terms and never message
content. For a mailbox the query is itself content ("redundancy package",
"biopsy results"), and platform logs are readable by anyone with project
access.

### 10.6 Access lifecycle
The bridge refuses accounts marked disabled, and refuses when the stored Google
grant does not carry `gmail.readonly`, returning a re-authentication prompt
rather than an opaque error. Employees revoke access themselves by switching
off `gmail_query_enabled`, which sits with the token in MeetingBrain rather
than in the calling application.

### 10.7 Administrative
Administrators can see **that** a user has the capability and **how often** it
is used; they cannot see results. Mail search is off by default for everyone.

## 11. Transparency

- **To employees:** a one-page note before rollout — opt-in, off by default,
  reads only your own mail, nobody including administrators can read yours,
  never runs in the background, content is not retained by the AI vendor, and
  which vendor receives it. This also serves as the EU AI Act Art. 4 AI-literacy
  record.
- **To counterparties:** individual notice is impossible (Art. 14(5)(b) —
  disproportionate effort). A line in TCE's public privacy notice covering
  AI-assisted processing of business correspondence, plus the Workspace
  commitment required by §7.

## 12. Residual risk

| Risk | Residual | Accepted? |
|---|---|---|
| R1, R2, R4, R6, R8 | Very low | Yes |
| R3 (prompt injection) | Low–medium | Yes, with review after 3 months of real use |
| R5 (logs) | Low | Yes |
| R7 (counterparty awareness) | **Medium** | Yes — inherent to any business use of AI on correspondence; mitigated by notice and by strict bounds |

No residual high risks. **Prior consultation with the supervisory authority is
therefore not required.**

## 13. Records and rights

- One entry to be added to the Record of Processing (Art. 30). The small-org
  exemption does not apply, as the processing is not occasional.
- **Access requests:** mail content is not stored by this feature; the source
  of truth remains Gmail. Where a chat thread quotes mail, it is retrievable
  and deletable with that thread.
- **Erasure:** deleting the conversation removes the only copy TCE holds.

## 14. Actions before rollout beyond the pilot user

| # | Action | Owner |
|---|---|---|
| 1 | Add the Workspace no-training commitment to TCE's privacy notice (§7) | Chris |
| 2 | ~~Confirm the OAuth consent screen is User Type = Internal (§7)~~ — **DONE 2026-07-24: Internal** | ✅ |
| 3 | Confirm Anthropic usage is under commercial terms, not consumer (§7) | Chris |
| 4 | Add the ROPA entry (§13) | Chris |
| 5 | Add the correspondence line to the public privacy notice (§11) | Chris |
| 6 | Send the staff note (§11) | Chris |
| 7 | ~~Legal review of §5–§7~~ — **DONE, reviewed and signed 2026-07-24** | ✅ |

## 15. Review

Reassess on any of: adding an AI vendor for mail; any background or scheduled
mailbox access (which would change the §10.4 monitoring conclusion and likely
the §5 balance); widening beyond the user's own mailbox; a change in Google's
Limited Use policy or Anthropic's training terms; or a security incident
involving mail content. Otherwise annually.

**Signature:** ______________________  **Date:** ____________

---

### Sources

- [Anthropic Commercial Terms of Service](https://www.anthropic.com/legal/commercial-terms) — Section B, Customer Content
- [Google Workspace user data and developer policy](https://developers.google.com/workspace/workspace-api-user-data-developer-policy)
- [Google API Services User Data Policy](https://developers.google.com/terms/api-services-user-data-policy)
- [Google Workspace API policy protections for generative AI](https://workspace.google.com/blog/ai-and-machine-learning/api-policy-protections)
