# Player Rankings Persistence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Populate the existing `rankings` table (and seed `players`) on every `pnpm scrape` run by POSTing the rankings page once per division group (Mens/Ladies/Mixed) and upserting a row per player per division.

**Architecture:** A new `'player-rankings-post'` walk step (one per group, scheduled after the per-division loop) replaces the per-division `'player-rankings'` no-op steps. The existing `parsePlayerRankings` parser is reused as-is. Each row's `primaryDivision` abbreviation (e.g. `MD2`) is mapped to a division row via a new pure helper `resolveDivisionName(group, abbrev)` — the group comes authoritatively from the step (Mens and Mixed both abbreviate to "MD", so the prefix is deliberately ignored), and the digit selects the division. Existing `resolveClub`/`resolvePlayer` entity resolvers provide the FKs. No schema change.

**Tech Stack:** TypeScript 5.6 (strict, verbatimModuleSyntax, exactOptionalPropertyTypes, noUncheckedIndexedAccess), pnpm 9 workspaces, Drizzle ORM 0.36 + postgres-js 3.4, Cheerio (named `load` import), Vitest 2.1, Testcontainers 10.13 (`GenericContainer` postgres:16-alpine).

**Spec:** `docs/superpowers/specs/2026-06-08-player-rankings-persistence-design.md`
**Fixture (already captured + committed):** `fixtures/player-rankings-mens.html` — 261 rows, `primaryDivision` values `MD1..MD4`, rank 1 = "James Hodgson" / club "Akroydon" / `rankingScore` 509.7 / movement `'up'`. Verified parseable by the existing `parsePlayerRankings`.

---

### Task 1: `resolveDivisionName` pure helper

**Files:**
- Modify: `apps/scraper/src/entity-resolver.ts` (append helper)
- Modify: `apps/scraper/tests/entity-resolver.test.ts` (add tests)

**Context:** Pure function, no DB. Maps `(group, abbrev)` → canonical division name. The abbreviation prefix is deliberately ignored: upstream uses "MD" for BOTH Mens and Mixed, so the group must come from the step that POSTed for it. Only the trailing digits matter.

- [ ] **Step 1: Write the failing tests**

Modify `apps/scraper/tests/entity-resolver.test.ts`. Update the top-level import to include the new helper:

```ts
import { resolveClub, resolvePlayer, resolveTeam, stripTeamSuffix, resolveDivisionName } from '../src/entity-resolver.js';
```

Add this `describe` block at the bottom of the file (after the existing `describe('stripTeamSuffix', ...)` block closes — it is a sibling, NOT nested inside the Testcontainers describe):

```ts
describe('resolveDivisionName', () => {
  it('maps Mens abbreviations', () => {
    expect(resolveDivisionName('Mens', 'MD2')).toBe('Mens Division 2');
    expect(resolveDivisionName('Mens', 'MD4')).toBe('Mens Division 4');
  });

  it('ignores the abbreviation prefix — Mixed also uses MD', () => {
    expect(resolveDivisionName('Mixed', 'MD1')).toBe('Mixed Division 1');
  });

  it('maps Ladies abbreviations', () => {
    expect(resolveDivisionName('Ladies', 'LD3')).toBe('Ladies Division 3');
  });

  it('returns null for null abbreviation', () => {
    expect(resolveDivisionName('Mens', null)).toBeNull();
  });

  it('returns null when no trailing digit', () => {
    expect(resolveDivisionName('Mens', 'WeirdLabel')).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run apps/scraper/tests/entity-resolver.test.ts -t "resolveDivisionName"`
Expected: FAIL (`resolveDivisionName` not exported).

- [ ] **Step 3: Add the helper**

Append to `apps/scraper/src/entity-resolver.ts`:

```ts
// Maps a player-rankings abbreviation to the canonical division name.
//   'Mens'  + 'MD2' → 'Mens Division 2'
//   'Mixed' + 'MD1' → 'Mixed Division 1'   (Mixed also uses the "MD" prefix upstream —
//                                           the group from our own POST is authoritative)
//   'Ladies'+ 'LD3' → 'Ladies Division 3'
// Returns null when abbrev is null or carries no trailing digit.
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

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run apps/scraper/tests/entity-resolver.test.ts -t "resolveDivisionName"`
Expected: 5 passed (DB-backed tests in the same file are filtered out by `-t` and report as skipped).

