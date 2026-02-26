import { NextRequest, NextResponse } from "next/server";

// Common filler words to exclude from keyword extraction
const STOP_WORDS = new Set([
  "the", "a", "an", "and", "or", "but", "in", "on", "at", "to", "for",
  "of", "with", "by", "from", "is", "are", "was", "were", "be", "been",
  "being", "have", "has", "had", "do", "does", "did", "will", "would",
  "could", "should", "may", "might", "can", "this", "that", "these",
  "those", "it", "its", "not", "no", "how", "what", "when", "where",
  "who", "which", "why", "about", "into", "through", "during", "before",
  "after", "above", "below", "between", "out", "off", "over", "under",
  "again", "further", "then", "once", "here", "there", "all", "each",
  "every", "both", "few", "more", "most", "other", "some", "such",
  "than", "too", "very", "just", "also", "new", "our", "your", "their",
]);

function extractKeywords(title: string, description?: string): string[] {
  const text = `${title} ${description || ""}`.toLowerCase();
  const words = text
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 3 && !STOP_WORDS.has(w));

  // Get unique meaningful words
  const unique = Array.from(new Set(words));

  // Build diverse search queries from the keywords
  const queries: string[] = [];

  // Full title (truncated)
  const titleWords = title.split(" ").filter((w) => w.length > 2).slice(0, 4);
  if (titleWords.length >= 2) queries.push(titleWords.join(" "));

  // Pairs of keywords
  for (let i = 0; i < unique.length - 1 && queries.length < 4; i++) {
    queries.push(`${unique[i]} ${unique[i + 1]}`);
  }

  // Single keywords with visual modifiers
  const modifiers = ["abstract", "professional", "creative", "modern", "aerial", "closeup"];
  for (let i = 0; i < unique.length && queries.length < 6; i++) {
    const mod = modifiers[queries.length % modifiers.length];
    queries.push(`${unique[i]} ${mod}`);
  }

  // Pad with generic professional stock photo terms if needed
  const fallbacks = [
    "business strategy", "digital innovation", "team collaboration",
    "creative workspace", "technology future", "professional meeting",
  ];
  while (queries.length < 6) {
    queries.push(fallbacks[queries.length % fallbacks.length]);
  }

  return queries.slice(0, 6);
}

// POST /api/image-suggestions — generates image search terms, returns Unsplash thumbnail URLs
export async function POST(req: NextRequest) {
  try {
    const { title, description } = await req.json();

    if (!title) {
      return NextResponse.json({ error: "Title is required" }, { status: 400 });
    }

    let keywords: string[] = [];

    // Try AI-powered keyword generation if available
    try {
      const aiRes = await fetch(new URL("/api/ai", req.url), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "generate",
          topic: `You are helping find stock photos for a content piece. Title: "${title}". ${description ? `Description: ${description.substring(0, 300)}` : ""}

Generate exactly 6 different stock photo search queries that would make great cover images for this content. Each query should be 2-4 words, visually descriptive, and represent a different angle or concept related to the topic.

Return ONLY a JSON array of 6 strings, nothing else. Example: ["sunset cityscape","business meeting","laptop workspace","coffee brainstorm","creative planning","team collaboration"]`,
          platform: "internal",
        }),
      });

      if (aiRes.ok) {
        const aiData = await aiRes.json();
        if (aiData.content) {
          try {
            const parsed = JSON.parse(aiData.content.trim());
            if (Array.isArray(parsed)) {
              keywords = parsed.slice(0, 6).map((k: string) => String(k).trim());
            }
          } catch {
            keywords = aiData.content
              .replace(/[\[\]"]/g, "")
              .split(",")
              .map((k: string) => k.trim())
              .filter(Boolean)
              .slice(0, 6);
          }
        }
      }
    } catch {
      // AI unavailable — fall through to keyword extraction
    }

    // Fallback: extract keywords from title/description
    if (keywords.length === 0) {
      keywords = extractKeywords(title, description);
    }

    // Build suggestions with Lorem Picsum for preview thumbnails (seed-based for consistency)
    const suggestions = keywords.map((keyword, i) => {
      // Use a hash of the keyword as seed so the same keyword always shows the same image
      const seed = keyword.replace(/\s+/g, "-").toLowerCase();
      return {
        keyword,
        thumbnailUrl: `https://picsum.photos/seed/${encodeURIComponent(seed)}/400/300`,
        searchUrl: `https://unsplash.com/s/photos/${encodeURIComponent(keyword)}`,
      };
    });

    return NextResponse.json({ suggestions });
  } catch (error: any) {
    console.error("Image suggestions error:", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
