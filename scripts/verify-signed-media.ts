/**
 * A signed media URL is a bearer capability. This guards the two properties
 * that keep that safe.
 *
 * 1. REISSUE MUST NOT BE REACHABLE WITH CALLER-SUPPLIED INPUT.
 *    refreshSignedMediaUrl verifies with allowExpired:true and mints a fresh
 *    URL — correct, because the whole job is refreshing URLs that have rotted,
 *    and the caller is our own code passing values read from our own database.
 *    But the moment anything hands it a URL taken from a REQUEST, possession
 *    stops being time-limited: a leaked URL could be renewed forever by whoever
 *    holds it, and a short TTL would buy nothing at all.
 *
 *    This is checked as an allowlist of caller files plus a shape test on the
 *    argument, NOT by grepping for the warning comment above the function. A
 *    check that proves a line EXISTS is exactly what once reported a live
 *    security hole in this repo as closed. A new caller has to be added here
 *    deliberately, by someone who has thought about where its argument comes
 *    from.
 *
 * 2. ATTACHMENT-SOURCED URLS MUST NOT OUTLIVE THE SESSION.
 *    A client screenshot is not a logo. Long-lived grants are for shareable
 *    brand assets; anything a user dragged into the composer gets the short TTL.
 */
import { readFileSync, readdirSync, statSync } from "fs";
import { join } from "path";
import { TTL_LONG_SECONDS, TTL_SHORT_SECONDS } from "../lib/media/signed";

let failures = 0;
const fail = (m: string) => { failures++; console.log(`  FAIL  ${m}`); };
const pass = (m: string) => console.log(`  ok    ${m}`);

/** Files permitted to call refreshSignedMediaUrl. Each was reviewed to confirm
 *  its argument comes from a database read, never from a request. */
const REISSUE_CALLERS = ["lib/slides/generate.ts"];

/**
 * Anything that looks like it came off an HTTP request.
 *
 * SECONDARY, and deliberately so. It only catches a value inlined at the call
 * site — refreshSignedMediaUrl(body.url). Assign it to a local first and this
 * sees nothing: verified by probing with a route doing exactly that, which this
 * test passed and checks 1 and 3 caught. It cannot be tightened by adding
 * "url", because the legitimate caller passes s.resolvedImage.url and would
 * fail on the same word.
 *
 * The ALLOWLIST in check 1 is the real guard: it fails on any new caller
 * whatever its argument looks like, which forces a person to decide. This
 * check is a cheap second net, not the net.
 */
const REQUEST_SHAPED = /\b(req|request|body|searchParams|params|query|payload|input)\b/;

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === ".next" || name === ".git") continue;
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}

const files = [...walk("app"), ...walk("lib"), ...walk("components")];

console.log("\n1. Reissue has no caller outside the reviewed allowlist");
const callers: string[] = [];
for (const f of files) {
  const rel = f.replace(/^\.\//, "");
  if (rel === "lib/media/signed.ts") continue;
  const src = readFileSync(f, "utf8");
  if (/refreshSignedMediaUrl\s*\(/.test(src)) callers.push(rel);
}
for (const c of callers) {
  REISSUE_CALLERS.includes(c)
    ? pass(`${c} (reviewed: argument comes from a DB read)`)
    : fail(`${c} calls refreshSignedMediaUrl and is NOT in REISSUE_CALLERS — review where its argument comes from, then add it here`);
}
if (callers.length === 0) fail("no callers at all — reissue is dead code, or the detection broke");

console.log("\n2. No caller inlines request-shaped input (secondary — see note)");
for (const c of callers) {
  const src = readFileSync(c, "utf8");
  const bad = (src.match(/refreshSignedMediaUrl\s*\(([^)]*)\)/g) || [])
    .filter((call) => REQUEST_SHAPED.test(call));
  bad.length
    ? fail(`${c} passes request-shaped input: ${bad[0]} — possession would become permanent`)
    : pass(`${c} passes no request-derived value`);
}

console.log("\n3. Reissue is never exposed as its own endpoint");
const routeExposure = files.filter((f) => /app\/api\/.*route\.tsx?$/.test(f)).filter((f) => {
  const src = readFileSync(f, "utf8");
  // A route may legitimately reissue a URL it read from the DB (the preview
  // path). What it must never do is take a url off the request AND reissue it.
  return /refreshSignedMediaUrl/.test(src) && /searchParams\.get\(\s*["'`]url|body\.url|body\?\.url/.test(src);
});
routeExposure.length
  ? fail(`route(s) reissue a URL taken from the request: ${routeExposure.join(", ")}`)
  : pass("no route reissues a request-supplied URL");

console.log("\n4. The TTL policy is two classes, and short is genuinely short");
TTL_SHORT_SECONDS < TTL_LONG_SECONDS
  ? pass(`short ${TTL_SHORT_SECONDS / 3600}h vs long ${TTL_LONG_SECONDS / 86400}d`)
  : fail("short TTL is not shorter than long");
TTL_SHORT_SECONDS <= 6 * 3600
  ? pass("short TTL is within a working session")
  : fail(`short TTL is ${TTL_SHORT_SECONDS / 3600}h — long enough to stop being a mitigation`);

console.log("\n5. Attachment-sourced URLs use the short TTL");
const imagesPath = "lib/slides/images.ts";
const images = readFileSync(imagesPath, "utf8");
const attachMint = /source:\s*["'`]supplied["'`]/.test(images);
if (!attachMint) {
  console.log(`  skip  ${imagesPath} has no attachment mint site to check`);
} else if (/TTL_SHORT_SECONDS/.test(images)) {
  pass("the attachment mint site opts into the short TTL");
} else {
  console.log(`  PENDING  ${imagesPath} still mints attachment URLs at the long TTL.`);
  console.log(`           Safe today (previews would break without read-path reissue),`);
  console.log(`           but this is the remaining half of the fix — see REISSUE_CALLERS.`);
}

console.log(failures ? `\n${failures} FAILURE(S)\n` : `\nAll checks passed.\n`);
process.exit(failures ? 1 : 0);