- [ ] **Step 5: Commit**

```bash
git add apps/scraper/src/entity-resolver.ts apps/scraper/tests/entity-resolver.test.ts
git commit -m "feat(scraper): add resolveDivisionName helper for rankings abbreviations"
```

---

### Task 2: Parser regression tests against the Mens rankings fixture

**Files:**
- Modify: `packages/parser/tests/parse-player-rankings.test.ts`

**Context:** No parser change — `parsePlayerRankings` already handles the new fixture (verified during planning: 261 rows, clean data). This task locks that behaviour in with fixture-specific assertions so future parser edits can't silently break the POST-response shape. The existing tests use `player-rankings-mixed-div-1.html`; these new tests use `player-rankings-mens.html`.

- [ ] **Step 1: Write the tests**

Append inside the existing `describe('parsePlayerRankings', ...)` block in `packages/parser/tests/parse-player-rankings.test.ts`, before its closing `});`:

```ts
  it('parses the full Mens group POST fixture (261 rows)', async () => {
    const html = await loadFixture('player-rankings-mens.html');
    const rows = parsePlayerRankings(html);
    expect(rows).toHaveLength(261);
    expect(rows.every((r, i) => r.rank === i + 1)).toBe(true);
  });

  it('Mens fixture: primaryDivision spans MD1..MD4 and nothing else', async () => {
    const html = await loadFixture('player-rankings-mens.html');
    const rows = parsePlayerRankings(html);
    const divisions = new Set(rows.map((r) => r.primaryDivision));
    expect(divisions).toEqual(new Set(['MD1', 'MD2', 'MD3', 'MD4']));
  });

  it('Mens fixture: locks in the rank-1 row values', async () => {
    const html = await loadFixture('player-rankings-mens.html');
    const rows = parsePlayerRankings(html);
    expect(rows[0]).toEqual({
      rank: 1,
      playerName: 'James Hodgson',
      clubName: 'Akroydon',
      primaryDivision: 'MD1',
      rubbersWon: 13,
      rubbersPlayed: 14,
      gamesWon: 183,
      gamesPlayed: 297,
      rankingScore: 509.7,
      movement: 'up',
    });
  });

  it('Mens fixture: every row has a clubName (no null clubs in this group)', async () => {
    const html = await loadFixture('player-rankings-mens.html');
    const rows = parsePlayerRankings(html);
    expect(rows.every((r) => r.clubName !== null)).toBe(true);
  });
```

- [ ] **Step 2: Run tests to verify they pass**

Run: `pnpm vitest run packages/parser/tests/parse-player-rankings.test.ts`
Expected: 9 passed (5 existing + 4 new). These pass immediately — the parser already handles the fixture; the tests are regression locks, not TDD-red.

- [ ] **Step 3: Commit**

```bash
git add packages/parser/tests/parse-player-rankings.test.ts
git commit -m "test(parser): lock in parsePlayerRankings behaviour on the Mens POST fixture"
```

---

### Task 3: Walk-plan — `'player-rankings-post'` replaces `'player-rankings'`

**Files:**
- Modify: `apps/scraper/src/walk-plan.ts`
- Modify: `apps/scraper/tests/walk-plan.test.ts`

**Context:** The per-division `'player-rankings'` step was a no-op AND all 9 emitted steps shared the same URL (1 fetch + 8 conditional-GET skips). It is removed from the union and from `buildDivisionSteps`. The new per-group step is built by a new standalone builder; the orchestrator (Task 4) schedules it after the division loop.

Note: after this task the orchestrator still has a stale `'player-rankings'` case — it no longer compiles under `tsc --noEmit` until Task 4 lands. That's acceptable: the project's test runner (vitest + tsx) is transpile-only and there is no `tsc --noEmit` CI gate. The same two-task pattern was used for the `league-table-post` swap.

- [ ] **Step 1: Update the existing tests**

Modify `apps/scraper/tests/walk-plan.test.ts`. Update the import to include the new builder:

```ts
import { buildInitialSteps, buildDivisionSteps, buildMatchCardStep, buildDivisionsDiscoveryStep, buildPlayerRankingsStep } from '../src/walk-plan.js';
```

Replace the test `'division steps include league-table-post + fixtures + rankings for each division'` with:

