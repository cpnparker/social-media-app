/**
 * RFP Discovery — AI-powered web search for open RFPs.
 *
 * Supports two search providers:
 * 1. Anthropic (Claude) — web_search_20250305 tool
 * 2. xAI (Grok) — built-in live web search
 */

import Anthropic from "@anthropic-ai/sdk";
import { TCE_COMPANY_PROFILE } from "./company-profile";

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
5. Only include RFPs with deadlines at least 2 weeks from now
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

/**
 * Try to find the best real URL for an opportunity by matching against
 * actual search result URLs. Falls back to the AI-provided URL if valid.
 */
function matchRealUrl(
  opp: { title: string; organisation: string; sourceUrl: string | null },
  realUrls: SearchSourceUrl[]
): string | null {
  if (realUrls.length === 0) return opp.sourceUrl;

  const oppTitleLower = opp.title.toLowerCase();
  const oppOrgLower = opp.organisation.toLowerCase();

  // 1. If AI provided a URL, check if it matches a real search result
  if (opp.sourceUrl) {
    try {
      const aiDomain = new URL(opp.sourceUrl).hostname;
      const exactMatch = realUrls.find((r) => r.url === opp.sourceUrl);
      if (exactMatch) return opp.sourceUrl; // AI URL is a real result — keep it

      // Same domain match (AI may have the wrong path but right domain)
      const domainMatch = realUrls.find((r) => {
        try {
          return new URL(r.url).hostname === aiDomain;
        } catch {
          return false;
        }
      });
      if (domainMatch) return domainMatch.url; // Use the real URL from same domain
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
      // Check if significant words overlap
      oppTitleLower.split(/\s+/).filter((w) => w.length > 4 && resultTitle.includes(w)).length >= 3
    );
  });
  if (titleMatch) return titleMatch.url;

  // 3. Organisation-based matching
  if (oppOrgLower.length > 3) {
    const orgMatch = realUrls.find((r) => r.title.toLowerCase().includes(oppOrgLower));
    if (orgMatch) return orgMatch.url;
  }

  // 4. Fall back to AI URL if it passed validation
  return opp.sourceUrl;
}

function parseOpportunities(
  textContent: string,
  realUrls: SearchSourceUrl[] = []
): {
  opportunities: DiscoveredRfp[];
  searchSummary: string;
} {
  try {
    const jsonMatch = textContent.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
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
        const resolvedUrl = matchRealUrl(
          { title, organisation, sourceUrl: validatedUrl },
          realUrls
        );

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
          sourceUrl: resolvedUrl,
          reasoning: opp.reasoning || "",
          sectors: opp.sectors || [],
          region: opp.region || null,
          estimatedValue: opp.estimatedValue || opp.estimated_value || null,
          milestones,
        };
      });

      // Filter out expired and near-expired opportunities.
      // Enforce a 2-week minimum buffer — if an RFP closes in less than
      // 14 days there isn't enough time to prepare a quality response.
      const twoWeeksFromNow = new Date(today);
      twoWeeksFromNow.setDate(twoWeeksFromNow.getDate() + 14);

      const opportunities = allOpps
        .filter((opp: DiscoveredRfp) => {
          if (!opp.deadline) return true; // Keep if no deadline specified
          const deadlineDate = new Date(opp.deadline);
          if (isNaN(deadlineDate.getTime())) return false; // Invalid date → drop
          return deadlineDate >= twoWeeksFromNow;
        })
        .map((opp: DiscoveredRfp) => ({
          ...opp,
          // Strip expired milestones so the UI only shows future ones
          milestones: opp.milestones.filter((m) => {
            const mDate = new Date(m.date);
            return !isNaN(mDate.getTime()) && mDate >= today;
          }),
        }));

      return {
        opportunities,
        searchSummary:
          parsed.searchSummary || parsed.search_summary || "Search completed",
      };
    }
  } catch (err) {
    console.error("[RFP Search] Failed to parse response:", err);
  }

  return {
    opportunities: [],
    searchSummary:
      "Search completed but no structured results could be extracted.",
  };
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
    max_tokens: 4096,
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

  return { ...parseOpportunities(textContent, realUrls), provider: "anthropic" };
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
      instructions: systemPrompt,
      input: "Search for current open RFPs and procurement opportunities that The Content Engine should consider responding to. Be thorough in your search across multiple procurement portals.",
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

  return { ...parseOpportunities(textContent, realUrls), provider: "grok" };
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
