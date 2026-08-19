import dns from "dns";
import net from "net";

/**
 * Fetching a URL somebody else chose.
 *
 * The deck builder will fetch any `image.url` it is given — the tool schema
 * invites one, and a model writes it from whatever it read. That request goes
 * out from inside our own network, where "http://169.254.169.254/" is a cloud
 * metadata endpoint and "http://localhost:6379" is a database. A URL is a
 * request the caller gets to make on our behalf, so the destination has to be
 * checked rather than assumed.
 *
 * Every hop is checked, not just the first: an allowed host that answers with a
 * redirect to 127.0.0.1 is the standard way past a check that only looks at
 * what it was handed.
 *
 * The DNS lookup and the connection are separate events, so a name that
 * resolves publicly here and privately a moment later still gets through.
 * Closing that needs the socket pinned to the address we validated, which fetch
 * does not expose; this removes the whole class of casual probes and leaves the
 * race.
 */

const MAX_REDIRECTS = 3;
const MAX_BYTES = 25 * 1024 * 1024;

function isPrivateV4(ip: string): boolean {
  const p = ip.split(".").map(Number);
  if (p.length !== 4 || p.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true;
  const a = p[0], b = p[1];
  return (
    a === 0 || a === 10 || a === 127 ||
    (a === 169 && b === 254) ||                 // link-local, incl. cloud metadata
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127) ||       // carrier-grade NAT
    (a === 192 && b === 0) ||
    a >= 224                                    // multicast and reserved
  );
}

function isPrivateV6(ip: string): boolean {
  const a = ip.toLowerCase().replace(/^\[|\]$/g, "");
  if (a === "::" || a === "::1") return true;
  if (/^fe[89ab]/.test(a)) return true;                                   // link-local
  if (a.startsWith("fc") || a.startsWith("fd")) return true;              // unique local
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(a);
  if (mapped) return isPrivateV4(mapped[1]);
  return false;
}

async function destinationIsPublic(hostname: string): Promise<boolean> {
  const bare = hostname.replace(/^\[|\]$/g, "");
  if (net.isIP(bare)) {
    return net.isIPv4(bare) ? !isPrivateV4(bare) : !isPrivateV6(bare);
  }
  try {
    const addresses = await dns.promises.lookup(bare, { all: true });
    if (!addresses.length) return false;
    return addresses.every((a) => (a.family === 4 ? !isPrivateV4(a.address) : !isPrivateV6(a.address)));
  } catch {
    return false;
  }
}

/** Fetch a caller-supplied URL, or throw. Redirects are followed by hand so
 *  each destination is checked before it is contacted. */
export async function safeFetch(
  rawUrl: string,
  init: RequestInit & { timeoutMs?: number } = {}
): Promise<Response> {
  const timeoutMs = init.timeoutMs ?? 15_000;
  const rest: RequestInit = { ...init };
  delete (rest as any).timeoutMs;
  let url = rawUrl;

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      throw new Error("not a URL");
    }
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      throw new Error(`unsupported scheme ${parsed.protocol}`);
    }
    if (!(await destinationIsPublic(parsed.hostname))) {
      throw new Error("destination is not a public address");
    }

    const res = await fetch(url, {
      ...rest,
      redirect: "manual",
      signal: AbortSignal.timeout(timeoutMs),
    });

    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get("location");
      if (!location) return res;
      url = new URL(location, url).toString();
      continue;
    }

    const declared = Number(res.headers.get("content-length") || 0);
    if (declared > MAX_BYTES) throw new Error("image is too large");
    return res;
  }
  throw new Error("too many redirects");
}

/** The bytes of a caller-supplied image, size-capped even when the server lied
 *  about content-length. */
export async function safeFetchBuffer(
  rawUrl: string, timeoutMs = 15_000
): Promise<Buffer | null> {
  const res = await safeFetch(rawUrl, { timeoutMs });
  if (!res.ok) return null;
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.byteLength > MAX_BYTES) throw new Error("image is too large");
  return buf;
}
