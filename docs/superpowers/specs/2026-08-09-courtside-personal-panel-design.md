# Courtside — personal results panel (design)

**Date:** 2026-08-09
**Issue:** calderdale-tennis-league-mt9
**Status:** approved

## Goal

A returning visitor who plays in the league can pin themselves as a player — with no
account or authentication — and get an instant, server-rendered summary of their own
results on the homepage: last result, rank + movement, team standing, season W/L,
next fixture.

Design chosen from three UI/UX options (homepage "Mine" tab and multi-follow `/me`
feed were rejected: the tab hides the payoff behind a tap and cannot SSR from
localStorage; the feed is a bigger product than the core need). The winning shape:
**cookie identity + SSR panel on the homepage**.

## Claiming an identity

Two entry points, one mechanism:

1. **Player page claim.** Every `/players/[slug]` page shows a lime pill button
   **"This is me — pin to homepage"**. Submitting sets the cookie and redirects to `/`.
2. **Homepage discovery line.** When unidentified, one quiet line under the hero:
   *"Play in the league? Pin your results →"* linking to `/players` — a new SSR
   search page: text input, query-param filter over player names, results rendered
   as *Name — Club* (disambiguates collisions). Tapping a result opens the player
   page, where the claim button lives.

No modal, no wizard, no JS requirement (form + query-param search work without it).

## Persistence & privacy

- Cookie `ctl_me`: JSON `{ players: [{ slug, name }] }`, max-age 1 year,
  `Path=/`, `SameSite=Lax`, **not** `HttpOnly` (it is the user's own device state).
- v1 uses only the first entry; the list shape future-proofs a later
  "follow teammates" upgrade without a cookie migration.
- The stored `name` lets the UI show a sane message if the slug stops resolving.
- Malformed cookie ⇒ treated as unidentified. Never a 500.
- Microcopy under the panel: *"Saved only on this device — nothing is sent anywhere."*
- **Forget** clears the cookie; **Switch** reopens `/players` search. Forget is also
  offered on the claimed player's own page.

## The panel

Rendered between hero and stat cards, only when identified. Visually a stat-card
variant with a **lime left rule** — the only personalised element on the page.

Content hierarchy (mobile-first):

1. Header: `YOUR RESULTS · <NAME>` (Anton uppercase) + club name
2. Last result: `W 2–1 vs Todmorden B · Thu 6 Aug` — mono W/L badge, opponent team,
   date; links to the match card
3. Stat row (3-up, small-scale stat-card grid):
   `Rank 4 ▲` (movement enum from rankings: up/down/same/new — direction only,
   magnitude is not stored) · `Team 2nd` · `7–3 W/L` (season rubbers won–lost)
4. Next fixture: `vs Ripponden A · Thu 14 Aug` (scheduled fixtures for the derived team)
5. Footer: `Full profile →` · `Not you? Switch · Forget` (ghost buttons, not lime) ·
   privacy microcopy in dim mono

## Deriving "your team"

There is no player→team link in the schema. The player's team is **derived from
match history**: the team whose side they most recently appeared on (via
`rubbers.homePlayerIds`/`awayPlayerIds` → fixture → home/away team). Multi-team
players (e.g. Mens + Mixed) resolve to the team of the most recent rubber; other
divisions appear as a secondary line in the panel.

## Edge states

| State | Behaviour |
| --- | --- |
| No rubbers yet this season | Name + club + rankings row if any; stat row reads `No rubbers yet this season` (dim mono); next-fixture line omitted. Never an empty box. |
| Claimed slug absent (new season / slug drift) | Panel shows *"No entry for <Name> this season"* + Switch/Forget. Cookie is not silently dropped. |
| Malformed/legacy cookie | Unidentified experience; no error. |
| Multiple divisions | Primary stats from the division of the most recent rubber; others listed compactly. |

## Architecture

- **`@ctl/data`**: new `getPlayerPanel(db, slug)` returning profile summary +
  derived team(s) + team standing + next scheduled fixture. Pure read function,
  unit-tested like its peers.
- **`apps/web`**:
  - `+page.server.ts` (home): parse `ctl_me` via SvelteKit `cookies`, call
    `getPlayerPanel`, pass `panel | null`.
  - Claim/forget as **form actions** on the player page (progressive enhancement);
    switch links to `/players`.
  - New `/players/+page.server.ts` + `+page.svelte` search route (query-param filter).
  - Panel component styled per the existing theme (stat-card variant, lime left rule,
    mono figures, ▲ lime / ▼ dim-red with text equivalents for accessibility).
- **No schema changes, no migrations, no client state library.**
- Accessibility: panel is an `aside` labelled "Your results"; movement arrows carry
  text equivalents ("up"/"down"); contrast of dim-red ▼ checked at mono sizes.

## Testing

- `getPlayerPanel` unit tests: team derivation (single, multi-team), no-rubbers,
  standing + next-fixture joins, absent slug.
- Cookie parsing: valid, malformed, empty ⇒ never throws.
- Home `+page.server.ts` test extends the existing mock pattern (panel present/absent).
- Claim/forget form actions: set/clear cookie, redirect.

## Out of scope (explicitly)

- Authentication, cross-device sync, notifications.
- Multi-follow feed (`/me`) — enabled later by the cookie's list shape, not built now.
- Rank movement magnitude (upstream only exposes direction).
