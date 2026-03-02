import { NextRequest, NextResponse } from "next/server";

const PEXELS_API_KEY = process.env.PEXELS_API_KEY;
const PIXABAY_API_KEY = process.env.PIXABAY_API_KEY;
const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY;
const GOOGLE_CSE_ID = process.env.GOOGLE_CSE_ID;

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
  "test", "testing", "example", "idea", "content", "article", "video",
  "post", "social", "media", "write", "create",
]);

// Topic-to-visual mapping for common content themes
const VISUAL_THEMES: Record<string, string[]> = {
  climate: ["climate change landscape", "renewable energy solar", "melting glacier arctic", "green forest canopy", "wind turbines field", "drought cracked earth"],
  sustainability: ["sustainable farming aerial", "solar panel rooftop", "electric vehicle charging", "recycling plant", "organic garden", "green city park"],
  plastic: ["ocean plastic pollution", "beach cleanup volunteers", "sea turtle underwater", "plastic bottles waste", "coral reef healthy", "mangrove shoreline"],
  technology: ["circuit board macro", "server room data", "smartphone screen", "coding laptop screen", "robot arm factory", "satellite earth orbit"],
  aviation: ["airplane wing clouds", "airport runway sunset", "jet engine closeup", "cockpit instruments", "airplane contrails sky", "aircraft hangar"],
  fuel: ["fuel pipeline industrial", "oil refinery night", "gas station pumps", "biofuel plant", "wind farm ocean", "hydrogen fuel cell"],
  energy: ["solar farm desert", "wind turbines sunset", "power grid pylons", "hydroelectric dam", "nuclear plant cooling", "geothermal springs"],
  ocean: ["ocean waves aerial", "deep sea underwater", "fishing boat harbour", "coral reef marine", "whale underwater", "lighthouse coast"],
  health: ["hospital corridor", "doctor patient", "medical research lab", "stethoscope closeup", "wellness nature walk", "healthy food plate"],
  cyber: ["cybersecurity lock screen", "hacker code screen", "network server room", "digital fingerprint", "encryption padlock", "firewall protection"],
  finance: ["stock market trading", "city skyline financial", "coins growth chart", "banking vault", "cryptocurrency bitcoin", "investment chart"],
  food: ["fresh produce market", "farm harvest field", "restaurant kitchen chef", "food supply chain", "organic vegetables", "sustainable agriculture"],
  ai: ["robot humanoid face", "neural network brain", "chatbot digital screen", "person talking computer", "artificial intelligence chip", "human robot interaction"],
  leadership: ["podium speaker conference", "business meeting team", "handshake partnership", "office strategy whiteboard", "ceo portrait professional", "boardroom discussion"],
  diversity: ["diverse team meeting", "multicultural crowd city", "inclusive workplace group", "people different backgrounds", "community gathering hands", "global unity diverse"],
};

function extractKeywords(title: string, description?: string, tags?: string[]): string[] {
  const allTags = tags || [];
  const text = `${title} ${description || ""} ${allTags.join(" ")}`.toLowerCase();
  const words = text
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 3 && !STOP_WORDS.has(w));

  const unique = Array.from(new Set(words));

  // Check if any words match known visual themes
  for (const word of unique) {
    for (const [theme, visuals] of Object.entries(VISUAL_THEMES)) {
      if (word.includes(theme) || theme.includes(word)) {
        return visuals.slice(0, 6);
      }
    }
  }

  const queries: string[] = [];
  const ranked = unique.sort((a, b) => b.length - a.length);

  for (let i = 0; i < ranked.length - 1 && queries.length < 3; i++) {
    queries.push(`${ranked[i]} ${ranked[i + 1]}`);
  }

  for (const tag of allTags) {
    if (queries.length >= 6) break;
    const tagClean = tag.toLowerCase().replace(/[^a-z0-9\s]/g, "").trim();
    if (tagClean.length > 2 && !queries.some((q) => q.includes(tagClean))) {
      queries.push(tagClean);
    }
  }

  for (let i = 0; i < ranked.length && queries.length < 6; i++) {
    if (!queries.some((q) => q.includes(ranked[i]))) {
      queries.push(ranked[i]);
    }
  }

  const titleWords = title.split(" ").filter((w) => w.length > 2).slice(0, 3);
  if (queries.length < 6 && titleWords.length >= 2) {
    queries.push(titleWords.join(" "));
  }

  while (queries.length < 6) {
    queries.push(unique[queries.length % unique.length] || "editorial photography");
  }

  return queries.slice(0, 6);
}