```ts
  it('division steps include league-table-post + fixtures for each division (rankings moved to per-group)', () => {
    const steps = buildDivisionSteps('Summer 2026', [
      { divisionId: 1, divisionSlug: 'mens-1', upstreamModeId: 8 },
      { divisionId: 2, divisionSlug: 'mens-2', upstreamModeId: 9 },
    ]);
    expect(steps).toHaveLength(4);
    expect(steps.map((s) => s.kind)).toEqual([
      'league-table-post',
      'fixtures-and-results',
      'league-table-post',
      'fixtures-and-results',
    ]);
  });
```

Append a new test before the closing `});` of `describe('walk plan', ...)`:

```ts
  it('player rankings step carries group, seasonId, and the form body for the sample modeID', () => {
    const step = buildPlayerRankingsStep('Summer 2026', 7, 'Mens', 8);
    expect(step.kind).toBe('player-rankings-post');
    if (step.kind === 'player-rankings-post') {
      expect(step.url).toContain('index.php?navButtonSelect=Summer%202026&tabIndex=4');
      expect(step.postBody).toBe('season_subNav_mode=league&season_subNav_subMode=division&season_subNav_my_division=8&refreshProtectionCode=0');
      expect(step.group).toBe('Mens');
      expect(step.seasonId).toBe(7);
    }
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run apps/scraper/tests/walk-plan.test.ts`
Expected: FAIL — `buildPlayerRankingsStep` not exported; the division-steps test expects length 4 but gets 6.

- [ ] **Step 3: Update the WalkStep union and builders**

Modify `apps/scraper/src/walk-plan.ts`.

a. In the `WalkStep` union, REPLACE the line:

```ts
  | { kind: 'player-rankings'; url: string; divisionSlug: string }
```

with:

```ts
  | { kind: 'player-rankings-post'; url: string; postBody: string; group: 'Mens' | 'Ladies' | 'Mixed'; seasonId: number }
```

b. In `buildDivisionSteps`, DELETE the third `steps.push` (the `'player-rankings'` block):

```ts
    steps.push({
      kind: 'player-rankings',
      url: `${BASE_SHELL}?navButtonSelect=${seasonParam}&tabIndex=4&refreshProtectionCode=0`,
      divisionSlug: d.divisionSlug,
    });
```

(The loop now pushes only `league-table-post` and `fixtures-and-results`.)

c. Append the new builder at the bottom of the file:

```ts
export const buildPlayerRankingsStep = (
  seasonName: string,
  seasonId: number,
  group: 'Mens' | 'Ladies' | 'Mixed',
  sampleModeId: number,
): WalkStep => ({
  kind: 'player-rankings-post',
  // tabIndex=4 is the Player Rankings tab. The POST body selects any division in the
  // target group — the response carries the WHOLE group's leaderboard.
  url: `${BASE_SHELL}index.php?navButtonSelect=${encodeURIComponent(seasonName)}&tabIndex=4&refreshProtectionCode=0`,
  postBody: `season_subNav_mode=league&season_subNav_subMode=division&season_subNav_my_division=${sampleModeId}&refreshProtectionCode=0`,
  group,
  seasonId,
});
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run apps/scraper/tests/walk-plan.test.ts`
Expected: 6 passed (5 existing-after-edit + 1 new).

- [ ] **Step 5: Commit**

```bash
git add apps/scraper/src/walk-plan.ts apps/scraper/tests/walk-plan.test.ts
git commit -m "feat(scraper): replace per-division player-rankings step with per-group POST step"
```

---

### Task 4: Orchestrator — wire the `'player-rankings-post'` handler + per-group stage

**Files:**
- Modify: `apps/scraper/src/orchestrator.ts`

**Context:** Three changes in one file:
1. Imports: add `and`, `sql` to the drizzle import; `resolvePlayer`, `resolveDivisionName` to the entity-resolver import; `buildPlayerRankingsStep` to the walk-plan import.
2. `handleStep`: DELETE the stale `'player-rankings'` no-op case; ADD the `'player-rankings-post'` case.
3. `runCurrent` AND `runSeason`: after the per-division loop, query distinct groups and schedule one rankings step per group.

