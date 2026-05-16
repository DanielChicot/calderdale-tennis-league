# CSRF / Session Spike — Findings

## Probe Results

| Probe | Status | Body Length | `League Table` present |
|---|---|---|---|
| `no-token` | 200 | 257,982 | yes |
| `token-zero` | 200 | 257,982 | yes |
| `warmup-home` | 200 | 91,915 | no |
| `warmup-replay` | 200 | 257,982 | yes |

## Observations

- Both `no-token` and `token-zero` return a 200 with full league-table content. No cookie, no `refreshProtectionCode` value, no session required.
- `token-zero` body length is identical to `no-token`, confirming `refreshProtectionCode=0` is not materially different from omitting the param entirely.
- No redirects (30x) were observed in any probe.
- `warmup-home` (bare `/`) returns a smaller page (91 KB) without league-table content — that is the landing/splash page, not a navigation destination.
- `warmup-replay` (cookie from home + `navButtonSelect`) also returns full content, but the cookie adds no observable value since `no-token` already worked.

## Decision: **Best case**

`refreshProtectionCode=0` — and in fact even omitting it entirely — works on every URL. No session management is needed at all. The parameter appears to be a client-side cache-busting mechanism rather than a server-side CSRF guard.

## Implications for `parser/src/http.ts` (Task 3)

The HTTP client can use plain stateless `fetch` calls — no cookie jar, no warm-up request, no token extraction from HTML. Where URLs encountered in the wild carry `refreshProtectionCode=<value>`, the value can be replaced with `0` or stripped entirely. A single `User-Agent` header (identifying the mirror) is sufficient. The client does not need to manage any session state between requests.
