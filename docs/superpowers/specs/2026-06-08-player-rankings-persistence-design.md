# Player rankings persistence

## Goal

Populate the existing `rankings` table on every `pnpm scrape` run by POSTing the rankings page once per division group (Mens, Ladies, Mixed) and writing a row per player per division. Seeds the `players` table as a side effect, unblocking the per-fixture match-card walk (`pi8`).

This is bd issue `calderdale-tennis-league-9am`.

## Decisions captured during brainstorming

| Question | Choice | Why |
|---|---|---|
| Rankings-page shape | Per-group (Mens/Ladies/Mixed), not per-division | The bare GET shows whichever group upstream defaults to (currently Mixed). POST per division returns the full group's leaderboard. So one POST per group gets everything. |
| Walk-step cardinality | 3 POSTs per scrape (one per group) | Minimal requests; the alternative (9 POSTs per division) wastes 6/9 of the work. Trade-off: needs an abbreviation→divisionId mapping. |
| Abbreviation → division mapping | Code-derived: prefix ignored, digit parsed from end | The group comes from our own POST (we know it). The abbreviation just carries the division number. Robust to upstream's quirk: Mens uses "MD1..MD4", Ladies uses "LD1..LD3", Mixed ALSO uses "MD1..MD2" — prefix alone can't distinguish Mens from Mixed. Group-from-step + digit-from-abbrev sidesteps this. |
| Walk-step placement | After per-division loop; new builder `buildPlayerRankingsStep` | Per-division `'player-rankings'` step deleted from `buildDivisionSteps` — was a no-op and all 9 emitted steps shared a URL (1 fetch + 8 conditional-GET skips). |
| Schema | None — `rankings` + `players` + `player_aliases` all exist | The `(player_id, division_id)` unique index is the natural upsert key. |
| Player → division FK | `divisions.name`-keyed lookup, pre-fetched per step | One DB query at the top of the handler builds `Map<name, id>`. Avoids N+1 lookups during the per-row loop. |
| Missing data handling | Skip + log: rows with null `clubName` or unmappable `primaryDivision` | Operator can review the warning counts; tentative players still land via the `needs_review` flag. |

## Scope

**In:**
- Pure helper `resolveDivisionName(group, abbrev)` in `apps/scraper/src/entity-resolver.ts`.
- New parser fixture `fixtures/player-rankings-mens.html` (captured from live POST response for Mens group, modeID=8).
- New `WalkStep` variant `'player-rankings-post'` with `{ url, postBody, group, seasonId }`.
- Remove existing `'player-rankings'` per-division step from `buildDivisionSteps`. Remove the variant from the `WalkStep` union.
- New builder `buildPlayerRankingsStep(seasonName, seasonId, group, sampleModeId)`.
- Orchestrator: new `'player-rankings-post'` handler; new per-group rankings-stage loop in both `runCurrent` and `runSeason`.
- Existing entity resolvers reused: `resolveClub`, `resolvePlayer`.

**Out (separate bd issues):**
- Match-card walk (`pi8`) — depends on this delivering `players`.
- Per-team contacts walk (`i79`).
- Per-team location walk (`3ix`).
- BTM number population (not on this page).
- `runBackfill` N+1 home fetches (`xq6`).

## Architecture / data flow

```
runCurrent:
  1. home → detectAndPersistSeasons
  2. clubs-directory
  3. divisions-discovery
  4. for each division: { league-table-post, fixtures-and-results }     (per-division loop)
  5. for each (group, sampleModeId) of distinct groups in season:        ← NEW stage
       player-rankings-post
         ↳ parsePlayerRankings(html) → PlayerRankingRow[]
         ↳ pre-fetch divisions in this group → Map<name, id>
         ↳ per row: resolveDivisionName(group, primaryDivision) → name → id
                    resolveClub → resolvePlayer
                    upsert rankings on (player_id, division_id)
```

### Walk-plan changes (`apps/scraper/src/walk-plan.ts`)

- **Remove** from the `WalkStep` union:
  ```ts
  | { kind: 'player-rankings'; url: string; divisionSlug: string }
  ```
- **Add**:
  ```ts
  | { kind: 'player-rankings-post'; url: string; postBody: string; group: 'Mens' | 'Ladies' | 'Mixed'; seasonId: number }
  ```
- **Remove** the `'player-rankings'` push from `buildDivisionSteps` (the per-division loop now emits only 2 steps).
- **Add** `buildPlayerRankingsStep(seasonName, seasonId, group, sampleModeId)`:
  ```ts
  export const buildPlayerRankingsStep = (
    seasonName: string,
    seasonId: number,
    group: 'Mens' | 'Ladies' | 'Mixed',
    sampleModeId: number,
  ): WalkStep => ({
    kind: 'player-rankings-post',
    url: `${BASE_SHELL}index.php?navButtonSelect=${encodeURIComponent(seasonName)}&tabIndex=4&refreshProtectionCode=0`,
    postBody: `season_subNav_mode=league&season_subNav_subMode=division&season_subNav_my_division=${sampleModeId}&refreshProtectionCode=0`,
    group,
    seasonId,
  });
  ```