// ── Sanitize AI keywords: strip newlines, emojis, extra text ──
function sanitizeKeyword(kw: string): string {
  return kw
    .split("\n")[0]            // Only the first line
    .replace(/[^\w\s-]/g, " ") // Strip non-word chars (includes emojis)
    .replace(/\s+/g, " ")
    .trim()
    .substring(0, 50);         // Max 50 chars
}

// ── Search Pexels (requires PEXELS_API_KEY env var) ──
async function searchPexels(query: string): Promise<{ url: string; photographer: string } | null> {
  if (!PEXELS_API_KEY) return null;
  try {
    const res = await fetch(
      `https://api.pexels.com/v1/search?query=${encodeURIComponent(query)}&per_page=3&orientation=landscape`,
      { headers: { Authorization: PEXELS_API_KEY }, signal: AbortSignal.timeout(5000) }
    );
    if (!res.ok) return null;
    const data = await res.json();
    const photo = data.photos?.[0];
    if (!photo) return null;
    return { url: photo.src.medium, photographer: photo.photographer };
  } catch {
    return null;
  }
}

// ── Search Pixabay (requires PIXABAY_API_KEY env var) ──
async function searchPixabay(query: string): Promise<string | null> {
  if (!PIXABAY_API_KEY) return null;
  try {
    const res = await fetch(
      `https://pixabay.com/api/?key=${PIXABAY_API_KEY}&q=${encodeURIComponent(query)}&image_type=photo&orientation=horizontal&per_page=3&safesearch=true`,
      { signal: AbortSignal.timeout(5000) }
    );
    if (!res.ok) return null;
    const data = await res.json();
    return data.hits?.[0]?.webformatURL || null;
  } catch {
    return null;
  }
}

// ── Search Wikimedia Commons (free, no API key needed, returns relevant images) ──
async function searchWikimedia(query: string): Promise<string | null> {
  try {
    const searchTerm = query.split(" ").slice(0, 3).join(" ");
    const queryWords = searchTerm.toLowerCase().split(" ").filter((w) => w.length > 2);
    // Request more results so we can filter for relevance
    const url = `https://commons.wikimedia.org/w/api.php?action=query&generator=search&gsrsearch=${encodeURIComponent(searchTerm + " photograph")}&gsrlimit=15&gsrnamespace=6&prop=imageinfo&iiprop=url&iiurlwidth=400&format=json&origin=*`;
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return null;
    const data = await res.json();
    const pages = data.query?.pages;
    if (!pages) return null;

    const pageArray = Object.values(pages) as any[];

    // Score each result by keyword relevance in the title
    const scored = pageArray
      .filter((p: any) => {
        const thumb = p.imageinfo?.[0]?.thumburl;
        if (!thumb) return false;
        const lower = thumb.toLowerCase();
        // Must be a raster photo format
        if (!(lower.includes(".jpg") || lower.includes(".jpeg") || lower.includes(".png"))) return false;
        // Skip tiny thumbnails
        if (lower.includes("120px") || lower.includes("100px") || lower.includes("50px")) return false;
        return true;
      })
      .map((p: any) => {
        const title = (p.title || "").toLowerCase();
        // Count how many query words appear in the file title
        const matchCount = queryWords.filter((w) => title.includes(w)).length;
        return { page: p, matchCount };
      })
      // Prefer results where the title matches more query words
      .sort((a, b) => b.matchCount - a.matchCount);

    if (scored.length === 0) return null;
    return scored[0].page.imageinfo[0].thumburl;
  } catch {
    return null;
  }
}

// ── Google Custom Search Images (requires GOOGLE_API_KEY + GOOGLE_CSE_ID) ──
async function searchGoogle(query: string): Promise<string | null> {
  if (!GOOGLE_API_KEY || !GOOGLE_CSE_ID) return null;
  try {
    const url = `https://www.googleapis.com/customsearch/v1?key=${GOOGLE_API_KEY}&cx=${GOOGLE_CSE_ID}&q=${encodeURIComponent(query)}&searchType=image&num=3&imgSize=medium&safe=active`;
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return null;
    const data = await res.json();
    const item = data.items?.[0];
    return item?.link || null;
  } catch {
    return null;
  }
}

