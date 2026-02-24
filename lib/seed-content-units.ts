/**
 * Default content unit definitions based on The Content Engine's portfolio.
 * Used to seed the workspace's CU pricing catalog.
 */
export const defaultContentUnitDefinitions: Array<{
  category: "blogs" | "video" | "animation" | "visuals" | "social" | "other";
  formatName: string;
  description: string;
  defaultContentUnits: number;
  sortOrder: number;
}> = [
  // ── Blogs & Articles ──
  {
    category: "blogs",
    formatName: "Short article (400 words)",
    description:
      "Copy for a short blog or LinkedIn article based on existing research, 2 rounds of feedback",
    defaultContentUnits: 0.5,
    sortOrder: 0,
  },
  {
    category: "blogs",
    formatName: "Article (800 words)",
    description:
      "Copy for a blog or LinkedIn article based on existing research, 2 rounds of feedback",
    defaultContentUnits: 1.0,
    sortOrder: 1,
  },
  {
    category: "blogs",
    formatName: "In-depth article (1,200 words)",
    description:
      "Copy for an in-depth blog or LinkedIn article based on existing research, 2 rounds of feedback",
    defaultContentUnits: 1.5,
    sortOrder: 2,
  },
  {
    category: "blogs",
    formatName: "Ghost-written article (800 words)",
    description:
      "Copy that captures the voice of an executive or expert, typically based on a phone interview, 2 rounds of feedback",
    defaultContentUnits: 2.0,
    sortOrder: 3,
  },
  {
    category: "blogs",
    formatName: "Newsletter (800 words)",
    description:
      "Copy for a newsletter (e.g. Mailchimp, LinkedIn) based on updates or research, 2 rounds of feedback",
    defaultContentUnits: 1.0,
    sortOrder: 4,
  },
  {
    category: "blogs",
    formatName: "Original reporting / interview add-on",
    description:
      "Preparing and holding interviews with experts and executives as an add-on to a blog post",
    defaultContentUnits: 0.5,
    sortOrder: 5,
  },

  // ── Video ──
  {
    category: "video",
    formatName: "Templated video (~1 min)",
    description:
      "Video built on a brand template with licensed footage, up to 3 animated overlays, 12 panel script, 2 rounds of feedback",
    defaultContentUnits: 0.75,
    sortOrder: 0,
  },
  {
    category: "video",
    formatName: "Expert-led social video (~1 min)",
    description:
      "Brand template video with expert interview clips, 8 panel script with ~30s soundbites, 2 rounds of feedback",
    defaultContentUnits: 1.0,
    sortOrder: 1,
  },
  {
    category: "video",
    formatName: "Hype video (~30 sec)",
    description:
      "High-octane video with fast cuts and bespoke text animation, ideal for events or announcements, 2 rounds of feedback",
    defaultContentUnits: 1.0,
    sortOrder: 2,
  },
  {
    category: "video",
    formatName: "Sting quote (~15 sec)",
    description:
      "Concise clip from interview or video with animated subtitles and emojis, per 15 seconds",
    defaultContentUnits: 0.25,
    sortOrder: 3,
  },

  // ── Animation ──
  {
    category: "animation",
    formatName: "2D animation (~30 sec)",
    description:
      "Vector-based storyboard and animation for explaining complex processes, 2 rounds of feedback at each stage",
    defaultContentUnits: 4.0,
    sortOrder: 0,
  },
  {
    category: "animation",
    formatName: "Audiogram (~30 sec)",
    description:
      "Sound bite with visual elements, animated subtitles and sound waveform, per 30 seconds",
    defaultContentUnits: 0.25,
    sortOrder: 1,
  },
  {
    category: "animation",
    formatName: "Animated graphic / GIF",
    description:
      "10-15 second motion graphic loop communicating a single message or data set",
    defaultContentUnits: 0.75,
    sortOrder: 2,
  },

  // ── Visuals ──
  {
    category: "visuals",
    formatName: "Social card — templated",
    description:
      "Fast turnaround social graphic built from a brand template, includes quote cards, thumbnails or headline cards, 2 rounds of feedback",
    defaultContentUnits: 0.2,
    sortOrder: 0,
  },
  {
    category: "visuals",
    formatName: "Social card — classic",
    description:
      "Photo-based graphic with short punchy copy, on-brand design catered to the story or message, 2 rounds of feedback",
    defaultContentUnits: 0.25,
    sortOrder: 1,
  },
  {
    category: "visuals",
    formatName: "Social card — bespoke",
    description:
      "Custom made graphic with more stylised execution and creative freedom, 2 rounds of edits",
    defaultContentUnits: 0.5,
    sortOrder: 2,
  },
  {
    category: "visuals",
    formatName: "Carousel — templated (4 panels)",
    description:
      "Editorial style format with text & images using a pre-agreed template, 2 rounds of feedback",
    defaultContentUnits: 0.75,
    sortOrder: 3,
  },
  {
    category: "visuals",
    formatName: "Carousel — bespoke (4 panels)",
    description:
      "Mix of illustration, image treatment and graphs or non-standard typography, 2 rounds of feedback",
    defaultContentUnits: 1.0,
    sortOrder: 4,
  },
  {
    category: "visuals",
    formatName: "Infographic (simple, x4)",
    description:
      "Simple infographic with one piece of text/icon, batch of 4",
    defaultContentUnits: 1.0,
    sortOrder: 5,
  },
  {
    category: "visuals",
    formatName: "Poster",
    description:
      "Sheet with detailed information and ornate design for print, email, blog posts and social",
    defaultContentUnits: 1.5,
    sortOrder: 6,
  },
  {
    category: "visuals",
    formatName: "Campaign suite",
    description:
      "Briefing meeting, 2 design options for campaign look & feel, suite of 3 assets",
    defaultContentUnits: 1.0,
    sortOrder: 7,
  },

  // ── Social ──
  {
    category: "social",
    formatName: "Social post (promote existing content)",
    description:
      "Suggested social copy to promote content we've produced, 1 post = 1 channel, ~100 words",
    defaultContentUnits: 0.05,
    sortOrder: 0,
  },
  {
    category: "social",
    formatName: "Social post (original, with research)",
    description:
      "Ideas from latest news, text-based social post with copy, 1 round of feedback, hashtags and tags, ~100 words",
    defaultContentUnits: 0.1,
    sortOrder: 1,
  },
  {
    category: "social",
    formatName: "Long LinkedIn post",
    description:
      "In-depth social copy up to 200 words, 1 round of feedback, proposed accounts to tag",
    defaultContentUnits: 0.25,
    sortOrder: 2,
  },

  // ── Other ──
  {
    category: "other",
    formatName: "Bespoke social analytics report",
    description:
      "Custom performance report with corrective actions, includes 45-min scoping meeting and 1-hour review session",
    defaultContentUnits: 1.0,
    sortOrder: 0,
  },
  {
    category: "other",
    formatName: "Remote event monitoring (per day)",
    description:
      "Extensive monitoring of an event/livestream, key takeaways and quotes for content production",
    defaultContentUnits: 1.5,
    sortOrder: 1,
  },
];