### Orchestrator changes (`apps/scraper/src/orchestrator.ts`)

- **Remove** the no-op `'player-rankings'` case from `handleStep` (now unreachable).
- **Add** `'player-rankings-post'` case (full code below).
- In both `runCurrent` and `runSeason`, after the existing per-division loop and before the function returns, query distinct groups and schedule one step per group:
  ```ts
  // Stage: per-group player rankings (one POST per division group)
  const groupReps = await db
    .select({
      group: schema.divisions.group,
      sampleModeId: sql<number>`MIN(${schema.divisions.upstreamModeId})`.as('sample_mode_id'),
    })
    .from(schema.divisions)
    .where(eq(schema.divisions.seasonId, /* seasonId in scope */))
    .groupBy(schema.divisions.group);

  for (const g of groupReps) {
    const step = buildPlayerRankingsStep(seasonName, seasonId, g.group, g.sampleModeId);
    const outcome = await runStep(step);
    outcome === 'executed' ? report.stepsExecuted++ : outcome === 'skipped' ? report.stepsSkipped++ : report.parseFailures++;
  }
  ```

### The `'player-rankings-post'` handler

```ts
case 'player-rankings-post': {
  const rows = parsePlayerRankings(html);

  // Pre-fetch all divisions in this group/season so the per-row lookup is O(1).
  const divisionsInGroup = await db
    .select({ id: schema.divisions.id, name: schema.divisions.name })
    .from(schema.divisions)
    .where(and(
      eq(schema.divisions.group, step.group),
      eq(schema.divisions.seasonId, step.seasonId),
    ));
  const divisionByName = new Map(divisionsInGroup.map((d) => [d.name, d.id]));

  let skippedNoDivision = 0;
  let skippedNoClub = 0;

  for (const row of rows) {
    const fullName = resolveDivisionName(step.group, row.primaryDivision);
    if (!fullName) { skippedNoDivision++; continue; }
    const divisionId = divisionByName.get(fullName);
    if (divisionId === undefined) { skippedNoDivision++; continue; }

    if (!row.clubName) { skippedNoClub++; continue; }
    const clubId = await resolveClub(db, row.clubName);
    const playerId = await resolvePlayer(db, row.playerName, clubId);

    await db
      .insert(schema.rankings)
      .values({
        playerId,
        divisionId,
        rank: row.rank,
        rubbersWon: String(row.rubbersWon),
        rubbersPlayed: String(row.rubbersPlayed),
        gamesWon: row.gamesWon,
        gamesPlayed: row.gamesPlayed,
        rankingScore: String(row.rankingScore),
        movement: row.movement,
      })
      .onConflictDoUpdate({
        target: [schema.rankings.playerId, schema.rankings.divisionId],
        set: {
          rank: row.rank,
          rubbersWon: String(row.rubbersWon),
          rubbersPlayed: String(row.rubbersPlayed),
          gamesWon: row.gamesWon,
          gamesPlayed: row.gamesPlayed,
          rankingScore: String(row.rankingScore),
          movement: row.movement,
        },
      });
  }

  if (skippedNoDivision > 0) {
    console.warn(`[orchestrator] player-rankings-post: skipped ${skippedNoDivision} rows with unmappable primaryDivision (group=${step.group})`);
  }
  if (skippedNoClub > 0) {
    console.warn(`[orchestrator] player-rankings-post: skipped ${skippedNoClub} rows with null clubName (group=${step.group})`);
  }
  return;
}
```

### The `resolveDivisionName` helper

```ts
// 'Mens'  + 'MD2'  → 'Mens Division 2'
// 'Mixed' + 'MD1'  → 'Mixed Division 1'   (Mixed also uses "MD" prefix; we trust the group)
// 'Ladies'+ 'LD3'  → 'Ladies Division 3'
// Returns null if abbrev is null/undefined or doesn't end in a digit.
export const resolveDivisionName = (
  group: 'Mens' | 'Ladies' | 'Mixed',
  abbrev: string | null,
): string | null => {
  if (!abbrev) return null;
  const m = /(\d+)$/.exec(abbrev);
  if (!m) return null;
  return `${group} Division ${m[1]}`;
};
```

The prefix in `abbrev` is deliberately ignored — the group is authoritative from the step. This sidesteps the upstream quirk where Mens and Mixed both use "MD".

## Schema delta

**None.** The existing `rankings` table already has:
- `(player_id, division_id)` unique index (the upsert natural key).
- `numeric` columns for `rubbers_won`, `rubbers_played`, `ranking_score` (half-points preserved).
- `integer` columns for `games_won`, `games_played`.
- `ranking_movement` pgEnum for `movement`.

