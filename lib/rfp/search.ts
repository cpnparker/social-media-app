/**
 * RFP Discovery — AI-powered web search for open RFPs.
 *
 * Supports two search providers:
 * 1. Anthropic (Claude) — web_search_20250305 tool
 * 2. xAI (Grok) — built-in live web search
 */

import Anthropic from "@anthropic-ai/sdk";
import { TCE_COMPANY_PROFILE } from "./company-profile";
import { verifyOpportunityUrls, type UrlConfidence } from "./url-verification";

function getAnthropicClient() {
  return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });
}

export type SearchProvider = "anthropic" | "grok";

export interface DeadlineMilestone {
  type: string;
  label: string;
  date: string;
}

export interface DiscoveredRfp {
  title: string;
  organisation: string;
  deadline: string | null;
  scope: string;
  relevanceScore: number;
  sourceUrl: string | null;
  reasoning: string;
  sectors: string[];
  region: string | null;
  estimatedValue: string | null;
  milestones: DeadlineMilestone[];
  // URL verification metadata (optional — populated after verification)
  urlConfidence?: UrlConfidence;
  portalName?: string | null;
  portalSearchUrl?: string | null;
  crossReferenced?: boolean;
}

export interface SearchResult {
  opportunities: DiscoveredRfp[];
  searchSummary: string;
  provider: SearchProvider;
}

