-- Workspace-level "About the company" context, injected into every EngineAI
-- system prompt (chat + scheduled runs). Motivation: EngineAI web-searched
-- the company's OWN product (AuthorityOn.ai) as an unknown term because it
-- had no context about The Content Engine itself.
-- Editable in EngineAI → Personalise → Company (admin only).

ALTER TABLE intelligence.ai_settings
  ADD COLUMN IF NOT EXISTS information_company_context text;

-- Seed (only where empty — safe to re-run; edit anytime in the UI):
UPDATE intelligence.ai_settings
SET information_company_context =
'The Content Engine (TCE, thecontentengine.com) is a Switzerland-based B2B content marketing agency. Clients are on retainer contracts measured in Content Units (CUs); TCE produces editorial, social, and video content and runs the workflow through the Engine platform.

STRATEGIC FOCUS — AI authority & visibility: TCE is building a practice around AI search visibility (GEO — Generative Engine Optimization / AEO — Answer Engine Optimization): getting brands surfaced and cited in AI answers (ChatGPT, Perplexity, Google AI Overviews), beyond classic SEO. Active AI-visibility engagements include WBCSD, Siemens Smart Infrastructure, Amrize (Digital Authority programme — entity mapping for AI answer engines), CFG (schema audits, structured metadata), and Gavi.

AUTHORITYON.AI — TCE''S OWN PRODUCT: AuthorityOn.ai is The Content Engine''s own AI-visibility platform (NOT a third-party tool — never web-search it as if unknown). It tracks and demonstrates how brands appear in AI search, and underpins the GEO/AEO practice; it has been demoed live to clients (e.g. Gavi, 9 June 2026). Comparison set the team benchmarks against: Profound, Semrush AI toolkit, Ahrefs.

For details on any TCE product, initiative, or internal name: search MeetingBrain meetings (e.g. "AuthorityOn", "AI visibility", "Digital Authority") — internal knowledge lives in meeting records.'
WHERE information_company_context IS NULL;
