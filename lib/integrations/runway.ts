/**
 * Runway API wrapper — text-to-video and image-to-video.
 *
 * Docs: https://docs.dev.runwayml.com/
 *
 * Auth: Bearer token via `RUNWAY_API_KEY`.
 * Async pattern: create a task → poll until SUCCEEDED → download mp4.
 *
 * We use Gen-4 Turbo as the default — best quality/cost ratio for v1.
 */

const RUNWAY_BASE_URL = "https://api.dev.runwayml.com/v1";
const RUNWAY_API_VERSION = "2024-11-06"; // header X-Runway-Version

/**
 * Runway hosts a unified set of video models through their API — recent
 * additions include Veo, Kling, and Seedance alongside the original Gen
 * series. As of Q1 2026 the valid model strings are:
 *   - gen4.5, gen3a_turbo (Runway native)
 *   - veo3, veo3.1, veo3.1_fast (Google Veo)
 *   - kling2.5_turbo_pro, kling3.0_pro, kling3.0_standard, klingO3_pro, klingO3_standard
 *   - seedance2 (ByteDance)
 */
export type RunwayModel =
  | "gen4.5"
  | "gen3a_turbo"
  | "veo3"
  | "veo3.1"
  | "veo3.1_fast"
  | "kling2.5_turbo_pro"
  | "kling3.0_pro"
  | "kling3.0_standard"
  | "klingO3_pro"
  | "klingO3_standard"
  | "seedance2";
export type RunwayRatio =
  | "1280:720"
  | "720:1280"
  | "1024:1024"
  | "1104:832"
  | "832:1104";

export interface RunwayTaskResponse {
  id: string;
  status: "PENDING" | "RUNNING" | "SUCCEEDED" | "FAILED" | "CANCELLED" | "THROTTLED";
  progress?: number; // 0..1
  output?: string[]; // signed mp4 URLs
  failure?: string;
  failureCode?: string;
}

export interface RunwayGenerateOptions {
  /** Motion / scene prompt. */
  prompt: string;
  /** Optional reference image URL (publicly accessible). Triggers image-to-video. */
  imageUrl?: string;
  /** Clip duration in seconds. Gen-4 Turbo supports 5 or 10. */
  duration?: 5 | 10;
  /** Output aspect ratio. Default 1280:720. */
  ratio?: RunwayRatio;
  /** Model variant. Default gen4.5. */
  model?: RunwayModel;
  /** Random seed for reproducibility. */
  seed?: number;
  /** Poll interval ms. Default 2000. */
  pollIntervalMs?: number;
  /** Max poll attempts. Default 150 (≈5min at 2s). */
  maxPollAttempts?: number;
  /** Called on every poll with the latest progress (0..1). */
  onProgress?: (progress: number, status: RunwayTaskResponse["status"]) => void;
}

function getRunwayKey(): string {
  const key = process.env.RUNWAY_API_KEY?.trim();
  if (!key) {
    throw new Error(
      "RUNWAY_API_KEY environment variable is not set. Add it to use video generation."
    );
  }
  return key;
}

function runwayHeaders(): Record<string, string> {
  return {
    Authorization: `Bearer ${getRunwayKey()}`,
    "X-Runway-Version": RUNWAY_API_VERSION,
    "Content-Type": "application/json",
  };
}

/** Create a Runway generation task and poll until it completes. */
export async function generateRunwayVideo(
  opts: RunwayGenerateOptions
): Promise<{ videoUrl: string; durationSec: number; model: RunwayModel; ratio: RunwayRatio; runwayTaskId: string }> {
  const model: RunwayModel = opts.model ?? "gen4.5";
  const ratio: RunwayRatio = opts.ratio ?? "1280:720";
  const duration: 5 | 10 = opts.duration ?? 5;

  // 1. Create task
  const endpoint = opts.imageUrl
    ? `${RUNWAY_BASE_URL}/image_to_video`
    : `${RUNWAY_BASE_URL}/text_to_video`;

  const body: Record<string, unknown> = {
    model,
    promptText: opts.prompt,
    ratio,
    duration,
  };
  if (opts.imageUrl) body.promptImage = opts.imageUrl;
  if (opts.seed != null) body.seed = opts.seed;

  console.log(`[Runway] Creating ${opts.imageUrl ? "image_to_video" : "text_to_video"} task: model=${model}, dur=${duration}s, ratio=${ratio}`);

  const createRes = await fetch(endpoint, {
    method: "POST",
    headers: runwayHeaders(),
    body: JSON.stringify(body),
  });

  if (!createRes.ok) {
    const errText = await createRes.text().catch(() => "");
    throw new Error(`Runway create failed (${createRes.status}): ${errText.slice(0, 300)}`);
  }

  const createJson = (await createRes.json()) as { id: string };
  const taskId = createJson.id;
  if (!taskId) throw new Error("Runway create returned no task id");

  console.log(`[Runway] Task created: ${taskId} — polling…`);

  // 2. Poll
  const pollInterval = opts.pollIntervalMs ?? 2000;
  const maxAttempts = opts.maxPollAttempts ?? 150;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    await new Promise((r) => setTimeout(r, pollInterval));

    const pollRes = await fetch(`${RUNWAY_BASE_URL}/tasks/${taskId}`, {
      headers: runwayHeaders(),
    });

    if (!pollRes.ok) {
      console.warn(`[Runway] Poll ${attempt} HTTP ${pollRes.status} — retrying`);
      continue;
    }

    const task = (await pollRes.json()) as RunwayTaskResponse;
    const progress = task.progress ?? 0;
    opts.onProgress?.(progress, task.status);

    if (task.status === "SUCCEEDED") {
      const videoUrl = task.output?.[0];
      if (!videoUrl) throw new Error("Runway succeeded but returned no output URL");
      console.log(`[Runway] Task ${taskId} succeeded after ${attempt + 1} polls`);
      return { videoUrl, durationSec: duration, model, ratio, runwayTaskId: taskId };
    }

    if (task.status === "FAILED" || task.status === "CANCELLED") {
      throw new Error(`Runway task ${task.status}: ${task.failure || task.failureCode || "unknown"}`);
    }

    if (attempt % 5 === 0) {
      console.log(`[Runway] Task ${taskId} status=${task.status} progress=${Math.round(progress * 100)}%`);
    }
  }

  throw new Error(`Runway task ${taskId} timed out after ${maxAttempts} polls`);
}

/** Friendly defaults that map social formats to Runway ratios. */
export function ratioForFormat(format: "landscape" | "portrait" | "square" | undefined): RunwayRatio {
  if (format === "portrait") return "720:1280";
  if (format === "square") return "1024:1024";
  return "1280:720";
}