No new orchestrator unit tests in this task — Task 6 covers end-to-end. The existing `modes.test.ts` keeps passing without modification: its `fetchPagePost` mock routes `tabIndex=0` URLs to the league-table fixture and everything else (including the new `tabIndex=4` rankings URLs) to empty `<html></html>`, for which `parsePlayerRankings` returns `[]` and the new handler is a no-op.

- [ ] **Step 1: Update the imports**

In `apps/scraper/src/orchestrator.ts`:

a. Replace the first line:

```ts
import { eq } from 'drizzle-orm';
```

with:

```ts
import { and, eq, sql } from 'drizzle-orm';
```

b. Replace the entity-resolver import:

```ts
import { resolveClub, resolveTeam } from './entity-resolver.js';
```

with:

```ts
import { resolveClub, resolvePlayer, resolveTeam, resolveDivisionName } from './entity-resolver.js';
```

c. In the walk-plan import block, add `buildPlayerRankingsStep`:

```ts
import {
  buildInitialSteps,
  buildDivisionSteps,
  buildDivisionsDiscoveryStep,
  buildMatchCardStep,
  buildPlayerRankingsStep,
  type WalkStep,
  type DivisionDescriptor,
} from './walk-plan.js';
```

- [ ] **Step 2: Replace the `'player-rankings'` case with `'player-rankings-post'`**

In the `handleStep` switch, find:

```ts
      case 'player-rankings': {
        parsePlayerRankings(html);
        // Resolve player and division; upsert ranking row.
        return;
      }
```

Replace with:

```ts
      case 'player-rankings-post': {
        const rows = parsePlayerRankings(html);

        // Pre-fetch all divisions in this group/season so the per-row lookup is O(1).
        const divisionsInGroup = await db
          .select({ id: schema.divisions.id, name: schema.divisions.name })
          .from(schema.divisions)
          .where(
            and(eq(schema.divisions.group, step.group), eq(schema.divisions.seasonId, step.seasonId)),
          );
        const divisionByName = new Map(divisionsInGroup.map((d) => [d.name, d.id]));

        let skippedNoDivision = 0;
        let skippedNoClub = 0;

        for (const row of rows) {
          const fullName = resolveDivisionName(step.group, row.primaryDivision);
          if (!fullName) {
            skippedNoDivision++;
            continue;
          }
          const divisionId = divisionByName.get(fullName);
          if (divisionId === undefined) {
            skippedNoDivision++;
            continue;
          }

          if (!row.clubName) {
            skippedNoClub++;
            continue;
          }
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
          console.warn(
            `[orchestrator] player-rankings-post: skipped ${skippedNoDivision} row(s) with unmappable primaryDivision (group=${step.group})`,
          );
        }
        if (skippedNoClub > 0) {
          console.warn(
            `[orchestrator] player-rankings-post: skipped ${skippedNoClub} row(s) with null clubName (group=${step.group})`,
          );
        }
        return;
      }
```

- [ ] **Step 3: Add the per-group rankings stage to `runCurrent`**

In `runCurrent`, find the end of the per-division loop:

```ts
    const divisionSteps = buildDivisionSteps(detection.currentSeasonName, descriptors);
    for (const step of divisionSteps) {
      const outcome = await runStep(step);
      outcome === 'executed' ? report.stepsExecuted++ : outcome === 'skipped' ? report.stepsSkipped++ : report.parseFailures++;
    }

    return report;
```

Replace with:

```ts
    const divisionSteps = buildDivisionSteps(detection.currentSeasonName, descriptors);
    for (const step of divisionSteps) {
      const outcome = await runStep(step);
      outcome === 'executed' ? report.stepsExecuted++ : outcome === 'skipped' ? report.stepsSkipped++ : report.parseFailures++;
    }

    // 4. Per-group player rankings — one POST per division group. Each response
    // carries the whole group's leaderboard, so 3 fetches cover all 9 divisions.
    const groupReps = await db
      .select({
        group: schema.divisions.group,
        sampleModeId: sql<number>`MIN(${schema.divisions.upstreamModeId})`.as('sample_mode_id'),
      })
      .from(schema.divisions)
      .where(eq(schema.divisions.seasonId, detection.currentSeasonId))
      .groupBy(schema.divisions.group);

    for (const g of groupReps) {
      const rankStep = buildPlayerRankingsStep(
        detection.currentSeasonName,
        detection.currentSeasonId,
        g.group,
        Number(g.sampleModeId),
      );
      const outcome = await runStep(rankStep);
      outcome === 'executed' ? report.stepsExecuted++ : outcome === 'skipped' ? report.stepsSkipped++ : report.parseFailures++;
    }

    return report;
```

