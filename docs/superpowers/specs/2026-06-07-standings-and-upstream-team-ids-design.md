# Standings + upstream team IDs via POST league-table walk

## Goal

Populate `standings` (a new snapshot table) and `teams.upstream_team_id` on every `pnpm scrape` run. Both come from a single POST to the league-table page per division — the GET-only walk from Plan C couldn't reach this data because the page ignores `?modeID=…` and division switching is form-driven.

This is Plan A from the Plan-C-era spec; bd issue `calderdale-tennis-league-ke3`.

## Decisions captured during brainstorming

| Question | Choice | Why |
|---|---|---|
| POST mechanics | Confirmed working in spike: `POST index.php?navButtonSelect=<season>&tabIndex=0` with body `season_subNav_mode=league&season_subNav_subMode=division&season_subNav_my_division=<modeID>&refreshProtectionCode=0`. 310 KB response, no cookies, no CSRF. | Removes the largest unknown that previously deferred this work. |
| Scope | Both standings + `upstream_team_id` from the same POST response. | One walk, two payoffs; the response carries both. Also unblocks `i79`/`3ix` (contacts/location) and partially `pi8` (match-cards). |
| Standings model | Snapshot — one row per `(team_id)`, overwritten via `onConflictDoUpdate` each scrape. | Matches reader UX ("show the current table"); avoids time-series growth; no audit-trail need today. |
| Walk integration | New `WalkStep` kind `'league-table-post'` per division; replaces the existing `'league-table'` no-op scaffold step (deleted from the union). | Same request volume as today (29 steps/scrape for the current season); clean discriminated union; one URL = one `scrape_runs` row. |
| `scrape_runs` dedup key | URL with `#bh:<sha256(body).slice(0,8)>` suffix discriminator. | Multiple POST steps share the same URL but differ by body. Suffixing the URL key keeps the schema unchanged and is self-documenting in the DB. |
| `teams.upstream_team_id` | Nullable integer with a **partial** unique index `WHERE upstream_team_id IS NOT NULL`. | Column is populated only after the POST walk runs; clubs-directory and fixtures-and-results paths create teams without it. Partial index keeps uniqueness without forcing the column. |
| Team ID conflict policy | If a team already has a non-null `upstream_team_id` and the new value differs, log a warning and keep the existing value. | Upstream IDs are stable in practice; a diff indicates either parser drift or a real upstream change worth a human's attention. |

## Scope

**In:**
- Parser `parseLeagueTableWithTeamIds(html)` returning `{ standings, teamHandlers }` from a single DOM pass.
- New fixture `fixtures/league-table-mens-div-1-post.html` captured from the live POST response.
- New `WalkStep` variant `'league-table-post'` (replaces `'league-table'`); updated `buildDivisionSteps`.
- `fetchPagePost` on `ScrapeHttpClient` with shared rate-limit + retry + content-hash dedup.
- `scrape_runs.url` discriminator suffix `#bh:<8-hex>` so POST steps for different divisions don't collide.
- Migration `0005_*.sql`:
  - `teams.upstream_team_id INTEGER` nullable + partial unique index.
  - New `standings` table (`team_id PK`, `division_id`, `position`, `results_received`, `results_total`, `points_won`, `points_lost`).
- Orchestrator handler `'league-table-post'`: resolves team names → team_id, sets `upstream_team_id`, upserts standings.

**Out (separate bd issues — already filed):**
- Per-team contacts walk (`i79`).
- Per-team location walk (`3ix`).
- Match-card walk (`pi8`).
- Player rankings persistence (`9am`).
- Division rename-orphan upsert fix (`h9f`).
- `runSeason` non-current divisions-discovery (`r7n`).

## Architecture / data flow

```
runCurrent (unchanged ordering, just denser per-division loop):
  1. home → detectAndPersistSeasons
  2. clubs-directory → resolveClub each row
  3. divisions-discovery → upsert divisions for current season
  4. for each division:
       a. league-table-post  ← NEW (replaces no-op league-table step)
            ↳ parseLeagueTableWithTeamIds(html)
            ↳ per team: resolveTeam → set upstream_team_id
            ↳ per row: upsert standings
       b. fixtures-and-results        (existing, unchanged)
       c. player-rankings             (existing no-op scaffold)
```

### Walk-plan changes (`apps/scraper/src/walk-plan.ts`)

```ts
// Removed: { kind: 'league-table'; url; divisionSlug }
// Added:
| { kind: 'league-table-post'; url: string; divisionId: number; modeId: number; postBody: string }
```

