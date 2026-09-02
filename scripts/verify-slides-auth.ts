/**
 * The Google grant lookup behind "Create in Google Slides".
 *
 * ── WHY THIS EXISTS ─────────────────────────────────────────────────────────
 *
 * A user asked EngineAI to build a 41-slide deck, pressed Create in Google
 * Slides, and was told: "I couldn't check your Google connection just now —
 * that's a problem at our end, not yours. Try again in a moment."
 *
 * There was nothing to try again. She held TWO `provider: "google"` rows —
 * MeetingBrain's sign-in keys its row by the numeric Google subject, EngineAI's
 * connect flow keys its own by email, and neither recognises the other — and
 * the lookup ended in `.maybeSingle()`. That is not "give me one row"; it is an
 * assertion that at most one exists, and PostgREST answers the second with
 * PGRST116, an ERROR. The error mapped to `unavailable`, whose whole meaning is
 * "we could not find out, try later".
 *
 * Every export for that user failed, permanently, and the advice was worse than
 * useless: reconnecting refreshes every google row and leaves them all in
 * place, so the second row — and the error — survived it. She could not have
 * fixed this herself.
 *
 * ── HOW IT IS TESTED ────────────────────────────────────────────────────────
 *
 * Against a FAKE PostgREST over real HTTP, driving the real `canGenerateSlides`
 * through the real supabase-js client. `meetingBrainDb` builds its client from
 * env at first use, so pointing the URL at a local server injects the seam
 * without a mock. The fake reproduces the behaviour that caused the bug: when a
 * request carries `Accept: application/vnd.pgrst.object+json` — which is what
 * `.maybeSingle()` sends — and more than one row matches, it answers 406
 * PGRST116, exactly as the live database did.
 *
 * That is the point. A check that only unit-tested the ranking function would
 * pass just as happily with `.maybeSingle()` restored, because the ranking was
 * never what broke. This one fails.
 *
 * MUTATION LOG
 *   - bestGrant returns rows[0] instead of ranking       → KILLED
 *   - bestGrant ignores the slides scope                 → KILLED
 *   - token cache written by (user, provider) not row id → KILLED
 *   - `.maybeSingle()` back on the users select          → SURVIVED, then killed.
 *     Nothing exercised two users sharing an email, so half the fix was
 *     untested. The fixture in section 2 is the fix to the check.
 *   - `.maybeSingle()` back on the account select        → killed, but by a
 *     TypeError, not an assertion: the select is cast `as unknown as
 *     AccountRow[]`, so tsc allows the wrong shape through and `bestGrant`
 *     crashed on it. In production that is a 500, which is a worse answer than
 *     the wrong one it replaced. `loadAccount` now refuses a non-list shape
 *     explicitly, and the mutation fails on assertions instead.
 */

import { createServer, type Server } from "http";

let failures = 0;
const fail = (m: string) => { failures++; console.log(`  FAIL  ${m}`); };
const ok = (m: string) => console.log(`  ok    ${m}`);
const assert = (cond: boolean, m: string) => { if (!cond) fail(m); };

/** Rows the fake database will serve, set per scenario. */
let USERS: any[] = [];
let ACCOUNTS: any[] = [];
/** Every write the code under test issued, so a cross-row update is visible. */
let WRITES: { path: string; body: any }[] = [];

