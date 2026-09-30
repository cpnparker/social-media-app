/**
 * Capability predicates that more than one layer has to agree on.
 *
 * A LEAF MODULE ON PURPOSE — it imports nothing. Both readers sit on opposite
 * sides of the graph: lib/ai/providers.ts decides whether to REGISTER a tool,
 * and the chat route decides whether the prompt may DESCRIBE it. Anything that
 * lives in either of those files and is needed by the other closes a cycle,
 * which is how the two came to disagree in the first place.
 *
 * IT USED TO HOLD THREE MORE EXPORTS: the user-visible name of the switch that
 * turned the generation tools on, written into the system prompt and into the
 * notice at the end of an unmade deck change. The switch is gone — capability
 * existence is an admin permission and capability invocation is per request,
 * which is what every mainstream assistant ships — so the strings went with
 * it rather than staying behind to name a button nobody can press. The file
 * survives for the one predicate below, which was never about a control.
 */

/**
 * Whether the Artlist tools can be offered at all.
 *
 * ONE predicate, read by the two places that have to agree: lib/ai/providers.ts
 * registers search_artlist and license_artlist_asset only when it is true, and
 * the chat route passes it into buildSystemPrompt so Design Mode's prose stops
 * describing them when it is false. They disagreed for as long as both existed
 * — the prompt introduced both tools unconditionally while the registration
 * comment spelled out why that is wrong: "Registered unconditionally, these
 * invite the model to promise a search that always throws 'ARTLIST_API_KEY is
 * not set' — a capability that does not exist." ARTLIST_API_KEY is not in
 * .env.local, so locally the design prompt was describing tools that were not
 * there on every single run.
 *
 * It lives here rather than in lib/integrations/artlist.ts because that module
 * is imported dynamically on purpose, and a static import for one env read
 * would pull the whole wrapper into every chain.
 */
export function artlistConfigured(): boolean {
  return !!process.env.ARTLIST_API_KEY?.trim();
}
