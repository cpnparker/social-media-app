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
}

export const DESIGN_MODELS: VideoModelDescriptor[] = [
  { id: "higgsfield", name: "Higgsfield",   tag: "Cinematic motion · character lock", strength: "Camera moves, character consistency", weakness: "Slower · 24s/shot", status: "coming-soon" },
  { id: "runway-g4",  name: "Runway Gen-4", tag: "Image-to-video · text-to-video",     strength: "Tight prompt control",          weakness: "Camera less filmic", status: "live" },
  { id: "veo-3",      name: "Veo 3",        tag: "Long takes, ambient motion",         strength: "Long coherent takes",            weakness: "Limited stylization", status: "coming-soon" },
  { id: "kling-2",    name: "Kling 2",      tag: "Stylized motion · physics",          strength: "Physics, water, fabric",         weakness: "Faces drift", status: "coming-soon" },
  { id: "sora-2",     name: "Sora 2",       tag: "Reference scenes · narrative",       strength: "Story-aware composition",        weakness: "Quota limited", status: "coming-soon" },
  { id: "dalle-3",    name: "DALL·E 3",     tag: "Stills",                              strength: "Type & graphic stills",          weakness: "No motion", status: "live" },
  { id: "gpt-img-1",  name: "gpt-image-1",  tag: "Stills · reference matching",        strength: "Match brand references",         weakness: "No motion", status: "live" },
  { id: "grok-img",   name: "Grok Imagine", tag: "Stills · loose",                      strength: "Fast iteration",                 weakness: "Less brand-faithful", status: "live" },
];

/** Beat helpers for the storyboard view */
export const DEFAULT_BEATS = ["Foundation", "Conviction", "Horizon", "Return"];