function startFakePostgrest(): Promise<{ server: Server; url: string }> {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      const url = new URL(req.url || "/", "http://localhost");
      const wantsOne = String(req.headers["accept"] || "").includes("vnd.pgrst.object+json");
      const table = url.pathname.replace("/rest/v1/", "");

      let body = "";
      req.on("data", (c) => { body += c; });
      req.on("end", () => {
        if (req.method === "PATCH") {
          WRITES.push({ path: req.url || "", body: (() => { try { return JSON.parse(body); } catch { return body; } })() });
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end("[]");
          return;
        }
        // A sentinel the outage scenario uses: the database answering 500 is a
        // different fact from the database answering "no rows", and the code has
        // to keep telling them apart.
        if ((req.url || "").includes("outage%40example.com") || (req.url || "").includes("outage@example.com")) {
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end('{"message":"connection reset"}');
          return;
        }
        let rows = table === "users" ? USERS : table === "account" ? ACCOUNTS : [];
        // Honour the filters the code actually sends, so a query that forgot one
        // does not quietly pass by matching everything.
        for (const [key, value] of Array.from(url.searchParams.entries())) {
          if (key === "select" || key === "limit" || key === "order") continue;
          const m = String(value).match(/^eq\.(.*)$/);
          if (!m) continue;
          rows = rows.filter((r) => String(r[key]) === m[1]);
        }
        const limit = url.searchParams.get("limit");
        if (limit) rows = rows.slice(0, Number(limit));

        // THE BEHAVIOUR THAT CAUSED THE BUG: single-object Accept over more than
        // one row is an error, not a row.
        if (wantsOne && rows.length > 1) {
          res.writeHead(406, { "Content-Type": "application/json" });
          res.end(JSON.stringify({
            code: "PGRST116",
            details: `The result contains ${rows.length} rows`,
            hint: null,
            message: "JSON object requested, multiple (or no) rows returned",
          }));
          return;
        }
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(wantsOne ? JSON.stringify(rows[0] ?? null) : JSON.stringify(rows));
      });
    });
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address() as any;
      resolve({ server, url: `http://127.0.0.1:${addr.port}` });
    });
  });
}

const SIGN_IN_SCOPES = "openid https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/gmail.readonly";
const SLIDES_SCOPES = `${SIGN_IN_SCOPES} https://www.googleapis.com/auth/drive.file`;

const account = (over: Partial<any>) => ({
  id: "row-1", user_id: "u1", provider: "google",
  refresh_token: "r", access_token: "a", expires_at: 4102444800, scope: SIGN_IN_SCOPES,
  ...over,
});

