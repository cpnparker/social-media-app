/**
 * RFP response section templates.
 *
 * When a response is linked to an opportunity, sections are generated
 * dynamically by AI based on the RFP scope. Falls back to best-practice
 * defaults when no opportunity is linked or if AI analysis fails.
 */

import Anthropic from "@anthropic-ai/sdk";
import { TCE_COMPANY_PROFILE } from "./company-profile";

export interface RfpSection {
  id: string;
  title: string;
  order: number;
  content: string;
  status: "empty" | "generated" | "edited" | "approved";
  wordCount: number;
  guidance: string;
  targetWords: number;
}

export const DEFAULT_SECTIONS: Omit<RfpSection, "id">[] = [
  {
    title: "Executive Summary",
    order: 1,
    content: "",
    status: "empty",
    wordCount: 0,
    guidance:
      "High-level overview of The Content Engine's understanding of the opportunity, proposed approach, and key differentiators. Should capture why we are the ideal partner.",
    targetWords: 500,
  },
  {
    title: "Understanding of Requirements",
    order: 2,
    content: "",
    status: "empty",
    wordCount: 0,
    guidance:
      "Demonstrate deep understanding of the client's needs, challenges, and objectives. Reference specific requirements from the RFP.",
    targetWords: 600,
  },
  {
    title: "Company Overview & Credentials",
    order: 3,
    content: "",
    status: "empty",
    wordCount: 0,
    guidance:
      "TCE background, mission, values, key achievements, and credentials relevant to this opportunity.",
    targetWords: 400,
  },
  {
    title: "Proposed Approach & Methodology",
    order: 4,
    content: "",
    status: "empty",
    wordCount: 0,
    guidance:
      "Detailed description of how we would deliver the work. Include methodology, phases, tools, and processes.",
    targetWords: 800,
  },
  {
    title: "Team & Expertise",
    order: 5,
    content: "",
    status: "empty",
    wordCount: 0,
    guidance:
      "Key team members, their roles, qualifications, and relevant experience. Include organisational structure for the project.",
    targetWords: 500,
  },
  {
    title: "Relevant Experience & Case Studies",
    order: 6,
    content: "",
    status: "empty",
    wordCount: 0,
    guidance:
      "2-3 relevant case studies demonstrating similar work delivered. Include outcomes and client testimonials where possible.",
    targetWords: 600,
  },
  {
    title: "Content Production Capabilities",
    order: 7,
    content: "",
    status: "empty",
    wordCount: 0,
    guidance:
      "Overview of our content production capabilities — editorial, digital, social, video, design. Include quality processes and technology stack.",
    targetWords: 500,
  },
  {
    title: "Project Timeline & Milestones",
    order: 8,
    content: "",
    status: "empty",
    wordCount: 0,
    guidance:
      "Proposed timeline with key milestones, deliverables, and review points. Show realistic planning.",
    targetWords: 400,
  },
  {
    title: "Quality Assurance & Governance",
    order: 9,
    content: "",
    status: "empty",
    wordCount: 0,
    guidance:
      "Quality control processes, governance structure, reporting cadence, risk management approach.",
    targetWords: 400,
  },
  {
    title: "Budget & Pricing Structure",
    order: 10,
    content: "",
    status: "empty",
    wordCount: 0,
    guidance:
      "Pricing approach, fee structure, value proposition. Show transparency and flexibility.",
    targetWords: 300,
  },
  {
    title: "Sustainability & Impact Measurement",
    order: 11,
    content: "",
    status: "empty",
    wordCount: 0,
    guidance:
      "How we measure impact and outcomes. Our own sustainability commitments and how they align with the client's goals.",
    targetWords: 400,
  },
];

export function createDefaultSections(): RfpSection[] {
  return DEFAULT_SECTIONS.map((s, i) => ({
    ...s,
    id: `section-${i + 1}`,
  }));
}

/**
 * Use AI to analyse an RFP opportunity and generate tailored sections.
 * Combines sections the RFP explicitly asks for with best-practice sections
 * from winning responses. Falls back to defaults on failure.
 */
export async function createSectionsForOpportunity(opportunity: {
  title: string;
  organisation_name: string;
  document_scope: string | null;
  document_ai_reasoning: string | null;
  tags_sectors?: string[];
}): Promise<RfpSection[]> {
  try {
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });

    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 2048,
      system: `You are an expert RFP strategist who has won hundreds of competitive bids. You analyse RFP requirements and design the optimal response structure.

Company Profile:
${TCE_COMPANY_PROFILE}

Your job is to analyse the RFP details below and produce a tailored list of response sections. Follow these rules:

1. FIRST, include sections that directly address what the RFP explicitly asks for (e.g. if the RFP mentions "knowledge management plan", create a section for it)
2. THEN, fill in best-practice sections that winning responses always include (executive summary, understanding of requirements, team, etc.)
3. Tailor section guidance to reference the specific RFP — not generic boilerplate
4. Order sections strategically: lead with understanding and approach, end with budget and impact
5. Aim for 8-14 sections total. More specific RFPs should have more sections.
6. Assign realistic target word counts (200-800 per section, shorter for budget/timeline, longer for methodology)

Return ONLY a JSON array of objects with this exact structure:
[
  {
    "title": "Section title",
    "guidance": "Specific guidance referencing the RFP requirements — what to cover, what to emphasise",
    "targetWords": 500
  }
]

Return ONLY the JSON array, no other text.`,
      messages: [
        {
          role: "user",
          content: `Analyse this RFP and design the optimal response structure:

Title: ${opportunity.title}
Organisation: ${opportunity.organisation_name}
${opportunity.document_scope ? `Scope: ${opportunity.document_scope}` : ""}
${opportunity.document_ai_reasoning ? `Context: ${opportunity.document_ai_reasoning}` : ""}
${opportunity.tags_sectors?.length ? `Sectors: ${opportunity.tags_sectors.join(", ")}` : ""}

Design the section structure that gives us the best chance of winning this bid.`,
        },
      ],
    });

    let textContent = "";
    for (const block of response.content) {
      if (block.type === "text") {
        textContent += block.text;
      }
    }

    // Parse the AI response
    const jsonMatch = textContent.match(/\[[\s\S]*\]/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      if (Array.isArray(parsed) && parsed.length >= 3) {
        return parsed.map((s: any, i: number) => ({
          id: `section-${i + 1}`,
          title: s.title || `Section ${i + 1}`,
          order: i + 1,
          content: "",
          status: "empty" as const,
          wordCount: 0,
          guidance: s.guidance || "",
          targetWords: s.targetWords || 500,
        }));
      }
    }
  } catch (err) {
    console.error("[RFP Sections] AI section generation failed, using defaults:", err);
  }

  // Fallback to defaults
  return createDefaultSections();
}