// ── Fetch image for a keyword using the best available source ──
async function fetchImageForKeyword(keyword: string, index: number): Promise<{ url: string; photographer?: string }> {
  // Fire all available sources in parallel — use the best one that returns
  const [pexels, google, pixabay, wiki] = await Promise.all([
    searchPexels(keyword),
    searchGoogle(keyword),
    searchPixabay(keyword),
    searchWikimedia(keyword),
  ]);

  // Priority: Pexels > Google > Pixabay > Wikimedia > placeholder
  if (pexels) return { url: pexels.url, photographer: pexels.photographer };
  if (google) return { url: google };
  if (pixabay) return { url: pixabay };
  if (wiki) return { url: wiki };
  return { url: `https://placehold.co/400x300/1a1a2e/94a3b8?text=${encodeURIComponent(keyword.split(" ").slice(0, 3).join(" "))}` };
}

// POST /api/image-suggestions
export async function POST(req: NextRequest) {
  try {
    const { title, description, tags } = await req.json();

    if (!title) {
      return NextResponse.json({ error: "Title is required" }, { status: 400 });
    }

    let keywords: string[] = [];

    const allTags = Array.isArray(tags) ? tags : [];
    const tagContext = allTags.length > 0 ? `\nTags/topics: ${allTags.join(", ")}` : "";

    // ── AI-powered keyword generation ──
    try {
      const aiRes = await fetch(new URL("/api/ai", req.url), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "generate",
          topic: `You are a photo editor choosing cover images for a content piece.

Title: "${title}"
${description ? `Description: ${description.substring(0, 600)}` : ""}${tagContext}

Generate exactly 6 stock photo search queries that would work as a compelling cover image.

Rules:
- Each query should be 2-3 words describing a VISUAL SCENE or SUBJECT (not abstract concepts)
- Focus on what the CAMERA would see: objects, settings, people, landscapes, actions
- Be specific to the actual topic — avoid generic business/tech imagery
- Each query should offer a different visual angle on the topic
- Think editorially: what image would a magazine use for this story?
- Keep queries SHORT (2-3 words max) for better stock photo search results

Return ONLY a JSON array of 6 strings, nothing else. No explanation. Example: ["ocean plastic debris","sea turtle underwater","beach cleanup","plastic bottle shore","coral reef damage","fishing net ocean"]`,
          platform: "internal",
        }),
      });

      if (aiRes.ok) {
        const aiData = await aiRes.json();
        if (aiData.content) {
          try {
            // Extract JSON array from response (may have extra text around it)
            const jsonMatch = aiData.content.match(/\[[\s\S]*?\]/);
            if (jsonMatch) {
              const parsed = JSON.parse(jsonMatch[0]);
              if (Array.isArray(parsed)) {
                keywords = parsed
                  .slice(0, 6)
                  .map((k: string) => sanitizeKeyword(String(k)))
                  .filter((k) => k.length > 0);
              }
            }
          } catch {
            // Try comma-split fallback
            const content = aiData.content.split("\n")[0]; // First line only
            keywords = content
              .replace(/[\[\]"`]/g, "")
              .split(",")
              .map((k: string) => sanitizeKeyword(k))
              .filter((k: string) => k.length > 0)
              .slice(0, 6);
          }
        }
      }
    } catch {
      // AI unavailable — fall through to keyword extraction
    }

    // Fallback: extract keywords from title/description/tags
    if (keywords.length === 0) {
      keywords = extractKeywords(title, description, allTags);
    }

    // Ensure we have exactly 6
    while (keywords.length < 6) {
      keywords.push(keywords[keywords.length % keywords.length] || "editorial photo");
    }
    keywords = keywords.slice(0, 6);

    // ── Fetch real images for all keywords in parallel ──
    const imageResults = await Promise.all(keywords.map((kw, i) => fetchImageForKeyword(kw, i)));

    const suggestions = keywords.map((keyword, i) => ({
      keyword,
      thumbnailUrl: imageResults[i].url,
      searchUrl: PEXELS_API_KEY
        ? `https://www.pexels.com/search/${encodeURIComponent(keyword)}/`
        : `https://unsplash.com/s/photos/${encodeURIComponent(keyword)}`,
      ...(imageResults[i].photographer ? { photographer: imageResults[i].photographer } : {}),
    }));

    return NextResponse.json({ suggestions });
  } catch (error: any) {
    console.error("Image suggestions error:", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
