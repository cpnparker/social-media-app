import { get } from "@vercel/blob";

/**
 * Resolves an attachment URL to its raw content buffer.
 *
 * Handles two kinds of URLs:
 * 1. Private proxy URLs  — /api/media/file?path=<blobPathname>
 *    → extracts the pathname and fetches via @vercel/blob SDK (server-to-server)
 * 2. Legacy public URLs  — https://...public.blob.vercel-storage.com/...
 *    → fetches directly over HTTP
 */
export async function fetchBlobContent(
  url: string
): Promise<{ buffer: Buffer; contentType: string }> {
  // ─── Private proxy URL ───
  if (url.startsWith("/api/media/file")) {
    const parsed = new URL(url, "http://localhost");
    const blobPath = parsed.searchParams.get("path");
    if (!blobPath) throw new Error("Missing path in proxy URL");

    const result = await get(blobPath, { access: "private" });
    if (!result || result.statusCode !== 200 || !result.stream) {
      throw new Error(`Blob not found: ${blobPath}`);
    }

    const response = new Response(result.stream as ReadableStream);
    const arrayBuffer = await response.arrayBuffer();
    return {
      buffer: Buffer.from(arrayBuffer),
      contentType: result.blob.contentType || "application/octet-stream",
    };
  }

  // ─── Legacy public URL or any other absolute URL ───
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Failed to fetch ${url}: ${response.status}`);
  const arrayBuffer = await response.arrayBuffer();
  return {
    buffer: Buffer.from(arrayBuffer),
    contentType: response.headers.get("content-type") || "application/octet-stream",
  };
}
