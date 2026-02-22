export const LATE_API_BASE = "https://getlate.dev/api/v1";

// Fetch helper for Late API endpoints
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
