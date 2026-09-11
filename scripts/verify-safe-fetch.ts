/**
 * safeFetch's SSRF guard, exercised against the addresses it exists to stop.
 *
 * The guard is the only thing standing between a model-supplied `image.url` and
 * whatever our network can reach — a cloud metadata endpoint, a database on
 * localhost. It shipped with a hole: IPv4-mapped IPv6 addresses in hex form
 * (`::ffff:7f00:1`, `::ffff:a9fe:a9fe`) walked straight through the classifier
 * to loopback and 169.254.169.254, because only the dotted-decimal form was
 * handled. A source grep cannot see that; only running the classifier can.
 */
import { destinationIsPublicForTest } from "../lib/net/safe-fetch";

let failures = 0;
const fail = (m: string) => { failures++; console.log(`  FAIL  ${m}`); };
const pass = (m: string) => console.log(`  ok    ${m}`);

// Every one of these resolves to an address inside our own network.
const PRIVATE = [
  "127.0.0.1", "10.0.0.1", "192.168.1.1", "172.16.0.1", "169.254.169.254",
  "0.0.0.0", "100.64.0.1",
  "::1", "::", "fe80::1", "fc00::1", "fd12:3456::1",
  // The bypass class: an internal v4 wearing a v6 costume, in both notations.
  "::ffff:127.0.0.1", "::ffff:7f00:1", "::ffff:169.254.169.254", "::ffff:a9fe:a9fe",
  "::127.0.0.1", "64:ff9b::7f00:1",
];
// Real, routable, public addresses the guard must NOT block.
const PUBLIC = [
  "8.8.8.8", "1.1.1.1", "93.184.216.34",
  "2606:4700:4700::1111", "2001:4860:4860::8888",
];

(async () => {
  console.log("\n1. Internal addresses are refused, in every notation");
  const before1 = failures;
  for (const ip of PRIVATE) {
    // eslint-disable-next-line no-await-in-loop
    const ok = await destinationIsPublicForTest(ip);
    if (ok) fail(`${ip} was classified PUBLIC — it is reachable inside our network`);
  }
  if (failures === before1) pass(`all ${PRIVATE.length} private/mapped/loopback forms blocked`);

  console.log("\n2. Public addresses still resolve");
  const before2 = failures;
  for (const ip of PUBLIC) {
    // eslint-disable-next-line no-await-in-loop
    const ok = await destinationIsPublicForTest(ip);
    if (!ok) fail(`${ip} was classified private — a real public host would be unreachable`);
  }
  if (failures === before2) pass(`all ${PUBLIC.length} public addresses allowed`);

    console.log(failures ? `\n${failures} FAILURE(S)\n` : `\nAll checks passed.\n`);
    process.exit(failures ? 1 : 0);
  })();
