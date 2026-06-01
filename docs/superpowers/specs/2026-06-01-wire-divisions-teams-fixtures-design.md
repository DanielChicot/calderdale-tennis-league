# Wire divisions, teams, and fixtures into the scrape pipeline

## Goal

After the Phase 2 implementation landed, the scraper successfully populated `seasons` and `clubs`, but `divisions`, `teams`, and `fixtures` stayed empty because the orchestrator's per-division loop had nothing to iterate. This design wires those three tables end-to-end via idempotent GETs only, leaving standings + upstream team IDs as a follow-up.

## Decisions captured during brainstorming

| Question | Choice | Why |
|---|---|---|
| How to walk per-division data | GET-only (Plan B/C) — discover divisions from the `<select>` dropdown, walk `displayResults.php?modeID=<N>` per division | The live league-table page **ignores `?modeID=`** — division switching needs a POST. POST has unverified mechanics, no conditional-GET, possible session/cookie complexity. Defer to a later vertical. |
| Sequencing | Phase first (Plan C): GET-only divisions+teams+fixtures now; POST league-table for standings + upstream team IDs as a follow-up bd issue | Lower risk; proves team-name entity resolution end-to-end; unblocks reads in the data tier without waiting on POST debug work. |
| `buildDivisionSteps` shape | Keep `league-table` and `player-rankings` as scaffold (no-op handlers, wasted conditional-GET-skipped requests) | User preference: cheaper to leave the scaffold than re-add later. |
| Divisions discovery cardinality | One bootstrap GET per scrape run (after clubs-directory, before the per-division loop) | Dropdown is identical regardless of which division the page is showing — one fetch suffices. |
| Team aliases | No `team_aliases` table for now | Unlike clubs, teams are scoped per-division — `(slug, division_id)` is unique enough at league scale. Add aliases later if drift shows up. |
| Fixture natural key | `fixtures.upstream_id` (column + unique index already exist in schema) | Each upstream fixture has a stable `fixture_id` carried on its result-card link; we already use it. |
| Fixtures without a `fixtureRef` | Skip + log, don't persist | Every displayResults row should carry a result-card link; if any don't, that's parser drift worth surfacing rather than papering over with a fallback composite key. Add fallback later if real data needs it. |
| Fixture status type | No schema change — `fixture_status` pgEnum + `fixtures.status` column already exist | Caught during spec self-review. |

## Scope

**In:**
- New parser `parseDivisionsDropdown` extracting `{observedName, modeId, group, slug}` from the league-table page's `<select name="season_subNav_division">`.
- New `divisions-discovery` walk step (orchestrator) — one fetch, upserts divisions for the current season.
- Wire the `fixtures-and-results` handler's write path: per `FixtureRow`, resolve home/away team → upsert fixture.
- New `resolveTeam(db, observedName, divisionId)` entity resolver.
- Schema: `divisions.upstream_mode_id` (NOT NULL, unique per season); new `fixture_status` enum used by `fixtures.status`.

**Out (deferred to follow-up bd issues):**
- Standings table — needs POST per division (Plan A).
- `teams.upstream_team_id` from `displayContact(this, <teamID>)` JS handlers — same POST work.
- Per-team contacts/location walks — depend on stable upstream team IDs.
- Per-fixture match-card walks — depend on stable team IDs and player tables.
- Player rankings persistence — separate vertical; `rankings` schema already exists.

## Architecture / data flow

```
runCurrent:
  1. home → detectAndPersistSeasons             (existing)
  2. clubs-directory → resolveClub each row     (existing)
  3. divisions-discovery  ← NEW                  fetch one league-table page,
                                                  parseDivisionsDropdown,
                                                  upsert divisions for current season
  4. for each division in current season:
       a. league-table                          (existing no-op scaffold)
       b. fixtures-and-results
            ↳ parser returns FixtureRow[]
            ↳ NEW: resolveTeam(name, divisionId) → ids
            ↳ NEW: upsert fixture row
       c. player-rankings                       (existing no-op scaffold)
```

