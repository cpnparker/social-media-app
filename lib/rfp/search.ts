/**
 * RFP Discovery — AI-powered web search for open RFPs.
 *
 * Supports two search providers:
 * 1. Anthropic (Claude) — web_search_20250305 tool
 * 2. xAI (Grok) — built-in live web search
 */

import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { TCE_COMPANY_PROFILE } from "./company-profile";

function getAnthropicClient() {
  return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });
}

function getXAIClient() {
  if (!process.env.XAI_API_KEY) {
    throw new Error("XAI_API_KEY is not set");
  }
  return new OpenAI({
    apiKey: process.env.XAI_API_KEY,
    baseURL: "https://api.x.ai/v1",
  });
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
    : "UNGM, TED (EU tenders), DevBusiness, SAM.gov, major UN agency procurement sites, World Bank procurement";

  const today = new Date().toISOString().split("T")[0];

  return `You are an RFP discovery assistant for The Content Engine. Your job is to find current, open RFPs and procurement opportunities that match our company profile.

Company Profile:
${TCE_COMPANY_PROFILE}

Today's date is ${today}.

Instructions:
1. Search for current, open RFPs and tenders that The Content Engine could respond to
2. Search across procurement portals: ${portalList}, and general web searches
3. Focus on content production, communications, sustainability, climate, thought leadership, and related services
4. CRITICAL: Only include RFPs where the deadline (or first deadline to register interest / submit expression of interest) is AFTER ${today}. Do NOT include any RFPs whose deadlines have already passed.
5. Only include RFPs with deadlines at least 2 weeks from now
6. Score each opportunity 0-100 based on relevance to our profile

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
      "sourceUrl": "URL where the RFP can be found, or null",
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

Sort by relevanceScore descending. Return only genuine, currently open opportunities.
Return ONLY the JSON object, no other text.`;
}

function parseOpportunities(textContent: string): {
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
        // Validate and sanitise sourceUrl
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

        // Extract milestones
        const milestones: DeadlineMilestone[] = (opp.milestones || [])
          .map((m: any) => ({
            type: m.type || "other",
            label: m.label || m.type || "Milestone",
            date: m.date,
          }))
          .filter((m: DeadlineMilestone) => m.date);

        return {
          title: opp.title || "Untitled",
          organisation: opp.organisation || opp.organization || "Unknown",
          deadline: opp.deadline || null,
          scope: opp.scope || "",
          relevanceScore: opp.relevanceScore || 0,
          sourceUrl: validatedUrl,
          reasoning: opp.reasoning || "",
          sectors: opp.sectors || [],
          region: opp.region || null,
          estimatedValue: opp.estimatedValue || opp.estimated_value || null,
          milestones,
        };
      });

      // Filter out any opportunities whose deadline has already passed
      const opportunities = allOpps.filter((opp: DiscoveredRfp) => {
        if (!opp.deadline) return true; // Keep if no deadline specified
        const deadlineDate = new Date(opp.deadline);
        return deadlineDate >= today;
      });

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
  for (const block of response.content) {
    if (block.type === "text") {
      textContent += block.text;
    }
  }

  return { ...parseOpportunities(textContent), provider: "anthropic" };
}

async function searchWithGrok(params: {
  query?: string;
  sectors?: string[];
  regions?: string[];
  sources?: string[];
}): Promise<SearchResult> {
  const xai = getXAIClient();
  const systemPrompt = buildSearchPrompt(params);

  const response = await xai.chat.completions.create({
    model: "grok-3",
    messages: [
      { role: "system", content: systemPrompt },
      {
        role: "user",
        content:
          "Search for current open RFPs and procurement opportunities that The Content Engine should consider responding to. Be thorough in your search across multiple procurement portals.",
      },
    ],
    max_tokens: 4096,
    temperature: 0.3,
  });

  const textContent = response.choices?.[0]?.message?.content || "";
  return { ...parseOpportunities(textContent), provider: "grok" };
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
