/**
 * Session templates — pre-built shot sequences for common design briefs.
 *
 * A designer landing in /design with no shots can pick one of these to skip
 * the blank-page problem. Each template creates N shots with sensible defaults
 * (title, beat, duration, model, prompt seed) so the user can iterate from a
 * concrete starting point.
 */

export interface SessionTemplateShotSeed {
  title: string;
  beat?: string;
  duration: number;
  modelId: string;
  prompt: string;
}

export interface SessionTemplate {
  id: string;
  name: string;
  description: string;
  icon: "image" | "video" | "carousel" | "reel" | "broll";
  shots: SessionTemplateShotSeed[];
}

export const SESSION_TEMPLATES: SessionTemplate[] = [
  {
    id: "hero-image",
    name: "Hero image",
    description: "One on-brand still for the top of an article or social post.",
    icon: "image",
    shots: [
      {
        title: "Hero image",
        duration: 5,
        modelId: "gpt-img-1",
        prompt: "Editorial hero image · single strong focal point · high-contrast composition · landscape framing · brand palette",
      },
    ],
  },
  {
    id: "social-carousel",
    name: "Social carousel · 5 tiles",
    description: "LinkedIn / Instagram carousel — opening hook, three supporting tiles, closing CTA.",
    icon: "carousel",
    shots: [
      { title: "Tile 1 · Opening hook", beat: "Hook", duration: 4, modelId: "gpt-img-1", prompt: "Carousel tile 1: bold one-line headline as the visual focus · brand palette · square (1:1)" },
      { title: "Tile 2 · Supporting point", beat: "Support", duration: 4, modelId: "gpt-img-1", prompt: "Carousel tile 2: visual support for the headline · one strong image · brand palette · square" },
      { title: "Tile 3 · Supporting point", beat: "Support", duration: 4, modelId: "gpt-img-1", prompt: "Carousel tile 3: continuation of the visual story · same composition style as tile 2 · square" },
      { title: "Tile 4 · Supporting point", beat: "Support", duration: 4, modelId: "gpt-img-1", prompt: "Carousel tile 4: third supporting visual · variation in subject, same palette · square" },
      { title: "Tile 5 · Call to action", beat: "CTA", duration: 4, modelId: "gpt-img-1", prompt: "Carousel tile 5: clear CTA visual · brand wordmark close · square" },
    ],
  },
  {
    id: "brand-film-60s",
    name: "Brand film · 60s",
    description: "Four-beat narrative film: foundation → conviction → horizon → return. Six shots.",
    icon: "video",
    shots: [
      { title: "Opening landscape", beat: "Foundation", duration: 6, modelId: "runway-g4-5", prompt: "Wide cinematic landscape opening · golden hour · patient camera · anamorphic" },
      { title: "Detail · texture", beat: "Foundation", duration: 4, modelId: "runway-g4-5", prompt: "Macro detail shot · texture / material / atmosphere · shallow depth · subtle motion" },
      { title: "Portrait · spokesperson", beat: "Conviction", duration: 10, modelId: "runway-g4-5", prompt: "Medium portrait · soft window light · subject delivers a single line · locked camera" },
      { title: "Wide · ambition", beat: "Horizon", duration: 8, modelId: "runway-g4-5", prompt: "Wide horizon shot · long take · slow camera movement · no foreground objects" },
      { title: "Detail · hands / craft", beat: "Return", duration: 5, modelId: "runway-g4-5", prompt: "Close-up of hands at work · soft directional light · subtle motion" },
      { title: "Wordmark close", beat: "Return", duration: 4, modelId: "dalle-3", prompt: "Brand wordmark on clean background · generous negative space · kerning locked" },
    ],
  },
  {
    id: "reel-intro",
    name: "Reel / Story intro · 9:16",
    description: "Single 5s portrait clip designed for Instagram Reels and TikTok.",
    icon: "reel",
    shots: [
      {
        title: "Reel intro",
        duration: 5,
        modelId: "runway-g4-5",
        prompt: "5-second cinematic intro · portrait 9:16 · grabs attention in the first second · brand palette · patient camera",
      },
    ],
  },
  {
    id: "broll-set",
    name: "B-roll set · 3 clips",
    description: "Three short coverage clips for cutaways and inserts.",
    icon: "broll",
    shots: [
      { title: "B-roll · environment", beat: "Cover", duration: 5, modelId: "runway-g4-5", prompt: "Establishing environment shot · ambient motion · no people · brand atmosphere" },
      { title: "B-roll · detail", beat: "Cover", duration: 4, modelId: "runway-g4-5", prompt: "Close-up detail · shallow depth · subtle motion · brand palette" },
      { title: "B-roll · texture", beat: "Cover", duration: 4, modelId: "runway-g4-5", prompt: "Texture / pattern · slow drift · ambient · no subject" },
    ],
  },
];

export function findTemplate(id: string): SessionTemplate | undefined {
  return SESSION_TEMPLATES.find((t) => t.id === id);
}