function buildSearchPrompt({
  query,
  sectors,
  regions,
  sources,
}: {
  query?: string;
  sectors?: string[];
  regions?: string[];
  sources?: string[];
}) {
  const sectorFilter = sectors?.length
    ? `Focus on these sectors: ${sectors.join(", ")}.`
    : "";

  const regionFilter = regions?.length
    ? `Focus on these regions: ${regions.join(", ")}.`
    : "";

  const customQuery = query ? `Additional search criteria: "${query}".` : "";

  const portalList = sources?.length
    ? sources.join(", ")
    : null; // Use the comprehensive default list below

  const today = new Date().toISOString().split("T")[0];

  const defaultSources = `Search across ALL of these source categories:

**UN & Multilateral Procurement:**
- UNGM (ungm.org) — the central UN procurement portal for all agencies
- UNDP Procurement Notices (procurement-notices.undp.org)
- UNICEF Supply Division service contracts
- WHO, UNEP, UNESCO, FAO, WFP, UNFPA, UNHCR procurement pages
- World Bank procurement (projects & operations)
- UNOPS procurement opportunities

**Development Banks:**
- African Development Bank (afdb.org/procurement)
- Asian Development Bank (adb.org tenders)
- Inter-American Development Bank (iadb.org procurement notices)
- European Bank for Reconstruction and Development (EBRD)

**EU & European Institutions:**
- TED / Tenders Electronic Daily (ted.europa.eu) — search CPV codes 79340000 (advertising/marketing), 79800000 (printing/publishing), 92111000 (audiovisual)
- EU institutions eTendering portal
- EuropeAid / DG INTPA procurement

**Government Portals:**
- SAM.gov (US federal)
- UK Find a Tender (find-tender.service.gov.uk)
- Canada BuyAndSell (buyandsell.gc.ca)
- Australian Government AusTender

**NGO & Humanitarian:**
- Save the Children (savethechildren.net/tenders)
- IFRC / Red Cross (procurement.ifrc.org)
- Danish Refugee Council (pro.drc.ngo/resources/tenders)
- Oxfam, CARE International, IRC, WWF procurement pages
- Welthungerhilfe (welthungerhilfe.org/tenders)

**Aggregators & Industry:**
- Devex Funding (devex.com/funding/tenders-grants)
- DevelopmentAid (developmentaid.org/tenders)
- DevBusiness / dgMarket (dgmarket.com)
- GlobalTenders (globaltenders.com)
- RFPMart (rfpmart.com) — marketing, social media, content categories
- TendersOnTime (tendersontime.com)
- ReliefWeb consultancy listings (reliefweb.int/jobs — type: Consultancy)

**Corporate & Private Sector:**
- Search for corporate RFPs from Fortune 500 companies, large brands, and agencies seeking content, communications, sustainability reporting, ESG communications, and digital marketing services
- Industry-specific searches: "content agency RFP", "communications services tender", "sustainability report content", "ESG communications RFP"`;

  return `You are an RFP discovery assistant for The Content Engine. Your job is to find current, open RFPs and procurement opportunities that match our company profile.

Company Profile:
${TCE_COMPANY_PROFILE}

Today's date is ${today}.

Instructions:
1. Search for current, open RFPs and tenders that The Content Engine could respond to
2. ${portalList ? `Search across these portals: ${portalList}, and general web searches` : defaultSources}
3. Focus on content production, communications, sustainability, climate, thought leadership, ESG reporting, digital content, campaign development, video/multimedia production, and related services
4. CRITICAL: Only include RFPs where the deadline (or first deadline to register interest / submit expression of interest) is AFTER ${today}. Do NOT include any RFPs whose deadlines have already passed.
5. Only include RFPs whose deadlines have not yet passed. Include RFPs with upcoming deadlines — the user will decide which to pursue
6. Score each opportunity 0-100 based on relevance to our profile
7. Cast a WIDE net — search multiple portals and combine results. Aim for at least 8-12 opportunities across different source types (UN, government, NGO, corporate, etc.)
8. Include opportunities from BOTH the international development sector AND the private/corporate sector

${sectorFilter}
${regionFilter}
${customQuery}

After searching, return your findings as a JSON object with this exact structure:
{
  "opportunities": [
    {
      "title": "RFP title",
      "organisation": "Issuing organisation name",
      "deadline": "YYYY-MM-DD or null if unknown — this MUST be the FINAL SUBMISSION deadline",
      "milestones": [
        { "type": "register_interest", "label": "Register Interest", "date": "YYYY-MM-DD" },
        { "type": "questions", "label": "Submit Questions", "date": "YYYY-MM-DD" },
        { "type": "submission", "label": "Final Submission", "date": "YYYY-MM-DD" }
      ],
      "scope": "Brief description of what they're looking for (2-3 sentences)",
      "relevanceScore": 85,
      "sourceUrl": "The EXACT URL from your search results where the RFP listing was found. Copy the URL directly from the search result — do NOT reconstruct or guess URLs. Use null if unsure.",
      "reasoning": "Why this is relevant to The Content Engine",
      "sectors": ["sustainability", "content production"],
      "region": "Region or null",
      "estimatedValue": "Estimated contract value or null"
    }
  ],
  "searchSummary": "Brief summary of what was searched and found"
}

IMPORTANT about deadlines:
- The "deadline" field MUST be the final submission deadline
- If the RFP has multiple deadlines (register interest, submit questions, attend briefing, final submission), include them all in the "milestones" array with appropriate types and labels
- Common milestone types: "register_interest", "expression_of_interest", "questions", "briefing", "draft_submission", "submission"
- If only one deadline is known, put it in "deadline" and leave "milestones" as an empty array

IMPORTANT about source URLs:
- The "sourceUrl" MUST be an exact URL copied from your search results — never fabricate, reconstruct, or guess a URL
- If you cannot find the direct procurement page URL, use the URL of the search result page where you found the listing
- If no URL is available at all, use null — a null URL is better than a wrong URL

Sort by relevanceScore descending. Return only genuine, currently open opportunities.
Return ONLY the JSON object, no other text.`;
}

interface SearchSourceUrl {
  url: string;
  title: string;
}

interface MatchResult {
  url: string | null;
  /** True if the URL was found in or matched against actual search API results */
  crossReferenced: boolean;
}

/**
 * Try to find the best real URL for an opportunity by matching against
 * actual search result URLs. Falls back to the AI-provided URL if valid,
 * but flags it as not cross-referenced.
 */