(async () => {
  const { server, url } = await startFakePostgrest();
  process.env.NEXT_PUBLIC_SUPABASE_URL = url;
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-key-not-a-secret";
  process.env.GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || "test-client";
  process.env.GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || "test-secret";

  // Imported AFTER the env is set: the client is built on first use.
  const { canGenerateSlides, getUserGoogleToken, bestGrant } = await import("../lib/slides/token");

  console.log("1. One grant, the ordinary case");
  {
    USERS = [{ id: "u1", email: "one@example.com" }];
    ACCOUNTS = [account({ scope: SLIDES_SCOPES })];
    const r = await canGenerateSlides("one@example.com");
    assert(r.ok, `a single complete grant can create slides (${r.reason})`);

    ACCOUNTS = [account({})];
    const r2 = await canGenerateSlides("one@example.com");
    assert(r2.reason === "needs_reconnect", `a grant without the slides scope asks for a reconnect (${r2.reason})`);

    USERS = []; ACCOUNTS = [];
    const r3 = await canGenerateSlides("nobody@example.com");
    assert(r3.reason === "not_connected", `an unknown user is not connected (${r3.reason})`);
    if (!failures) ok("one grant behaves as it always did");
  }

  console.log("\n2. TWO grants — the state that broke a real export");
  {
    const before = failures;
    USERS = [{ id: "u1", email: "two@example.com" }];
    // Exactly the live shape: same person, one row keyed by email and one by the
    // numeric Google subject, neither carrying the slides scope.
    ACCOUNTS = [
      account({ id: "row-mb", provider_account_id: "113853489538272936426" }),
      account({ id: "row-engine", provider_account_id: "two@example.com" }),
    ];
    const r = await canGenerateSlides("two@example.com");
    assert(r.reason !== "unavailable",
      "two grants must not read as an outage — this is the bug, and it told the user to wait for a fix that was never coming");
    assert(r.reason === "needs_reconnect",
      `and the answer is the true one, which the user can act on (${r.reason})`);

    // The whole grant present twice: the export must simply work.
    ACCOUNTS = [
      account({ id: "row-mb", scope: SLIDES_SCOPES }),
      account({ id: "row-engine", scope: SLIDES_SCOPES }),
    ];
    const r2 = await canGenerateSlides("two@example.com");
    assert(r2.ok, `two complete grants create slides rather than failing (${r2.reason})`);

    // One of each: the complete one must win, or a user who reconnected is still
    // told to reconnect.
    ACCOUNTS = [
      account({ id: "row-old" }),
      account({ id: "row-new", scope: SLIDES_SCOPES }),
    ];
    const r3 = await canGenerateSlides("two@example.com");
    assert(r3.ok, `the grant that covers slides wins over the one that does not (${r3.reason})`);
    // And in the other order, so the result is a ranking rather than a position.
    ACCOUNTS = [
      account({ id: "row-new", scope: SLIDES_SCOPES }),
      account({ id: "row-old" }),
    ];
    assert((await canGenerateSlides("two@example.com")).ok, "in either row order");

    // The SAME hazard one table up. Two users rows sharing an email is not the
    // live shape today, but it is the identical mistake in the identical
    // function, and `.maybeSingle()` there would take the export down the same
    // way. Without this fixture that half of the fix is untested — the mutation
    // that restores it survived until this block existed.
    USERS = [
      { id: "u1", email: "two@example.com" },
      { id: "u2", email: "two@example.com" },
    ];
    ACCOUNTS = [account({ id: "row-one", user_id: "u1", scope: SLIDES_SCOPES })];
    const rDup = await canGenerateSlides("two@example.com");
    assert(rDup.ok, `two user rows sharing an email still resolve to a grant (${rDup.reason})`);
    USERS = [{ id: "u1", email: "two@example.com" }];

    // A refreshable grant beats an unrefreshable one: a grant that cannot be
    // refreshed is dead within the hour.
    ACCOUNTS = [
      account({ id: "row-dead", refresh_token: null, scope: SLIDES_SCOPES }),
      account({ id: "row-live" }),
    ];
    const r4 = await canGenerateSlides("two@example.com");
    assert(r4.reason === "needs_reconnect",
      `a refreshable grant outranks an expiring one, and says so honestly (${r4.reason})`);
    if (failures === before) ok("two grants resolve to the strongest one, and never to an outage");
  }

  console.log("\n3. A real outage still reads as one");
  {
    const before = failures;
    // The distinction the `unavailable` reason exists for must survive the fix:
    // a database that cannot answer is our fault and not a reconnect prompt.
    // Driven through the same client and code path, with the fake answering 500.
    USERS = [{ id: "u1", email: "outage@example.com" }];
    ACCOUNTS = [account({ scope: SLIDES_SCOPES })];
    const r = await canGenerateSlides("outage@example.com");
    assert(r.reason === "unavailable", `a database that errors is reported as our problem (${r.reason})`);
    // And the precondition: with the sentinel gone the SAME rows succeed, so the
    // assertion above is measuring the 500 and not a missing fixture.
    USERS = [{ id: "u1", email: "fine@example.com" }];
    const r2 = await canGenerateSlides("fine@example.com");
    assert(r2.ok, `the same fixture without the outage succeeds (${r2.reason})`);
    if (failures === before) ok("a genuine outage is still distinguished from a missing grant");
  }

  console.log("\n4. The ranking itself");
  {
    const before = failures;
    assert(bestGrant([]) === null, "no rows, no grant");
    assert(bestGrant(null) === null, "and null is not a crash");
    const only = account({ id: "solo" });
    assert(bestGrant([only])?.id === "solo", "one row is that row");
    assert(bestGrant([account({ id: "a", expires_at: 1 }), account({ id: "b", expires_at: 2 })])?.id === "b",
      "equal grants break the tie on expiry");
    if (failures === before) ok("the ranking prefers refreshable, then scoped, then freshest");
  }

  console.log("\n5. The cached access token is written to ONE row");
  {
    const before = failures;
    // A token minted from one row's refresh token must not be stamped onto a row
    // holding a different one — the next call would then send a token that does
    // not belong to the grant it was read from.
    USERS = [{ id: "u1", email: "two@example.com" }];
    ACCOUNTS = [
      account({ id: "row-mb", scope: SLIDES_SCOPES, access_token: null, expires_at: 1 }),
      account({ id: "row-engine", scope: SLIDES_SCOPES, access_token: null, expires_at: 1 }),
    ];
    WRITES = [];
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async (input: any, init: any) => {
      if (String(input).includes("oauth2.googleapis.com")) {
        return new Response(JSON.stringify({ access_token: "fresh", expires_in: 3600 }), {
          status: 200, headers: { "Content-Type": "application/json" },
        });
      }
      return realFetch(input, init);
    }) as any;
    try {
      const r = await getUserGoogleToken("two@example.com");
      assert(r.ok && r.accessToken === "fresh", "an expired token is refreshed");
      const patches = WRITES.filter((w) => w.path.includes("account"));
      assert(patches.length === 1, `the refreshed token is written once (${patches.length} writes)`);
      assert(patches.every((w) => /[?&]id=eq\./.test(w.path)),
        `and addressed by row id, not by (user, provider) (${patches.map((w) => w.path).join(" ")})`);
    } finally {
      globalThis.fetch = realFetch;
    }
    if (failures === before) ok("the token cache cannot cross-write another grant's row");
  }

  console.log("\n6. Every failure leaves the user something to press");
  {
    const before = failures;
    const { isReconnectable, isRetryable, isActionable, reconnectLabel } = await import("../lib/slides/reauth");
    const { authFailureMessage } = await import("../lib/slides/token");

    // The full union, written out. If a reason is added and not classified, the
    // exhaustiveness assertion below fails rather than the new reason quietly
    // becoming a dead end — which is exactly what `unavailable` was.
    const ALL = ["not_connected", "needs_reconnect", "refresh_failed", "not_configured", "unavailable"] as const;

    assert(ALL.filter((r) => isReconnectable(r)).join(",") === "not_connected,needs_reconnect,refresh_failed",
      "only genuine connection problems offer a reconnect");
    assert(ALL.filter((r) => isRetryable(r)).join(",") === "unavailable",
      "a grant store we could not reach offers a retry instead");
    assert(!isReconnectable("unavailable"),
      "and never a reconnect — nothing about that user's Google account is wrong, so reconnecting sends them to fix what is not broken");

    // THE RULE. A user is never handed a sentence and no control. The single
    // exception is the one failure that is genuinely nothing to do with them.
    const stranded = ALL.filter((r) => !isActionable(r));
    assert(stranded.join(",") === "not_configured",
      `every failure but the deployment's own leaves an action (stranded: ${stranded.join(",") || "none"})`);

    // And each one says something true, so the card's text and its button agree.
    for (const r of ALL) {
      const msg = authFailureMessage(r);
      assert(!!msg && msg.length > 20, `${r} has a real message`);
      if (isRetryable(r)) {
        assert(/again/i.test(msg), `${r} tells the user to try again, which is what its button does (${msg})`);
        assert(!/Settings/i.test(msg),
          `${r} does not send the user to Settings — reconnecting cannot fix it, and that advice is what wasted a real user's day`);
      }
      if (isReconnectable(r)) {
        assert(/connect/i.test(msg), `${r} tells the user to connect, which is what its button does`);
      }
    }
    assert(reconnectLabel("not_connected") === "Connect Google", "someone who never connected is not asked to reconnect");
    assert(reconnectLabel("needs_reconnect") === "Reconnect Google", "and someone who did is");
    if (failures === before) ok("no reason strands the user, and every message matches its button");
  }

  server.close();
  console.log(failures ? `\n✗ ${failures} failure${failures === 1 ? "" : "s"}` : "\n✓ a second Google grant cannot break slide export");
  process.exit(failures ? 1 : 0);
})();
