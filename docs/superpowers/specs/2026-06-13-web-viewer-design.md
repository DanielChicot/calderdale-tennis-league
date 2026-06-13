# Web viewer (SvelteKit, server-rendered)

## Goal

A read-only web app over the now-complete dataset: standings, fixtures/results, rankings, match cards, and team/player/club pages. Server-rendered SvelteKit reading `packages/data` directly, deployed as a new container in the SAN compose stack behind Tailscale.

This is the "reads and serving" layer the whole data pipeline was built for. (The original Phase 2 spec numbered the web frontend "Phase 4"; we're building it now as the natural next step — roadmap numbering is cosmetic and reconciled in the README as part of this work.)

## Decisions captured during brainstorming

| Question | Choice | Why |
|---|---|---|
| Framework | SvelteKit 2 + Svelte 5, server-rendered, `adapter-node` | Small, fast, minimal client JS; fits the single-container self-hosted model and the compose `web` slot on `:3000`. Adds Svelte to the TS/pnpm monorepo cleanly. |
| Data access | `load` functions import `@ctl/data` and hit Postgres server-side; NO separate API | YAGNI — a separate API buys nothing for a personal-scale SSR app. One DB call per request, server-side. |
| Pages in scope | All: home, division, match-card detail, team, player, club | Full viewer. Built as vertical slices so each is shippable. |
| Division layout | Tabbed (Standings / Fixtures & Results / Rankings) | Chosen via visual mockup. Compact, one section at a time, familiar from sports apps; a small amount of progressive-enhancement JS for tab switching (works without JS too — tabs are anchor links to sections server-side, enhanced to in-page switch). |
| App-likeness | Plain responsive site — no PWA/service worker in v1 | Simplest to ship; works great over Tailscale; manifest/SW can be added later without rework. |
| Access | Tailscale-only via `tailscale serve --https=443`; no auth | Matches the Phase 2 decision (Funnel/public sharing explicitly out of scope). |
| Maps | Address + postcode as text + an external maps link; no embedded map | YAGNI; upstream lat/lng may be absent. |
| Numerics | Half-point values (`pointsWon`, `rankingScore`, `rubbersWon`) stay strings end-to-end | Drizzle returns `numeric` as strings; render verbatim — no float rounding. |

## Architecture

```
Browser (Tailscale device)
   │  HTTPS via `tailscale serve --https=443`
   ▼
apps/web  (SvelteKit, adapter-node, node build on :3000)
   │  load() functions, server-side
   ▼
@ctl/data getters ──► @ctl/db (createDb singleton) ──► Postgres (same DB the scraper writes)
```

- New `apps/web` workspace; workspace deps `@ctl/data`, `@ctl/db` (same pattern as `apps/scraper`).
- `src/lib/server/db.ts` — a single `createDb(process.env.DATABASE_URL)` singleton, server-only (the `server` path keeps the postgres client out of the client bundle).
- TypeScript strict, matching the repo.
- No client-side data fetching; every page is server-rendered HTML. The only client JS is the tab-switch progressive enhancement on the division page.

## Routes & pages

| Route | Page | load() returns | Notes |
|---|---|---|---|
| `/` | Home | current season, divisions grouped by Mens/Ladies/Mixed, season list | Season switcher in header. |
| `/divisions/[slug]` | Division (tabbed) | `getDivisionTable`, `listFixturesByDivision`, `getRankingsByDivision` | Tabs server-rendered as sections; JS enhances to in-page switch. Team/player names link out. |
| `/matches/[id]` | Match-card detail | `getMatchCard(id)` | `[id]` = DB `fixtures.id`. 404 if no card. |
| `/teams/[slug]` | Team | `getTeam(slug)` | Contacts, fixtures, best-effort squad. |
| `/players/[slug]` | Player | `getPlayerProfile(slug)` | Rankings across divisions + match history. |
| `/clubs/[slug]` | Club | `getClubDetail(slug)` | Address/postcode + maps link + teams. |

- Persistent header: league name → `/`, season switcher.
- Breadcrumbs on entity pages.
- A getter returning `null` → SvelteKit `error(404, ...)`.
- All pages deep-linkable and shareable (pure SSR).

## Data-tier additions (`packages/data`)

New/extended getters — pure `(db, ...) => Promise<...>`, Testcontainers-tested like the existing ones:

```ts
// fixtures.ts — new
listFixturesByDivision(db, divisionId): Promise<FixtureRow[]>
// { date, homeTeam{slug,name}, awayTeam{slug,name}, status,
//   score?{home,away}, hasCard:boolean } ordered by date

// match-cards.ts — new file
getMatchCard(db, fixtureId): Promise<MatchCardDetail | null>
// { fixture{date, division{slug,name}, homeTeam{slug,name},
//   awayTeam{slug,name}, score?{home,away}},
//   rubbers[]: { orderInCard,
//     homePlayers[{slug,name}], awayPlayers[{slug,name}],
//     sets[{home,away}] } }
// Resolve player-id arrays → names by collecting all ids across the card's
// rubbers and doing ONE players lookup, mapped in memory (no N+1).

// teams.ts — new file
getTeam(db, slug): Promise<TeamDetail | null>
// { team{slug,name}, club{slug,name}, division{slug,name},
//   contacts[]: from team_contacts,
//   fixtures[]: FixtureRow filtered to this team,
//   squad[]: distinct players appearing in this team's rubbers (best-effort —
//            labelled "players seen this season", not an official roster) }

// players.ts — extend
getPlayerProfile(db, slug): Promise<PlayerProfile | null>
// { player{slug,name}, club{slug,name},
//   rankings[]: { division{slug,name}, rank, rankingScore,
//                 rubbersWon, rubbersPlayed },
//   matchHistory[]: { fixtureId, date, division{slug,name},
//                     partners[{slug,name}], opponents[{slug,name}],
//                     sets[{home,away}] } }

// clubs.ts — extend (keep getClub/ClubSummary for listClubs)
getClubDetail(db, slug): Promise<ClubDetail | null>
// { club{slug,name,address,postcode,lat,lng},
//   teams[{slug,name,division{slug,name}}] }
```

**Modeling note — team squad.** There is no clean team→player roster in the schema (`players.club_id` links to a club, not a team; team membership is only implied by rubber appearances). `getTeam.squad` is therefore derived best-effort from the distinct players who appear in the team's match cards. The UI labels it accordingly; this is a known approximation, not a bug.

## Deployment

- `infra/web.Dockerfile` — multi-stage: pnpm install + build the `@ctl/web` workspace (and its workspace deps), then a slim runtime stage running `node build` on `:3000`.
- `infra/docker-compose.yml` — new `web` service: `depends_on: postgres (service_healthy)`, `DATABASE_URL` env, `restart: unless-stopped`, `image: ghcr.io/danielchicot/calderdale-league-web:latest`, `build:` block for local builds. Expose `:3000` (Tailscale serves it; no public port mapping needed beyond localhost).
- `.github/workflows/build-images.yml` — extend to build + push the web image alongside the scraper on every `main` push.
- `infra/README.md` — operator step: `tailscale serve --https=443 --bg http://localhost:3000`.

## Testing

- **Data getters** — Testcontainers Postgres, seed → call → assert, one test file per new getter (matches `packages/data/tests/*`). Thorough: half-point strings preserved, player-id→name resolution correct, best-effort squad, `null` on missing slug/id, `hasCard` accuracy.
- **Web smoke tests** — a small Vitest suite calling each route's `load` against a seeded Testcontainers DB, asserting the returned shape (no browser, no render). Cheap regression net for getter wiring + 404 paths.
- **No Playwright/full e2e in v1** — overkill for a Tailscale-only personal viewer; the real risk is wrong data, covered by the two layers above.
- The repo's existing `pnpm test` picks up the new workspaces automatically.

## Build order (vertical slices, each shippable)

1. Scaffold `apps/web` (SvelteKit, adapter-node, db singleton, header/layout) + the first data getter wiring proof.
2. Home page + season switcher.
3. Division page (tabbed) + `listFixturesByDivision`.
4. Match-card detail + `getMatchCard`.
5. Team / Player / Club pages + their getters.
6. Docker + compose + GHCR + Tailscale wiring + README.

## Out of scope (v1)

- Archive-season browsing beyond what's in the DB (no backfill trigger from the UI).
- Manual on-demand scrape-refresh trigger (original "Phase 3" ops item — separate).
- Embedded maps.
- Auth / public exposure (Funnel).
- PWA / offline / push.
- The stale-snapshot-rows freshness work (separate P4 issue) — the viewer renders whatever's current; stale rows would simply show until the next scrape corrects them.