`buildDivisionSteps` produces the new step in place of `'league-table'`:

```ts
const postBody = `season_subNav_mode=league&season_subNav_subMode=division&season_subNav_my_division=${d.upstreamModeId}&refreshProtectionCode=0`;
steps.push({
  kind: 'league-table-post',
  url: `${BASE_SHELL}index.php?navButtonSelect=${seasonParam}&tabIndex=0&refreshProtectionCode=0`,
  divisionId: d.divisionId,
  modeId: d.upstreamModeId,
  postBody,
});
```

The URL points at `index.php` explicitly (the bare `/` form also works but is less explicit for POST).

### HTTP-client changes (`apps/scraper/src/http-client.ts`)

- New public method `fetchPagePost(url, body, prior?): Promise<FetchResult>`. Same return shape as `fetchPage`.
- Shared private helper handles method + body. `fetchPage` becomes a GET shim; `fetchPagePost` is the POST shim.
- POST shim sets `Content-Type: application/x-www-form-urlencoded` plus the existing `User-Agent`. No `If-Modified-Since` (POST isn't cache-friendly); dedup leans entirely on SHA-256 content-hash matching `prior.contentHash`.
- Same 1 req/s rate limit, same 30s timeout, same 3-retry 2/4/8s backoff on 502/503/504.

### Orchestrator changes (`apps/scraper/src/orchestrator.ts`)

- `runStep` (or a small private `dispatchFetch` helper) selects GET vs POST by inspecting `step`. The discriminated-union narrowing handles the type side.
- `runStep` computes a per-step `runKey` for `scrape_runs` lookups and writes — currently `runStep` uses `step.url` directly in three places (prior fetch, executed insert, failed insert). All three change to use `runKey`:
  ```ts
  const runKey = 'postBody' in step
    ? `${step.url}#bh:${sha256(step.postBody).slice(0, 8)}`
    : step.url;
  ```
  No change anywhere else — `runKey` is local to `runStep`.
- New `handleStep` case `'league-table-post'`:
  1. `const parsed = parseLeagueTableWithTeamIds(html);`
  2. For each `{ teamName, upstreamTeamId } of parsed.teamHandlers`:
     - `teamId = await resolveTeam(db, teamName, step.divisionId);`
     - `SELECT upstream_team_id FROM teams WHERE id=teamId`.
     - If NULL: `UPDATE teams SET upstream_team_id = upstreamTeamId WHERE id = teamId`.
     - If non-NULL and equal: no-op.
     - If non-NULL and different: `console.warn` with `teamId/teamName/old/new` and keep the existing value.
  3. For each `{ position, teamName, ... } of parsed.standings`:
     - `teamId = await resolveTeam(db, teamName, step.divisionId);` (idempotent — already created above)
     - `db.insert(standings).values({...}).onConflictDoUpdate({ target: standings.teamId, set: {...} })`.

### Parser additions

**`packages/parser/src/parse-league-table-with-team-ids.ts`:**

```ts
export type StandingsRow = {
  position: number;       // 1..N, derived from DOM order
  teamName: string;
  resultsReceived: number;
  resultsTotal: number;
  pointsWon: number;
  pointsLost: number;
};

export type TeamHandlerEntry = { teamName: string; upstreamTeamId: number };

export type ParsedLeagueTablePage = {
  standings: StandingsRow[];
  teamHandlers: TeamHandlerEntry[];
};

export const parseLeagueTableWithTeamIds = (html: string): ParsedLeagueTablePage;
```

Approach (one DOM pass):
- Select `#leagueTable table.leagueTable_table tbody tr`.
- For each row:
  - Read cells (existing `parseLeagueTable` logic — extract this if duplication grows; for now, copy and adjust).
  - Find the inline `displayContact(this, <ID>)` handler in the row's HTML. We've confirmed every team row has one (`this`, with a numeric arg); the whole-page `displayContact( null, <ID>)` handler lives outside `<tbody>` and isn't matched by the row-scoped search.
  - If no handler is found in the row, **skip the row entirely** — push nothing to either array. This preserves index parity between the two arrays.
  - Otherwise push the team name into both arrays — `standings` with the row data, `teamHandlers` with the upstream ID.

Index parity is invariant by construction: every row push touches both arrays. `standings.length === teamHandlers.length` is a useful test assertion.

The existing `parseLeagueTable` stays unchanged for now; deprecation deferred.

## Schema delta

One new migration (`packages/db/src/migrations/0005_*.sql`).

```sql
-- 1. teams.upstream_team_id (nullable)
ALTER TABLE teams
  ADD COLUMN upstream_team_id INTEGER;
CREATE UNIQUE INDEX teams_upstream_team_id_idx
  ON teams (upstream_team_id) WHERE upstream_team_id IS NOT NULL;

-- 2. standings
CREATE TABLE standings (
  team_id INTEGER PRIMARY KEY REFERENCES teams(id) ON DELETE CASCADE,
  division_id INTEGER NOT NULL REFERENCES divisions(id),
  position INTEGER NOT NULL,
  results_received INTEGER NOT NULL,
  results_total INTEGER NOT NULL,
  points_won NUMERIC NOT NULL,
  points_lost NUMERIC NOT NULL
);
CREATE INDEX standings_division_id_idx ON standings (division_id);
```

Drizzle-side:
- `packages/db/src/schema/teams.ts` — add `upstreamTeamId: integer('upstream_team_id')` plus the partial unique index via `uniqueIndex(...).on(t.upstreamTeamId).where(sql\`upstream_team_id IS NOT NULL\`)`.
- New `packages/db/src/schema/standings.ts` with the table builder.
- `packages/db/src/schema/index.ts` — append `export * from './standings.ts';`.

`teams` already has rows in dev (78 from the last live scrape), so the migration uses `ALTER TABLE … ADD COLUMN` without `NOT NULL` / DEFAULT — no backfill needed because the column is nullable and the next scrape populates it.

## Testing strategy

**Unit (no DB):**
- `parseLeagueTableWithTeamIds` against the new `fixtures/league-table-mens-div-1-post.html`:
  - 10 standings rows; positions `1..10`.
  - Half-point points parse correctly (e.g. `5.5`).
  - 10 team handlers; each `teamName` matches the standings row at the same index.
  - Whole-page `displayContact( null, <ID>)` handler is skipped.
- `buildDivisionSteps` updated to emit `'league-table-post'` (replaces existing assertion on `'league-table'`).

**HTTP-client unit tests** (extend `apps/scraper/tests/http-client.test.ts`):
- `fetchPagePost` sends method `POST`, the form body, and `Content-Type: application/x-www-form-urlencoded`.
- Honours the shared rate-limit (existing test verifies GET; add a parallel one for POST + GET interleaving).
- Returns `'unchanged'` when response hash matches prior.
- Retries on 503 and surfaces 200 OK after a transient failure.

**Integration (Testcontainers Postgres):**
- New schema test: standings insert + upsert idempotency; partial unique on `upstream_team_id` rejects duplicate non-null values, allows multiple NULLs.

**Orchestrator end-to-end** (extend `apps/scraper/tests/modes.test.ts`):
- Update the mocked `http` to expose both `fetchPage` and `fetchPagePost`. Route POSTs whose URL contains `tabIndex=0` to the new fixture.
- After `runCurrent`:
  - `teams.upstream_team_id` populated for ≥ 10 teams (Mens Div 1 alone).
  - `standings` has ≥ 10 rows; position 1 belongs to the team at row 1 of the fixture; numeric points match.

**Live verification (manual, after merge):**
1. `pnpm db:dev:stop && pnpm db:dev && pnpm db:migrate`
2. `DATABASE_URL=postgres://ctl:ctl@localhost:5433/ctl pnpm scrape`
3. psql:
   - `SELECT COUNT(*) FROM standings;` → ≈ 78.
   - `SELECT COUNT(*) FROM teams WHERE upstream_team_id IS NOT NULL;` → ≈ 78.
   - Leaderboard spot-check:
     ```
     SELECT t.name, s.position, s.points_won, s.points_lost
     FROM standings s JOIN teams t ON t.id = s.team_id
     WHERE s.division_id = (SELECT id FROM divisions WHERE slug='mens-division-1')
     ORDER BY s.position;
     ```

## Deferred follow-ups (already filed)

- `i79` — per-team contacts walk (unblocked by this).
- `3ix` — per-team location walk (unblocked by this).
- `pi8` — match-card walk (partially unblocked — still needs players seeding).
- `9am` — player rankings persistence.
- `h9f` — division rename-orphan fix.
- `r7n` — `runSeason` divisions-discovery for archives.

## Out of scope (will not be filed)

- Time-series standings history. Snapshot model chosen.
- Auto-detection of upstream session/CSRF. Spike confirmed neither is needed.
- Deprecating the existing `parseLeagueTable` parser. Lives alongside the new one for now.
- `scrape_runs` schema enrichment (method/body_hash columns). URL-suffix discriminator is sufficient.
