/**
 * Slide thumbnails for the in-chat preview.
 *
 * Why the round trip through Blob rather than using Google's URL directly:
 * `pages.getThumbnail` returns a short-lived contentUrl that expires within the
 * hour. Dropped straight into a message it looks right in the moment and turns
 * into broken images in the conversation history, which is worse than no
 * preview at all. Same reasoning as image generation — permanent Blob URLs.
 *
 * Every failure here is swallowed. A deck that exists is the deliverable; a
 * missing preview is a smaller loss than an error on a successful build.
 */

import { put } from "@vercel/blob";

const SLIDES_API = "https://slides.googleapis.com/v1/presentations";

/** Enough to show the shape of a deck without spending a dozen round trips
 *  inside a chat turn. Longer decks show their opening slides. */
const MAX_THUMBNAILS = 8;

export async function captureThumbnails(
  presentationId: string,
  token: string
): Promise<string[]> {
  if (!process.env.BLOB_READ_WRITE_TOKEN) return [];
  try {
    const res = await fetch(
      `${SLIDES_API}/${presentationId}?fields=${encodeURIComponent("slides(objectId)")}`,
      { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15_000) }
    );
    if (!res.ok) return [];
    const pages: any[] = (await res.json())?.slides || [];
    const wanted = pages.slice(0, MAX_THUMBNAILS);

    // Parallel: eight sequential round trips to Google and back to Blob would
    // add real seconds to a turn the user is watching stream.
    const uploads = await Promise.all(
      wanted.map(async (page, i) => {
        try {
          const meta = await fetch(
            `${SLIDES_API}/${presentationId}/pages/${page.objectId}/thumbnail` +
              `?thumbnailProperties.mimeType=PNG&thumbnailProperties.thumbnailSize=MEDIUM`,
            { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15_000) }
          );
          if (!meta.ok) return null;
          const contentUrl = (await meta.json())?.contentUrl;
          if (!contentUrl) return null;

          const img = await fetch(contentUrl, { signal: AbortSignal.timeout(15_000) });
          if (!img.ok) return null;

          const blob = await put(
            `slides/${presentationId}/${Date.now()}-${i}.png`,
            Buffer.from(await img.arrayBuffer()),
            { access: "public", contentType: "image/png", addRandomSuffix: true }
          );
          return blob.url;
        } catch {
          return null;
        }
      })
    );
    return uploads.filter((u): u is string => !!u);
  } catch (err: any) {
    console.warn(`[Slides] thumbnails unavailable: ${err?.message}`);
    return [];
  }
}