- [ ] **Step 4: Add the same stage to `runSeason`**

In `runSeason`, find the end of its per-division loop:

```ts
    for (const step of buildDivisionSteps(season.name, descriptors)) {
      const outcome = await runStep(step);
      outcome === 'executed'
        ? report.stepsExecuted++
        : outcome === 'skipped'
          ? report.stepsSkipped++
          : report.parseFailures++;
    }
    return report;
```

Replace with:

```ts
    for (const step of buildDivisionSteps(season.name, descriptors)) {
      const outcome = await runStep(step);
      outcome === 'executed'
        ? report.stepsExecuted++
        : outcome === 'skipped'
          ? report.stepsSkipped++
          : report.parseFailures++;
    }

    // Per-group player rankings — same stage as runCurrent, keyed to this season.
    const groupReps = await db
      .select({
        group: schema.divisions.group,
        sampleModeId: sql<number>`MIN(${schema.divisions.upstreamModeId})`.as('sample_mode_id'),
      })
      .from(schema.divisions)
      .where(eq(schema.divisions.seasonId, season.id))
      .groupBy(schema.divisions.group);

    for (const g of groupReps) {
      const rankStep = buildPlayerRankingsStep(season.name, season.id, g.group, Number(g.sampleModeId));
      const outcome = await runStep(rankStep);
      outcome === 'executed' ? report.stepsExecuted++ : outcome === 'skipped' ? report.stepsSkipped++ : report.parseFailures++;
    }
    return report;
```

- [ ] **Step 5: Run the full suite to confirm no regression**

Run: `pnpm test`
Expected: all tests pass (~167 after Tasks 1-3 added theirs). The `modes.test.ts` end-to-end keeps passing — its `fetchPagePost` fallback serves `<html></html>` for the new `tabIndex=4` URLs, `parsePlayerRankings` returns `[]`, and the handler no-ops (it does run the `divisionsInGroup` query, which is harmless).

- [ ] **Step 6: Commit**

```bash
git add apps/scraper/src/orchestrator.ts
git commit -m "feat(scraper): wire player-rankings-post handler with per-group walk stage"
```

---

### Task 5: `rankings` upsert idempotency test

**Files:**
- Modify: `packages/db/tests/rankings-and-runs.test.ts`

**Context:** The orchestrator handler relies on `onConflictDoUpdate` keyed on the `(player_id, division_id)` unique index (`rankings_player_division_idx`). This test locks in that the upsert overwrites rather than duplicates. The file's convention: no global `beforeEach` truncate — each test does its own targeted `TRUNCATE`.

- [ ] **Step 1: Write the test**

Append inside the existing `describe('rankings + scrape_runs + seed', ...)` block in `packages/db/tests/rankings-and-runs.test.ts`, before its closing `});`:

```ts
  it('ranking upserts on (player_id, division_id) conflict', async () => {
    const db = getDb();
    await db.execute(sql`TRUNCATE seasons, divisions, clubs, club_aliases, teams, players, player_aliases, rankings RESTART IDENTITY CASCADE`);
    const [season] = await db.insert(seasons).values({ slug: 's', name: 'S', current: true }).returning();
    const [division] = await db.insert(divisions).values({ slug: 'd', name: 'D', group: 'Mens', seasonId: season!.id, upstreamModeId: 1 }).returning();
    const [club] = await db.insert(clubs).values({ slug: 'c', canonicalName: 'C' }).returning();
    const [player] = await db.insert(players).values({ slug: 'p', name: 'P', clubId: club!.id }).returning();

    const base = {
      playerId: player!.id,
      divisionId: division!.id,
      rubbersWon: '5',
      rubbersPlayed: '8',
      gamesWon: 50,
      gamesPlayed: 80,
      movement: 'same' as const,
    };
    await db.insert(rankings).values({ ...base, rank: 9, rankingScore: '100.5' });
    await db
      .insert(rankings)
      .values({ ...base, rank: 4, rankingScore: '210.25' })
      .onConflictDoUpdate({
        target: [rankings.playerId, rankings.divisionId],
        set: { rank: 4, rankingScore: '210.25' },
      });

    const rows = await db.select().from(rankings);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.rank).toBe(4);
    expect(rows[0]?.rankingScore).toBe('210.25');
  });
```