`players` and `player_aliases` are already in place with `resolvePlayer(db, observedName, clubId)` doing the transaction-wrapped lookup/insert.

## Walk volume per scrape (current season)

| Stage | Before | After |
|---|---|---|
| home | 1 fetch | 1 fetch |
| clubs-directory | 1 fetch | 1 fetch |
| divisions-discovery | 1 fetch | 1 fetch |
| Per-division (league-table-post + fixtures-and-results + player-rankings) | 9 × 3 = 27 steps (player-rankings = 1 fetch + 8 conditional-GET skips) | 9 × 2 = 18 steps |
| Per-group player rankings | — | 3 fetches |
| **Total scheduled steps** | **30** | **24** |
| **Real fetches** | **~22** | **~24** |
| **Pacing time (1 req/s)** | ~30s | ~24s |

Step count drops, real-fetch count rises slightly (3 POSTs instead of 1 GET), and the new POSTs actually produce data — net positive.

## Testing strategy

**Unit (no DB):**
- `resolveDivisionName`:
  - `('Mens', 'MD2')` → `'Mens Division 2'`
  - `('Mixed', 'MD1')` → `'Mixed Division 1'` (proves prefix is ignored)
  - `('Ladies', 'LD3')` → `'Ladies Division 3'`
  - `('Mens', null)` → `null`
  - `('Mens', 'WeirdLabel')` → `null`
- `parsePlayerRankings` against the new `fixtures/player-rankings-mens.html`:
  - Row count ≥ 200 (live Mens group has ~263 players).
  - `rank` values run from 1 to count (no gaps).
  - All `primaryDivision` values match `/^M[Dx]?\d+$/` or similar (sanity).
  - `rankingScore` values are finite positives.
- `buildPlayerRankingsStep('Summer 2026', 1, 'Mens', 8)`:
  - `kind === 'player-rankings-post'`.
  - URL contains `tabIndex=4` and `navButtonSelect=Summer%202026`.
  - `postBody` includes `season_subNav_my_division=8`.
  - `group === 'Mens'`, `seasonId === 1`.
- `buildDivisionSteps` no longer emits `'player-rankings'`: updated assertion; expected length per division is 2.

**Integration (Testcontainers Postgres):**
- `rankings` upsert idempotency on `(player_id, division_id)`: insert row with rank 5; upsert with rank 3 → single row remains with rank 3.

**Orchestrator end-to-end** (extend `apps/scraper/tests/modes.test.ts`):
- Add `fetchPagePost` routing for `tabIndex=4` URLs → the new rankings fixture.
- After `runCurrent`, assert:
  - `players.length` ≥ 100 (Mens group fixture has ~263 player rows; serving it to all 3 groups means ~263 unique player names per group, but cross-group player overlap is real).
  - `rankings.length > 0` with valid `playerId`/`divisionId`/`rank > 0`.
  - At least one division has ≥ 10 ranking rows present (mirrors the "first division must succeed" assertion used in the standings test).

**Live verification (manual, after merge):**
1. `pnpm db:dev:stop && pnpm db:dev && pnpm db:migrate`
2. `DATABASE_URL=postgres://ctl:ctl@localhost:5433/ctl pnpm scrape`
3. psql:
   - `SELECT COUNT(*) FROM players;` — should be a few hundred (cumulative across groups; players appear once per group page they're on).
   - `SELECT COUNT(*) FROM rankings;` — similar order of magnitude.
   - Group breakdown:
     ```
     SELECT d."group", COUNT(*) FROM rankings r
     JOIN divisions d ON d.id = r.division_id
     GROUP BY d."group" ORDER BY 1;
     ```
   - Leaderboard spot-check:
     ```
     SELECT p.name, r.rank, r.ranking_score
     FROM rankings r JOIN players p ON p.id = r.player_id
     WHERE r.division_id = (SELECT id FROM divisions WHERE slug = 'mens-division-1')
     ORDER BY r.rank LIMIT 10;
     ```
     Should match the live ranking page for Mens Div 1.
   - Operator review queue:
     ```
     SELECT name, needs_review FROM players WHERE needs_review = true LIMIT 20;
     ```
     Likely 100+ tentative players on first scrape — expected; humans curate the canonical names over time.

## Deferred follow-ups

- `pi8` Match-card walk — now unblocked (players exist).
- `i79` Per-team contacts walk.
- `3ix` Per-team location walk.
- `xq6` `runBackfill` N+1 home fetches.

## Out of scope (will not be filed)

- A `player_rankings_history` table (snapshot model chosen for `rankings`).
- BTM number population (separate page, not currently scraped).
- Cross-group player deduplication (a player who appears in both Mens and Mixed groups will be resolved once via slug; that's the existing behaviour and is correct).
- Replacing `parsePlayerRankings` (existing parser is fine; reused as-is).
