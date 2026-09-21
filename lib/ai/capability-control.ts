/**
 * The name of the switch that turns the generation tools on, as the user sees
 * it on screen.
 *
 * A LEAF MODULE ON PURPOSE — it imports nothing. Three places need this string
 * and two of them cannot reach each other: lib/ai/system-prompts.ts writes it
 * into the prompt, and lib/slides/claim.ts writes it into the notice a user
 * reads when a deck change did not happen. claim.ts importing system-prompts
 * would close the cycle claim.ts → system-prompts → providers → claim.ts, so
 * the string lives here and both sides read it.
 *
 * It names ONE control and five tools, which is itself the complaint: the row
 * says "Image" and silently gates charts, decks, Word files and .pptx too.
 * Every wording built on it therefore lists what is off rather than trusting
 * the label.
 *
 * It names the LABEL and the place, and deliberately not the menu around it.
 * There are two chat composers and they are not the same shape: ChatPanel
 * keeps the switch inside a popover whose trigger reads "Context" on desktop
 * and is an icon alone below 640px, while the home composer at /engineai puts
 * a bare "Image" pill in a row with no menu at all. "The Image switch in the
 * Context menu" was true on exactly one of those, on one breakpoint. What is
 * true on all of them is the label and that it sits under the message box.
 *
 * If the label changes on screen, change it here in the same commit —
 * scripts/verify-incident-fixes.ts §17 matches the quoted labels against BOTH
 * composers' own source, so a rename that misses one goes red.
 */
export const GENERATION_CONTROL_CHAT = 'the "Image" switch under the message box';

/**
 * The same limit on the Design Mode rail at /engineai/design, which has no
 * capability control of any kind and posts no context config: what governs it
 * there is the workspace setting, and nobody sitting at that screen can change
 * it. Sending a designer to look for a switch under their message box is the
 * same class of mistake as naming an environment — it points at something that
 * is not there.
 */
export const GENERATION_CONTROL_DESIGN = 'a workspace setting an admin controls — there is no switch for it on this screen';

/**
 * The same control written for someone READING a chat message rather than for
 * the model. Markdown, because it is appended to a streamed reply.
 */
export const GENERATION_CONTROL_CHAT_MD = 'the **Image** switch under the message box';

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
