import { safeName, STATED_EDGES, ORG_RELATIONSHIPS, ENGAGEMENT_KINDS, ENGAGEMENT_STAGES, type StatedFact } from "@/lib/entities/record";

/**
 * Notice when someone states a durable fact about their world, and capture it.
 *
 * NOT A TOOL, deliberately, and the reason is written in this repo's history.
 * The system prompt already instructs the model to look up unfamiliar internal
 * names before concluding they are unknown; in the conversation that started
 * all of this it did not, searched once, and asked the user what to try next.
 * A capability the model has to remember to invoke is a capability that is
 * sometimes absent. This runs after every turn, on the user's own words, and
 * cannot be declined.
 *
 * READS THE USER'S MESSAGE ONLY. Never the assistant's reply, never an email
 * body, never a transcript. The user is the authority on their own world — that
 * is the entire justification for letting a sentence create a person — and the
 * moment third-party text is in scope, that justification is gone. The caller
 * enforces this too: capture is skipped on any turn that touched third-party
 * content.
 *
 * SILENCE IS THE COMMON ANSWER. Most turns state no durable fact at all. A
 * capture pass that finds something in every message is one that is inventing,
 * and the prompt says so in as many words.
 */

const MODEL = "claude-opus-5";

/** Statements worth a model call. Most turns are questions, and running an
 *  extraction on "what did we discuss last week" is spend with no possible
 *  yield. Cheap pre-filter, generous on purpose: a missed capture costs one
 *  fact, a false trigger costs a fraction of a cent. */
const ASSERTION_HINT =
  /\b(is|are|was|were|works?|runs?|heads?|leads?|joined|left|introduced|owns?|acquired|won|lost|pitch(?:ing|ed)?|prospect|competitor|client|partner|funder|supplier|vendor|reports? to|took over|now at|moved to)\b/i;

export function looksLikeAStatement(text: string): boolean {
  const t = (text || "").trim();
  if (t.length < 12 || t.length > 4000) return false;
  // A question is rarely an assertion about the world, and "who is Ollie?" must
  // not create Ollie.
  if (/^\s*(who|what|when|where|why|how|which|can|could|would|should|do|does|did|is|are|was|were)\b/i.test(t) && t.indexOf("?") >= 0) return false;
  return ASSERTION_HINT.test(t);
}

export const CAPTURE_TOOL_SCHEMA = {
  name: "record_world_facts",
  description: "Record durable facts the user stated about people, organisations, engagements or projects.",
  input_schema: {
    type: "object",
    additionalProperties: false,
    required: ["facts"],
    properties: {
      facts: {
        type: "array",
        maxItems: 6,
        items: {
          type: "object",
          additionalProperties: false,
          required: ["subject", "subject_kind"],
          properties: {
            subject: { type: "string", description: "The person, organisation, engagement or project, named as the user named it." },
            subject_kind: { type: "string", enum: ["person", "org", "engagement"] },
            relation: { type: "string", enum: STATED_EDGES as unknown as string[] },
            object: { type: "string", description: "The other side of the relationship." },
            object_kind: { type: "string", enum: ["person", "org", "engagement"] },
            role: { type: "string", description: "A short job title, only when the user gave one. Max 60 characters." },
            org_relationship: { type: "string", enum: ORG_RELATIONSHIPS as unknown as string[] },
            engagement_kind: { type: "string", enum: ENGAGEMENT_KINDS as unknown as string[] },
            engagement_stage: { type: "string", enum: ENGAGEMENT_STAGES as unknown as string[] },
          },
        },
      },
    },
  },
};

const SYSTEM = `You read one message a person wrote to their work assistant, and record DURABLE FACTS about their working world: who people are, which organisations matter and how, what work is being pitched, won, run or dropped.

Record a fact only when the message STATES it. Not when it implies it, not when it would be plausible, not when the person is asking about it. "Ollie Cann is head of Gavi and introduced us to IFFIm" states three facts. "Who is Ollie Cann?" states none. "Can you draft something for Gavi" states none.

DURABLE means it would still be worth knowing in six months. Who someone is, who they work for, that an organisation is a client or a prospect or a competitor, that a piece of work is a pitch or internal or finished. NOT what was discussed, decided or drafted today — that is not this.

An internal project is an engagement whose kind is "internal". A prospect pitch is an engagement whose kind is "pitch". Use the names the person used.

Returning an empty list is the correct and by far the most common answer.`;

export interface CaptureResult { facts: StatedFact[]; considered: boolean }

/**
 * Extract stated facts from one user message.
 *
 * Returns nothing on any failure. Capture is a bonus on top of a turn that has
 * already succeeded; an error here must never surface to the person, and a
 * thrown one would.
 */
export async function captureStatedFacts(userMessage: string): Promise<CaptureResult> {
  if (!looksLikeAStatement(userMessage)) return { facts: [], considered: false };
  if (!process.env.ANTHROPIC_API_KEY) return { facts: [], considered: false };

  try {
    const mod = await import("@anthropic-ai/sdk");
    const Anthropic = (mod as any).default ?? mod;
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const res = await client.messages.create({
      model: MODEL,
      max_tokens: 900,
      system: [{ type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } }],
      tools: [CAPTURE_TOOL_SCHEMA],
      tool_choice: { type: "tool", name: "record_world_facts" },
      messages: [{ role: "user", content: `MESSAGE\n<<<\n${userMessage.slice(0, 4000)}\n>>>` }],
    });
    const block = (res.content as any[]).find((b) => b.type === "tool_use");
    const raw = (block?.input?.facts || []) as any[];

    // Validated here, not trusted from the model. safeName drops anything that
    // changes under normalisation rather than cleaning it, and every enum is
    // re-checked against the closed set the graph actually holds.
    const facts: StatedFact[] = [];
    for (const f of raw.slice(0, 6)) {
      const subject = safeName(f?.subject);
      if (!subject) continue;
      const kind = f?.subject_kind;
      if (kind !== "person" && kind !== "org" && kind !== "engagement") continue;
      const fact: StatedFact = { subject, subject_kind: kind };
      if (typeof f?.relation === "string" && (STATED_EDGES as readonly string[]).indexOf(f.relation) >= 0) {
        const object = safeName(f?.object);
        if (object) {
          fact.relation = f.relation;
          fact.object = object;
          fact.object_kind = f?.object_kind === "person" || f?.object_kind === "engagement" ? f.object_kind : "org";
        }
      }
      if (typeof f?.role === "string") fact.role = f.role;
      if (typeof f?.org_relationship === "string" && (ORG_RELATIONSHIPS as readonly string[]).indexOf(f.org_relationship) >= 0) fact.org_relationship = f.org_relationship;
      if (typeof f?.engagement_kind === "string" && (ENGAGEMENT_KINDS as readonly string[]).indexOf(f.engagement_kind) >= 0) fact.engagement_kind = f.engagement_kind;
      if (typeof f?.engagement_stage === "string" && (ENGAGEMENT_STAGES as readonly string[]).indexOf(f.engagement_stage) >= 0) fact.engagement_stage = f.engagement_stage;
      facts.push(fact);
    }
    return { facts, considered: true };
  } catch (err) {
    console.error("[Entities] capture failed:", err instanceof Error ? err.message : err);
    return { facts: [], considered: false };
  }
}
