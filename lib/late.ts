import Late from "@getlatedev/node";

// Initialize the Late SDK client
// Reads LATE_API_KEY from environment automatically, but we pass it explicitly
export const late = new Late({ apiKey: process.env.LATE_API_KEY! });

export const LATE_API_BASE = "https://getlate.dev/api/v1";

// Fallback fetch helper for any endpoints not yet in the SDK
export async function lateApiFetch(
  endpoint: string,
  options: RequestInit = {}
) {
  const res = await fetch(`${LATE_API_BASE}${endpoint}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.LATE_API_KEY}`,
      ...options.headers,
    },
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `Late API error: ${res.status} ${res.statusText} — ${body}`
    );
  }

  return res.json();
}