function matchRealUrl(
  opp: { title: string; organisation: string; sourceUrl: string | null },
  realUrls: SearchSourceUrl[]
): MatchResult {
  if (realUrls.length === 0) return { url: opp.sourceUrl, crossReferenced: false };

  const oppTitleLower = opp.title.toLowerCase();
  const oppOrgLower = opp.organisation.toLowerCase();

  // 1. If AI provided a URL, check if it matches a real search result
  if (opp.sourceUrl) {
    try {
      const aiDomain = new URL(opp.sourceUrl).hostname;
      const exactMatch = realUrls.find((r) => r.url === opp.sourceUrl);
      if (exactMatch) return { url: opp.sourceUrl, crossReferenced: true };

      // Same domain match (AI may have the wrong path but right domain)
      const domainMatch = realUrls.find((r) => {
        try {
          return new URL(r.url).hostname === aiDomain;
        } catch {
          return false;
        }
      });
      if (domainMatch) return { url: domainMatch.url, crossReferenced: true };
    } catch {
      // AI URL was invalid, fall through to title matching
    }
  }

  // 2. Title-based matching against search result titles
  const titleMatch = realUrls.find((r) => {
    const resultTitle = r.title.toLowerCase();
    return (
      resultTitle.includes(oppTitleLower) ||
      oppTitleLower.includes(resultTitle) ||
      oppTitleLower.split(/\s+/).filter((w) => w.length > 4 && resultTitle.includes(w)).length >= 3
    );
  });
  if (titleMatch) return { url: titleMatch.url, crossReferenced: true };

  // 3. Organisation-based matching
  if (oppOrgLower.length > 3) {
    const orgMatch = realUrls.find((r) => r.title.toLowerCase().includes(oppOrgLower));
    if (orgMatch) return { url: orgMatch.url, crossReferenced: true };
  }

  // 4. Fall back to AI URL — NOT cross-referenced
  return { url: opp.sourceUrl, crossReferenced: false };
}

/**
 * Parse dates flexibly — handles YYYY-MM-DD, "April 15, 2026",
 * "15/04/2026" (DD/MM/YYYY), "15 April 2026", "Q2 2026", etc.
 */
function parseFlexibleDate(dateStr: string | null): Date | null {
  if (!dateStr) return null;
  const trimmed = dateStr.trim();

  // Try native parsing first (handles ISO, "Month DD, YYYY", etc.)
  const native = new Date(trimmed);
  if (!isNaN(native.getTime())) return native;

  // DD/MM/YYYY or DD-MM-YYYY (common non-US format)
  const ddmmyyyy = trimmed.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})$/);
  if (ddmmyyyy) {
    const d = new Date(parseInt(ddmmyyyy[3]), parseInt(ddmmyyyy[2]) - 1, parseInt(ddmmyyyy[1]));
    if (!isNaN(d.getTime())) return d;
  }

  // "15 Apr 2026" or "15 April 2026"
  const dayMonthYear = trimmed.match(/^(\d{1,2})\s+(\w+)\s+(\d{4})$/);
  if (dayMonthYear) {
    const d = new Date(`${dayMonthYear[2]} ${dayMonthYear[1]}, ${dayMonthYear[3]}`);
    if (!isNaN(d.getTime())) return d;
  }

  // Quarter: "Q2 2026" → last day of quarter
  const quarter = trimmed.match(/^Q(\d)\s*(\d{4})$/i);
  if (quarter) {
    const quarterEndMonth = [2, 5, 8, 11]; // Mar, Jun, Sep, Dec (0-indexed)
    const mIdx = quarterEndMonth[parseInt(quarter[1]) - 1];
    if (mIdx !== undefined) {
      return new Date(parseInt(quarter[2]), mIdx + 1, 0); // last day of month
    }
  }

  return null;
}

