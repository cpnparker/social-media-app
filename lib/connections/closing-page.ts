import { NextResponse } from "next/server";

/**
 * The page an OAuth callback renders back into the popup.
 *
 * Every connect flow runs in a window opened from the chat, and the opener
 * re-reads connection status the moment that window closes — so closing IS the
 * completion signal and there is nothing to post back.
 *
 * `status` matters even though a human is reading the HTML. Rendering these
 * without one meant every outcome returned 200: an expired session, a forged
 * state, the wrong account authorised, a failed token exchange. The user saw
 * the right words while logs and uptime checks saw a clean callback. Cancelled
 * consent is the one failure that legitimately stays 200 — the user chose it.
 */
export function closingPage(ok: boolean, message: string, status = 200): NextResponse {
  const safe = message.replace(/[<>&"]/g, (c) =>
    ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" }[c] as string)
  );
  const html = `<!doctype html><meta charset="utf-8"><title>${ok ? "Connected" : "Couldn't connect"}</title>
<style>body{font:15px/1.5 system-ui,sans-serif;margin:0;display:grid;place-items:center;height:100vh;color:#111;background:#fff}
.b{max-width:26rem;padding:2rem;text-align:center}.t{font-weight:600;margin-bottom:.5rem}.m{color:#666;font-size:13px}
@media(prefers-color-scheme:dark){body{background:#0b0b0c;color:#eee}.m{color:#999}}</style>
<div class="b"><div class="t">${ok ? "Connected" : "Couldn’t connect"}</div><div class="m">${safe}</div></div>
<script>try{window.close()}catch(e){}
setTimeout(function(){try{window.close()}catch(e){}},${ok ? 900 : 4000});</script>`;
  return new NextResponse(html, {
    status,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}