- [ ] **Step 2: Run the test**

Run: `pnpm vitest run packages/db/tests/rankings-and-runs.test.ts`
Expected: 4 passed (3 existing + 1 new). This passes immediately — the unique index already exists; the test is a regression lock.

- [ ] **Step 3: Commit**

```bash
git add packages/db/tests/rankings-and-runs.test.ts
git commit -m "test(db): lock in rankings upsert on (player_id, division_id)"
```

---

### Task 6: End-to-end test covering players + rankings

**Files:**
- Modify: `apps/scraper/tests/modes.test.ts`

**Context:** Extend the existing `runCurrent` end-to-end test: route `tabIndex=4` POSTs to the new rankings fixture and assert players + rankings land.

A note on what the mock produces: the same Mens fixture (MD1..MD4, 261 rows) is served for all three group steps. For group=Mens, all four abbreviations map (`Mens Division 1..4` all exist). For group=Ladies, digits 1..3 map to `Ladies Division 1..3` (digit 4 is skipped). For group=Mixed, digits 1..2 map. Players resolve once globally by name (the `player_aliases` unique index), so `players` lands ~261 rows; `rankings` lands one row per (player, mapped-division) pair — comfortably several hundred.

- [ ] **Step 1: Update the test**

Modify `apps/scraper/tests/modes.test.ts`.

a. Rename the test and load the new fixture. Replace:

```ts
  it('runCurrent populates seasons, clubs, divisions, teams, fixtures, standings, upstream_team_id', async () => {
    const seasonNav = await fixtureHtml('season-nav.html');
    const clubsDir = await fixtureHtml('clubs-directory.html');
    const leagueTablePost = await fixtureHtml('league-table-mens-div-1-post.html');
    const fixturesAndResults = await fixtureHtml('fixtures-and-results-mens-div-1.html');
```

with:

```ts
  it('runCurrent populates seasons, clubs, divisions, teams, fixtures, standings, rankings', async () => {
    const seasonNav = await fixtureHtml('season-nav.html');
    const clubsDir = await fixtureHtml('clubs-directory.html');
    const leagueTablePost = await fixtureHtml('league-table-mens-div-1-post.html');
    const fixturesAndResults = await fixtureHtml('fixtures-and-results-mens-div-1.html');
    const playerRankings = await fixtureHtml('player-rankings-mens.html');
```

b. Route rankings POSTs. Replace the `fetchPagePost` mock:

```ts
      fetchPagePost: vi.fn(async (url: string, body: string) => {
        if (url.includes('index.php') && url.includes('tabIndex=0')) {
          return { kind: 'changed' as const, status: 200, html: leagueTablePost, contentHash: `ltp:${body}`.slice(0, 64) };
        }
        return { kind: 'changed' as const, status: 200, html: '<html></html>', contentHash: `pst:${url}`.slice(0, 64) };
      }),
```

with:

```ts
      fetchPagePost: vi.fn(async (url: string, body: string) => {
        if (url.includes('index.php') && url.includes('tabIndex=0')) {
          return { kind: 'changed' as const, status: 200, html: leagueTablePost, contentHash: `ltp:${body}`.slice(0, 64) };
        }
        if (url.includes('index.php') && url.includes('tabIndex=4')) {
          // Per-group rankings POSTs — all three groups get the Mens fixture; the
          // handler maps each group's digits onto that group's real divisions.
          return { kind: 'changed' as const, status: 200, html: playerRankings, contentHash: `pr:${body}`.slice(0, 64) };
        }
        return { kind: 'changed' as const, status: 200, html: '<html></html>', contentHash: `pst:${url}`.slice(0, 64) };
      }),
```

c. Add assertions. After the existing standings assertions (the `firstDivStandings` / `positions` block) and before the final `fixtures` assertion, insert:

```ts
    const players = await db.select().from(schema.players);
    expect(players.length).toBeGreaterThanOrEqual(200);

    const rankingsRows = await db.select().from(schema.rankings);
    expect(rankingsRows.length).toBeGreaterThanOrEqual(200);
    for (const r of rankingsRows) {
      expect(r.rank).toBeGreaterThanOrEqual(1);
      expect(r.playerId).toBeGreaterThan(0);
      expect(r.divisionId).toBeGreaterThan(0);
    }

    // Spot-check: rank 1 in Mens Division 1 is the fixture's leader.
    const mensDiv1 = divisions.find((d) => d.slug === 'mens-division-1');
    expect(mensDiv1).toBeDefined();
    const [top] = await db
      .select({ name: schema.players.name, rank: schema.rankings.rank })
      .from(schema.rankings)
      .innerJoin(schema.players, eq(schema.players.id, schema.rankings.playerId))
      .where(and(eq(schema.rankings.divisionId, mensDiv1!.id), eq(schema.rankings.rank, 1)));
    expect(top?.name).toBe('James Hodgson');
```

d. Update the imports at the top of the file. The file already imports `sql` from `drizzle-orm`; extend that import to include `and` and `eq`:

```ts
import { and, eq, sql } from 'drizzle-orm';
```

- [ ] **Step 2: Run the test**

Run: `pnpm vitest run apps/scraper/tests/modes.test.ts`
Expected: PASS. If it fails, the failure mode points at the integration gap — report rather than patching earlier tasks blind.

- [ ] **Step 3: Run the full suite**

Run: `pnpm test`
Expected: all tests pass.

- [ ] **Step 4: Commit**

```bash
git add apps/scraper/tests/modes.test.ts
git commit -m "test(scraper): orchestrator end-to-end covers players and rankings"
```

---

### Task 7: Live verification against the upstream

**Files:**
- None (manual / shell-only)

- [ ] **Step 1: Ensure dev DB is up**

Run: `docker ps --filter name=ctl-db-dev --format '{{.Names}} {{.Status}}'`
If empty: `pnpm db:dev` and wait ~3s, then `pnpm db:migrate`.

- [ ] **Step 2: Truncate prior data and re-scrape**

```bash
docker exec ctl-db-dev psql -U ctl -d ctl -c "TRUNCATE seasons, divisions, clubs, club_aliases, teams, players, player_aliases, scrape_runs, fixtures, results, standings, rankings RESTART IDENTITY CASCADE"
DATABASE_URL=postgres://ctl:ctl@localhost:5433/ctl pnpm scrape
```

Expected: report logs `stepsExecuted: 23` (1 clubs-directory + 1 divisions-discovery + 9×2 division steps + 3 rankings steps; home is fetched outside runStep), `parseFailures: 0`, runtime ~50s.

- [ ] **Step 3: psql verification**

```bash
docker exec ctl-db-dev psql -U ctl -d ctl -c 'SELECT COUNT(*) FROM players;'
docker exec ctl-db-dev psql -U ctl -d ctl -c 'SELECT COUNT(*) FROM rankings;'
docker exec ctl-db-dev psql -U ctl -d ctl -c 'SELECT d."group", COUNT(*) FROM rankings r JOIN divisions d ON d.id = r.division_id GROUP BY d."group" ORDER BY 1;'
docker exec ctl-db-dev psql -U ctl -d ctl -c "SELECT p.name, r.rank, r.ranking_score FROM rankings r JOIN players p ON p.id = r.player_id WHERE r.division_id = (SELECT id FROM divisions WHERE slug = 'mens-division-1') ORDER BY r.rank LIMIT 10;"
docker exec ctl-db-dev psql -U ctl -d ctl -c 'SELECT COUNT(*) FROM players WHERE needs_review = true;'
```

Expected:
- `players` — several hundred (each group page carries ~200-270 players; cross-group overlap dedupes by name).
- `rankings` — similar order; one row per (player, division).
- Group breakdown — all three groups (Mens/Ladies/Mixed) present with non-zero counts.
- Mens Div 1 leaderboard — should match the live page (rank 1 likely James Hodgson unless results moved).
- `needs_review` count — large on first scrape (every new player is tentative); expected, not a bug.

- [ ] **Step 4: Push**

```bash
git pull --rebase
git push
git status   # MUST show "up to date with origin"
```

---

## Post-implementation: bd housekeeping

After Task 7 succeeds:

- Close `calderdale-tennis-league-9am` with the live verification numbers.
- `pi8` (match-card walk) is now unblocked — players are seeded.
- Remaining open: `pi8` (P2), `i79` contacts (P3), `3ix` location (P3), `xq6` runBackfill N+1 (P3).