function parseOpportunities(
  textContent: string,
  realUrls: SearchSourceUrl[] = [],
  provider: SearchProvider = "anthropic"
): {
  opportunities: DiscoveredRfp[];
  searchSummary: string;
} {
  console.log(`[RFP Search] parseOpportunities called, textContent length: ${textContent.length}, realUrls: ${realUrls.length}, provider: ${provider}`);

  if (!textContent || textContent.length < 10) {
    console.error("[RFP Search] textContent is empty or too short");
    return {
      opportunities: [],
      searchSummary: "Search completed but no response was received from the AI.",
    };
  }

  try {
    // Try to extract JSON — handle markdown code fences
    let jsonStr: string | null = null;

    // First try: look for ```json ... ``` blocks
    const codeBlockMatch = textContent.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
    if (codeBlockMatch) {
      jsonStr = codeBlockMatch[1];
    }

    // Second try: plain JSON object
    if (!jsonStr) {
      const jsonMatch = textContent.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        jsonStr = jsonMatch[0];
      }
    }

    if (!jsonStr) {
      console.error("[RFP Search] No JSON found in AI response. First 500 chars:", textContent.substring(0, 500));
      return {
        opportunities: [],
        searchSummary: "Search completed but no structured results could be extracted.",
      };
    }

    let parsed: any;
    try {
      parsed = JSON.parse(jsonStr);
    } catch (jsonErr) {
      console.warn("[RFP Search] JSON parse failed, attempting repair...");
      // Try to repair truncated JSON by closing open arrays/objects
      try {
        // Find the last complete opportunity object
        const lastCompleteObj = jsonStr.lastIndexOf("},");
        if (lastCompleteObj > 0) {
          const repaired = jsonStr.substring(0, lastCompleteObj + 1) + ']}';
          parsed = JSON.parse(repaired);
          console.log("[RFP Search] JSON repair succeeded — recovered partial results");
        } else {
          throw jsonErr;
        }
      } catch {
        console.error("[RFP Search] JSON repair also failed:", jsonErr);
        console.error("[RFP Search] JSON string (first 500 chars):", jsonStr.substring(0, 500));
        console.error("[RFP Search] JSON string (last 200 chars):", jsonStr.substring(jsonStr.length - 200));
        return {
          opportunities: [],
          searchSummary: "Search completed but the response format was invalid.",
        };
      }
    }

    if (!parsed.opportunities || !Array.isArray(parsed.opportunities)) {
      console.error("[RFP Search] Parsed JSON has no 'opportunities' array. Keys:", Object.keys(parsed));
      return {
        opportunities: [],
        searchSummary: parsed.searchSummary || parsed.search_summary || "Search completed but no opportunities were found.",
      };
    }

    console.log(`[RFP Search] Found ${parsed.opportunities.length} raw opportunities in JSON`);

    if (true) { // scoped block replaces old `if (jsonMatch)`
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const SUSPICIOUS_TLDS = [".xyz", ".top", ".buzz", ".click", ".link", ".surf", ".win", ".bid"];

      const allOpps = (parsed.opportunities || []).map((opp: any) => {
        // Validate and sanitise the AI-provided sourceUrl
        let validatedUrl = opp.sourceUrl || opp.source_url || null;
        if (validatedUrl) {
          try {
            const parsedUrl = new URL(validatedUrl);
            if (SUSPICIOUS_TLDS.some((tld) => parsedUrl.hostname.endsWith(tld))) {
              validatedUrl = null;
            }
          } catch {
            validatedUrl = null;
          }
        }

        const title = opp.title || "Untitled";
        const organisation = opp.organisation || opp.organization || "Unknown";

        // Cross-reference against real search result URLs
        const matchResult = matchRealUrl(
          { title, organisation, sourceUrl: validatedUrl },
          realUrls
        );

        // Grok-specific: if URL was NOT cross-referenced against real citation
        // URLs, null it out entirely. Grok fabricates URLs at a much higher rate
        // than Anthropic — better to show a portal fallback than a dead link.
        let finalUrl = matchResult.url;
        if (provider === "grok" && !matchResult.crossReferenced) {
          finalUrl = null;
        }

        // Extract milestones
        const milestones: DeadlineMilestone[] = (opp.milestones || [])
          .map((m: any) => ({
            type: m.type || "other",
            label: m.label || m.type || "Milestone",
            date: m.date,
          }))
          .filter((m: DeadlineMilestone) => m.date);

        return {
          title,
          organisation,
          deadline: opp.deadline || null,
          scope: opp.scope || "",
          relevanceScore: opp.relevanceScore || 0,
          sourceUrl: finalUrl,
          reasoning: opp.reasoning || "",
          sectors: opp.sectors || [],
          region: opp.region || null,
          estimatedValue: opp.estimatedValue || opp.estimated_value || null,
          milestones,
          crossReferenced: matchResult.crossReferenced,
        };
      });

      console.log(`[RFP Search] Parsed ${allOpps.length} opportunities from AI response`);

      // Filter out already-expired opportunities only.
      // Keep opportunities with unparseable dates rather than dropping them.
      const opportunities = allOpps
        .filter((opp: DiscoveredRfp) => {
          if (!opp.deadline) return true;
          const deadlineDate = parseFlexibleDate(opp.deadline);
          if (!deadlineDate) return true; // Unparseable date → keep
          return deadlineDate >= today;
        })
        .map((opp: DiscoveredRfp) => ({
          ...opp,
          // Strip expired milestones so the UI only shows future ones
          milestones: opp.milestones.filter((m) => {
            const mDate = parseFlexibleDate(m.date);
            return !mDate || mDate >= today;
          }),
        }));

      const dropped = allOpps.length - opportunities.length;
      if (dropped > 0) {
        console.log(`[RFP Search] Dropped ${dropped} expired opportunities`);
      }
      console.log(`[RFP Search] Returning ${opportunities.length} opportunities`);

      return {
        opportunities,
        searchSummary:
          parsed.searchSummary || parsed.search_summary || "Search completed",
      };
    }
  } catch (err) {
    console.error("[RFP Search] Unexpected error in parseOpportunities:", err);
    return {
      opportunities: [],
      searchSummary: "Search completed but an error occurred while processing results.",
    };
  }
}

