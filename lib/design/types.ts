/**
 * Engine AI Design Mode v2 — shared TypeScript types.
 *
 * These mirror the API response shapes returned by /api/design/* routes.
 */

export interface DesignSession {
  id: string;
  workspaceId: string;
  userCreated: number;
  name: string;
  visibility: "private" | "team";
  isIncognito: boolean;
  timelineShape: "tracks" | "storyboard" | "graph";
  currentShotId: string | null;
  clientId: number | null;
  contentId: number | null;
  brandKitSnapshotId?: string | null;
  myPermission: "owner" | "view" | "collaborate";
  createdAt: string;
  updatedAt: string;
  sharedWithMe?: boolean;
  clientName?: string | null;
}

export interface VisualIdentity {
  primary?: Array<{ name: string; hex: string }>;
  secondary?: Array<{ name: string; hex: string }>;
  primary_colors?: string[];
  secondary_colors?: string[];
  typography?: { headline?: string; body?: string; display?: string; mono?: string };
  voice?: string;
  tone_visual?: string[];
  dos?: string[];
  donts?: string[];
  do?: string[];
  dont?: string[];
  logo_urls?: string[];
  reference_image_urls?: string[];
  fallback_prose?: string;
}

export interface DesignBrandKit {
  id: string;
  versionTag: string;
  visualIdentity: VisualIdentity;
}

export type ShotStatus = "queued" | "generating" | "review" | "approved" | "drift";

export interface DesignShotVersion {
  id: string;
  idx: number;
  assetId: string | null;
  assetUrl: string | null;
  assetType: "image" | "video" | "document" | "artlist_video" | null;
  promptUsed: string | null;
  modelId: string | null;
  metadata: Record<string, any>;
  createdAt: string;
}

export interface DesignShotReference {
  id: string;
  idx: number;
  assetId: string | null;
  assetUrl: string | null;
  externalUrl: string | null;
  seedLocked: boolean;
  caption: string | null;
}

export interface DesignShot {
  id: string;
  idx: number;
  title: string;
  beat: string | null;
  duration: number;
  modelId: string | null;
  modelNote: string | null;
  status: ShotStatus;
  onBrand: boolean;
  prompt: string | null;
  promptOverrides?: Record<string, any>;
  note: string | null;
  seedValue?: string | null;
  seedLockedFrom?: string | null;
  currentVersionId: string | null;
  versions: DesignShotVersion[];
  refs: DesignShotReference[];
  /** Optional UI-only hint for placeholder gradient hue. */
  thumbHue?: number;
  thumbLabel?: string;
}

export interface DesignTrackClip {
  id: string;
  shotId: string | null;
  assetId: string | null;
  startSec: number;
  durationSec: number;
  inOffsetSec: number;
  outOffsetSec: number;
  metadata: Record<string, any>;
}

export type TrackKind = "title" | "video" | "overlay" | "voice" | "music" | "ambience";

export interface DesignTrack {
  id: string;
  kind: TrackKind;
  idx: number;
  label: string;
  clips: DesignTrackClip[];
}

export interface DesignClient {
  id: number;
  name: string;
  industry: string | null;
}

export interface DesignContent {
  id: number;
  title: string | null;
  type: string | null;
  brief: string | null;
  owner: string | null;
  dueDate: string | null;
  pillar: string | null;
}

export interface DesignSessionFull {
  session: DesignSession;
  brandKit: DesignBrandKit | null;
  shots: DesignShot[];
  tracks: DesignTrack[];
  client: DesignClient | null;
  content: DesignContent | null;
}

/** Video model registry entry — for the inspector model picker. */
export interface VideoModelDescriptor {
  id: string;
  name: string;
  tag: string;
  strength: string;
  weakness: string;
  status: "live" | "coming-soon";
  /** Which integration handles this. Most video models route through Runway's
   *  unified API now (Veo / Kling / Seedance / Gen-4.5 are all there). */
  provider: "runway" | "openai-image" | "xai-image" | "higgsfield" | "sora";
  /** When provider="runway", the model string passed to the Runway API. */
  runwayModel?: string;
}

export const DESIGN_MODELS: VideoModelDescriptor[] = [
  // ── Video — all routed through Runway's unified API ──
  { id: "runway-g4-5",        name: "Runway Gen-4.5", tag: "Image-to-video · text-to-video",      strength: "Tight prompt control",         weakness: "Camera less filmic",         status: "live", provider: "runway", runwayModel: "gen4.5" },
  { id: "runway-g3a",         name: "Runway Gen-3 Alpha", tag: "Earlier Runway · faster",         strength: "Quicker iterations",           weakness: "Lower fidelity",             status: "live", provider: "runway", runwayModel: "gen3a_turbo" },
  { id: "veo-3-1",            name: "Veo 3.1",        tag: "Google Veo · long takes",              strength: "Long coherent takes, audio",   weakness: "Pricier per second",         status: "live", provider: "runway", runwayModel: "veo3.1" },
  { id: "veo-3-1-fast",       name: "Veo 3.1 Fast",   tag: "Veo · faster, slightly lower fidelity", strength: "Speed / cost balance",        weakness: "Less detail than full Veo",  status: "live", provider: "runway", runwayModel: "veo3.1_fast" },
  { id: "kling-3-pro",        name: "Kling 3 Pro",    tag: "Stylized motion · physics",            strength: "Water, fabric, physics",       weakness: "Faces can drift",            status: "live", provider: "runway", runwayModel: "kling3.0_pro" },
  { id: "kling-2-5-turbo",    name: "Kling 2.5 Turbo Pro", tag: "Kling · fast & cheap",            strength: "Speed / motion balance",       weakness: "Less photoreal",             status: "live", provider: "runway", runwayModel: "kling2.5_turbo_pro" },
  { id: "seedance-2",         name: "Seedance 2",     tag: "ByteDance · reference scenes",         strength: "Composition control",          weakness: "Newer · less battle-tested", status: "live", provider: "runway", runwayModel: "seedance2" },
  // Models not yet routable through Runway
  { id: "higgsfield",         name: "Higgsfield",     tag: "Cinematic · character lock · lip-sync", strength: "Character carry, lip-sync",   weakness: "Direct API, separate key",   status: "coming-soon", provider: "higgsfield" },
  { id: "sora-2",             name: "Sora 2",         tag: "Reference scenes · narrative",         strength: "Story-aware composition",      weakness: "OpenAI direct, quota-gated",  status: "coming-soon", provider: "sora" },
  // ── Image ──
  { id: "dalle-3",            name: "DALL·E 3",       tag: "Stills · classic",                     strength: "Type & graphic stills",        weakness: "No motion",                  status: "live", provider: "openai-image" },
  { id: "gpt-img-1",          name: "gpt-image-1",    tag: "Stills · reference matching",          strength: "Match brand references",       weakness: "No motion",                  status: "live", provider: "openai-image" },
  { id: "grok-img",           name: "Grok Imagine",   tag: "Stills · loose",                       strength: "Fast iteration",               weakness: "Less brand-faithful",        status: "live", provider: "xai-image" },
];

/** Backwards-compat alias — existing shots may have `runway-g4` set. */
export const LEGACY_MODEL_ALIASES: Record<string, string> = {
  "runway-g4": "runway-g4-5",
  "runway-g3-alpha": "runway-g3a",
  "veo-3": "veo-3-1",
  "kling-2": "kling-2-5-turbo",
};

/** Beat helpers for the storyboard view */
export const DEFAULT_BEATS = ["Foundation", "Conviction", "Horizon", "Return"];