**Walk-plan changes (`apps/scraper/src/walk-plan.ts`):**
- New `WalkStep` kind: `'divisions-discovery'`.
- `buildInitialSteps` unchanged (it has no season name available — it's called before season detection).
- New `buildDivisionsDiscoveryStep(seasonName: string): WalkStep` returning a step with URL `${BASE_SHELL}?navButtonSelect=${encodeURIComponent(seasonName)}&tabIndex=0&refreshProtectionCode=0`. Called by the orchestrator after `detectAndPersistSeasons` returns.
- `buildDivisionSteps` unchanged.

**Orchestrator changes (`apps/scraper/src/orchestrator.ts`):**
- After season detection + clubs-directory, schedule the new divisions-discovery step via `runStep`.
- Add `'divisions-discovery'` case to `handleStep`: parse dropdown, upsert each row into `divisions` (`onConflictDoUpdate` on `(slug, season_id)` updates name + `upstream_mode_id`).
- Replace the `fixtures-and-results` no-op with: iterate `FixtureRow[]`, skip rows without `fixtureRef` (and log a count at end of step), call `resolveTeam` for home + away, upsert fixture.

**Fixture upsert detail:**
- Natural key: `upstream_id` (already a unique index on `fixtures.upstream_id`).
- `onConflictDoUpdate` on the unique index updates `status` and `date` — these can change as results land or fixtures move.
- `date` parsing already lives in the parser; orchestrator stores `parsed.date` directly.
- If `score` is present, also upsert into the existing `results` table (fixture_id → home_score/away_score). This is the smallest extra surface that makes "completed" fixtures useful for reads, and the `results` schema is already in place.

## Schema delta

One new migration (`packages/db/src/migrations/0004_*.sql`) — single change:

```sql
ALTER TABLE divisions
  ADD COLUMN upstream_mode_id INTEGER NOT NULL;
CREATE UNIQUE INDEX divisions_upstream_mode_id_season_idx
  ON divisions (upstream_mode_id, season_id);
```

Drizzle-side: add `upstreamModeId: integer('upstream_mode_id').notNull()` to `packages/db/src/schema/divisions.ts`, plus the unique index in the table builder. Generate via `pnpm --filter @ctl/db db:generate`, eyeball the SQL, commit both `.ts` and `.sql` files.

`divisions` is empty in the dev DB, so `NOT NULL` is safe without a backfill default.

**Already in place** (caught during self-review — no migration needed):
- `fixture_status` pgEnum with all 8 statuses (`packages/db/src/schema/fixtures.ts`).
- `fixtures.upstream_id` column + unique index — serves as the fixture natural key.
- `results` table — used for completed-fixture scores.

## Parser additions

**`packages/parser/src/parse-divisions-dropdown.ts`:**

```ts
export type DivisionsDropdownRow = {
  observedName: string;                   // "Mens Division 1"
  modeId: number;                          // 8
  group: 'Mens' | 'Ladies' | 'Mixed';
  slug: string;                            // "mens-division-1"
};

export const parseDivisionsDropdown = (html: string): DivisionsDropdownRow[];
```

Selector: `select[name="season_subNav_division"] option[value]`. Skip `value="0"` / empty placeholders. Infer `group` from name prefix (Mens / Ladies / Mixed) — throw if it doesn't match those three.

Tested against `fixtures/league-table-mixed-div-1.html`, which carries all 9 options.

## Entity resolution

**`apps/scraper/src/entity-resolver.ts` — new `resolveTeam`:**

```ts
export const resolveTeam = async (
  db: Database,
  observedName: string,                    // e.g. "Halifax Queens A"
  divisionId: number,
): Promise<number>;                        // returns team.id
```

Algorithm:
1. Lookup `(slug=slugify(observedName), division_id)` in `teams`. If found, return its id.
2. Strip trailing single-letter token via `/^(.*\S)\s+[A-Z]$/`. If no match, use the full name as the club name candidate.
3. Call existing `resolveClub(db, clubName)` → `club_id` (creates a tentative `needs_review` club if unknown — existing behavior).
4. Insert `teams` row `{slug, name: observedName, clubId, divisionId}`. Return id.

**`stripTeamSuffix` helper** — pure function in the same file or shared with the parser package; lives wherever the existing slugify helper does.

**Edge cases:**
- Multi-word suffix ("Reserves", "Vets") — regex doesn't match; full name goes to `resolveClub`, which creates a tentative club. Operator catches via `needs_review`.
- Singleton team (no suffix) — same path, clean.
- Same team across divisions (promotion/relegation) — different `(slug, division_id)` → distinct rows. Correct.

## Testing strategy

**Unit (no DB):**
- `parseDivisionsDropdown` against `league-table-mixed-div-1.html`:
  - Exactly 9 rows.
  - modeIDs `{3, 4, 5, 6, 8, 9, 10, 11, 14}` present.
  - Groups: 2 Mixed, 3 Ladies, 4 Mens.
  - Slugs kebab-case.
- `stripTeamSuffix` — golden cases: `"Halifax Queens A"`, `"Akroydon"`, `"Halifax Queens Reserves"`, `"X B"` (single-word + letter).

**Integration (Testcontainers Postgres):**
- `resolveTeam`:
  - Idempotent: same `(observedName, divisionId)` returns same id on second call.
  - Known club: seed `clubs` + `club_aliases`, resolve "Halifax Queens A" → team with correct `club_id`.
  - Unknown club: resolve "Mystery Players B" → creates tentative `needs_review` club + team, linked.
- Migration smoke (extend existing schema test): unique index on `(upstream_mode_id, season_id)` rejects same-season duplicates, accepts cross-season same modeID.

**Orchestrator end-to-end** (extend `apps/scraper/tests/modes.test.ts`):
- Mock `http.fetchPage` to route URLs:
  - `*/?` (bare home) → `season-nav.html`
  - `*?navButtonSelect=Directory*` → `clubs-directory.html`
  - `*?navButtonSelect=Summer*tabIndex=0*` → `league-table-mixed-div-1.html`
  - `*displayResults.php*` → `fixtures-and-results-mens-div-1.html`
  - everything else → `unchanged` or empty 200
- After `runCurrent`, assert:
  - `seasons` has 1 row with `current=true`
  - `clubs` count ≥ 1
  - `divisions` has 9 rows with `upstream_mode_id` populated
  - `teams` count ≥ 6
  - `fixtures` count ≥ 1, with non-null FKs, valid `status`, and `upstream_id` populated
  - `results` has rows for completed fixtures (numeric scores)

**Live verification** (manual, after merge):
1. `pnpm db:dev:stop && pnpm db:dev && pnpm db:migrate`
2. `DATABASE_URL=postgres://ctl:ctl@localhost:5433/ctl pnpm scrape`
3. `psql` checks:
   - `select count(*) from divisions;` → 9
   - `select group, count(*) from divisions group by group;` → 2 Mixed, 3 Ladies, 4 Mens
   - `select count(*) from teams;` → expect ~50–60
   - `select count(*) from fixtures;` → expect 150+, all with `upstream_id` set
   - `select count(*) from results;` → expect non-zero (completed fixtures only)
   - `select canonical_name from clubs where needs_review = true;` → eyeball tentatives (should be empty or small)

## Deferred follow-ups (separate bd issues)

These are explicitly out of scope and will be filed as new bd issues:

1. **Standings + upstream team IDs via POST league-table walk** (Plan A). Adds:
   - `standings` table (position, points_won, points_lost, results_received).
   - `teams.upstream_team_id` column, populated from `displayContact(this, <teamID>)` handlers.
   - POST mechanism in `http-client`, including any cookie/session handling.
2. **Per-team contacts walk** — depends on (1) for stable team IDs.
3. **Per-team location walk** — depends on (1).
4. **Per-fixture match-card walk** — depends on (1) and on the players table being seeded (separate vertical).
5. **Player rankings persistence** — schema exists; parser exists; just needs the orchestrator write path.

## Out of scope (will not be filed)

- Tournament/knockout data (not part of the current scope, separate league feature).
- Historical season backfill — `runBackfill` mode is already wired and will work once divisions/teams/fixtures are populating for `runCurrent`.