async function searchWithAnthropic(params: {
  query?: string;
  sectors?: string[];
  regions?: string[];
  sources?: string[];
}): Promise<SearchResult> {
  const anthropic = getAnthropicClient();
  const systemPrompt = buildSearchPrompt(params);

  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 16000,
    system: systemPrompt,
    messages: [
      {
        role: "user",
        content:
          "Search for current open RFPs and procurement opportunities that The Content Engine should consider responding to. Be thorough in your search across multiple procurement portals.",
      },
    ],
    tools: [
      {
        type: "web_search_20250305" as any,
        name: "web_search",
        max_uses: 10,
      } as any,
    ],
  });

  let textContent = "";
  const realUrls: SearchSourceUrl[] = [];

  for (const block of response.content) {
    if (block.type === "text") {
      textContent += block.text;
    }
    // Extract real URLs from web search result blocks
    if ((block as any).type === "web_search_tool_result") {
      const resultBlock = block as any;
      if (Array.isArray(resultBlock.content)) {
        for (const result of resultBlock.content) {
          if (result.type === "web_search_result" && result.url) {
            realUrls.push({ url: result.url, title: result.title || "" });
          }
        }
      }
    }
  }

  console.log(`[RFP Search] Anthropic response: ${response.content.length} blocks, textContent: ${textContent.length} chars, ${realUrls.length} real URLs, stop_reason: ${response.stop_reason}`);
  console.log(`[RFP Search] Anthropic response block types: ${response.content.map((b: any) => b.type).join(", ")}`);

  if (response.stop_reason === "max_tokens") {
    console.warn("[RFP Search] Response was truncated by max_tokens! JSON may be incomplete.");
  }

  if (!textContent) {
    console.error("[RFP Search] No text content from Anthropic. Full response content types:", JSON.stringify(response.content.map((b: any) => ({ type: b.type })), null, 2));
  }

  const parsed = parseOpportunities(textContent, realUrls, "anthropic");

  // Verify URLs: HEAD-check + trusted portal matching + confidence scoring
  console.log(`[RFP Search] Verifying ${parsed.opportunities.length} URLs (Anthropic)...`);
  const verified = await verifyOpportunityUrls(parsed.opportunities);

  return { opportunities: verified, searchSummary: parsed.searchSummary, provider: "anthropic" as SearchProvider };
}

