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

/** Expand any IPv6 literal to its eight 16-bit groups, or null if it will not
 *  parse. net.isIP has already vouched that the string is a valid v6, so this
 *  only has to handle the `::` run and an optional embedded dotted IPv4 tail. */
function v6Groups(addr: string): number[] | null {
  let a = addr;
  // A trailing dotted-quad (::ffff:127.0.0.1) becomes two hex groups first.
  const dotted = /(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(a);
  if (dotted) {
    const b = dotted.slice(1).map(Number);
    if (b.some((n) => n > 255)) return null;
    a = a.slice(0, dotted.index) +
      ((b[0] << 8) | b[1]).toString(16) + ":" + ((b[2] << 8) | b[3]).toString(16);
  }
  const halves = a.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const tail = halves.length === 2 ? (halves[1] ? halves[1].split(":") : []) : null;
  let groups: string[];
  if (tail === null) {
    groups = head;
  } else {
    const fill = 8 - head.length - tail.length;
    if (fill < 0) return null;
    groups = head.concat(Array(fill).fill("0"), tail);
  }
  if (groups.length !== 8) return null;
  const out = groups.map((g) => parseInt(g || "0", 16));
  return out.some((n) => Number.isNaN(n) || n < 0 || n > 0xffff) ? null : out;
}

function isPrivateV6(ip: string): boolean {
  const a = ip.toLowerCase().replace(/^\[|\]$/g, "");
  const g = v6Groups(a);
  // Cannot classify it → treat as private. A guard that fails open is not a
  // guard: an address this cannot parse is exactly where an attacker aims.
  if (!g) return true;

  // Loopback ::1 and the unspecified ::
  if (g.every((n, i) => (i < 7 ? n === 0 : true)) && (g[7] === 0 || g[7] === 1)) return true;
  // IPv4-mapped (::ffff:a.b.c.d) and IPv4-compatible (::a.b.c.d) carry a v4
  // address in the low 32 bits — the bypass this file shipped with: the dotted
  // form was handled but ::ffff:7f00:1 and ::ffff:a9fe:a9fe (127.0.0.1 and the
  // 169.254 metadata endpoint in hex) sailed through as "public".
  const firstFive = g[0] | g[1] | g[2] | g[3] | g[4];
  if (firstFive === 0 && (g[5] === 0xffff || g[5] === 0)) {
    const v4 = `${g[6] >> 8}.${g[6] & 0xff}.${g[7] >> 8}.${g[7] & 0xff}`;
    return isPrivateV4(v4);
  }
  const h = g[0];
  if (h >= 0xfe80 && h <= 0xfebf) return true;   // link-local fe80::/10
  if (h >= 0xfc00 && h <= 0xfdff) return true;   // unique local fc00::/7
  if ((h & 0xff00) === 0xff00) return true;       // multicast ff00::/8
  if (h === 0x0064 && g[1] === 0xff9b) {          // NAT64 64:ff9b::/96 — carries a v4
    const v4 = `${g[6] >> 8}.${g[6] & 0xff}.${g[7] >> 8}.${g[7] & 0xff}`;
    return isPrivateV4(v4);
  }
  return false;
}

/** The address classifier, exported for scripts/verify-safe-fetch.ts. A literal
 *  IP is judged synchronously here; a hostname is resolved. */
export async function destinationIsPublicForTest(hostname: string): Promise<boolean> {
  return destinationIsPublic(hostname);
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
