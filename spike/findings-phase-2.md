# Phase 2 CSRF spike — findings (2026-05-17)

## Probes

| Endpoint | Status | hasContent | Notes |
|---|---|---|---|
| displayResults.php | 200 | true | baseline (already confirmed in Phase 1); length=43907 |
| displayContacts.php | 200 | true | teamID=80 (Cragg Vale); length=3211; preview shows "Cragg Vale - Team Contact Details" |
| displayLocations.php | 200 | true | locationID=197, clubID=16 (Cragg Vale TC); length=17391; preview shows address |
| result_card_37.php | 200 | true | fixture_id=453 (Mixed Div 1); length=25129; preview shows "Mixed Division 1" match card table |

## Decision

[x] Best case: refreshProtectionCode=0 works for all fragments → http-client unchanged from Phase 1's strategy.

[ ] Middle case: one or more fragments require cookie warm-up → http-client.ts (Task 20) adds a one-time GET of the home page at scraper start, captures the cookie, attaches it to all subsequent requests.

[ ] Worst case: fragments require extracting a fresh `refreshProtectionCode` from the home page HTML and injecting it per-URL → http-client.ts adds a token cache + per-URL injection.

## Detail

All four probes were run with `refreshProtectionCode=0` and no cookie. Every probe returned HTTP 200
with substantive HTML content — no redirects, no login walls, no error pages.

Response body previews were inspected manually and confirmed genuine data in each case:

- **displayContacts.php**: `<div id="wizardWebObject_form"> <div><b>Cragg Vale - Team Contact Details:</b></div>` — real contact detail fragment
- **displayLocations.php**: `<div id=16><b>Cragg Vale Tennis Club</b></div> <div>Hinchcliffe Arms, Cragg Vale, Hebden Bridge, West Yorkshire, HX7 5…` — real location/address fragment
- **result_card_37.php**: `<table class="matchCardTable">` with `Mixed Division 1` — real match scorecard

This extends Phase 1's finding (which covered only the shell page and `displayResults.php`) to the
three remaining fragment endpoints. The `refreshProtectionCode` parameter is inert server-side for
all currently-tested endpoints — it behaves as a client-side cache-busting hint, not a
server-enforced CSRF guard.

## Implication for Task 20 (http-client.ts)

The HTTP client can remain stateless: plain `fetch` with a `User-Agent` header, no cookie jar,
no warm-up request, no token extraction or injection. Where URLs contain a
`refreshProtectionCode=<session-value>`, it can be replaced with `0` or omitted entirely.