async function searchWithGrok(params: {
  query?: string;
  sectors?: string[];
  regions?: string[];
  sources?: string[];
}): Promise<SearchResult> {
  if (!process.env.XAI_API_KEY) {
    throw new Error("XAI_API_KEY is not set");
  }

  const systemPrompt = buildSearchPrompt(params);

  // Use xAI Responses API with web_search tool for real citation URLs
  const response = await fetch("https://api.x.ai/v1/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.XAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: "grok-3",
      input: [
        { role: "system", content: systemPrompt },
        {
          role: "user",
          content:
            "Search for current open RFPs and procurement opportunities that The Content Engine should consider responding to. Be thorough in your search across multiple procurement portals.",
        },
      ],
      tools: [{ type: "web_search" }],
      temperature: 0.3,
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    console.error("[RFP Search] Grok responses API error:", errText);
    throw new Error(`Grok search failed: ${response.status}`);
  }

  const data = await response.json();

  // Extract text output and citation URLs from the responses API format
  let textContent = "";
  const realUrls: SearchSourceUrl[] = [];

  // The responses API returns output as an array of items
  if (Array.isArray(data.output)) {
    for (const item of data.output) {
      if (item.type === "message" && Array.isArray(item.content)) {
        for (const block of item.content) {
          if (block.type === "output_text") {
            textContent += block.text || "";
          }
        }
      }
    }
  }

  // Extract citation URLs
  if (Array.isArray(data.citations)) {
    for (const citation of data.citations) {
      if (citation.url) {
        realUrls.push({ url: citation.url, title: citation.title || "" });
      }
    }
  }

  console.log(`[RFP Search] Grok response: textContent ${textContent.length} chars, ${realUrls.length} citations`);
  if (!textContent) {
    console.error("[RFP Search] No text content from Grok. data keys:", Object.keys(data));
    if (data.output) {
      console.error("[RFP Search] Grok output types:", JSON.stringify(data.output.map((o: any) => ({ type: o.type, contentTypes: o.content?.map((c: any) => c.type) })), null, 2));
    }
  }

  const parsed = parseOpportunities(textContent, realUrls, "grok");

  // Verify URLs: HEAD-check + trusted portal matching + confidence scoring
  console.log(`[RFP Search] Verifying ${parsed.opportunities.length} URLs (Grok)...`);
  const verified = await verifyOpportunityUrls(parsed.opportunities);

  return { opportunities: verified, searchSummary: parsed.searchSummary, provider: "grok" as SearchProvider };
}

/**
 * Run an AI-powered web search for RFPs.
 * Supports both Anthropic (Claude) and Grok as search providers.
 */
export async function searchForRfps({
  query,
  sectors,
  regions,
  sources,
  provider = "anthropic",
}: {
  query?: string;
  sectors?: string[];
  regions?: string[];
  sources?: string[];
  provider?: SearchProvider;
}): Promise<SearchResult> {
  if (provider === "grok") {
    return searchWithGrok({ query, sectors, regions, sources });
  }
  return searchWithAnthropic({ query, sectors, regions, sources });
}
