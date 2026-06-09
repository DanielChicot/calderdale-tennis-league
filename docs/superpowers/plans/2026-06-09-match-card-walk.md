# Per-fixture Match-Card Walk Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Populate `match_cards`, `rubbers`, and `set_scores` for every played fixture by fetching its result-card fragment — fetching only fixtures that don't yet have a card.

**Architecture:** `parseFixturesAndResults`'s `fixtureRef` gains `cardId` (replacing a wrong bare-path URL — latent Phase 2 bug); the fixtures handler stores it in a new `fixtures.upstream_card_id` column. A new match-cards stage (after rankings, in both `runCurrent` and `runSeason`) queries played fixtures missing a card and schedules `buildMatchCardStep`, which constructs the spike-verified nested URL. The handler resolves player pairs against each side's club and writes card + rubbers + set_scores in one transaction (delete-and-reinsert children). A general `runStep` guard stops failed parses from being content-hash-deduped into never re-running.

**Tech Stack:** TypeScript 5.6 (strict, verbatimModuleSyntax, exactOptionalPropertyTypes, noUncheckedIndexedAccess), pnpm 9 workspaces, Drizzle ORM 0.36 + postgres-js 3.4 (helpers: `aliasedTable`, `inArray`, `isNotNull`, `notExists` — all verified exported), Cheerio, Vitest 2.1, Testcontainers 10.13.

**Spec:** `docs/superpowers/specs/2026-06-09-match-card-walk-design.md`
**Fixture (already committed):** `fixtures/match-card-sample.html` — parses to exactly 9 rubbers, each with 2 home + 2 away player names, 9 total sets (1 per rubber). First rubber: Leigh Start + Sophie Jackson vs Chris Garbutt + Lesley Campsall, set 6-0.
**Spike-verified URL:** `https://www.ludus-online.com/tennis-league/functions/results/results_cards/result_card_<cardId>.php?WebsiteTimeZone=Europe/London&fixture_id=<upstreamFixtureId>&database=ludus3_tl_calderdale&commonDatabase=ludus3_tennis_common&refreshProtectionCode=0` (bare path 404s; missing `WebsiteTimeZone` → "TimeZone not recognised"; missing database params → empty stub).

---

### Task 1: Parser — `fixtureRef` carries `cardId` instead of a URL

**Files:**
- Modify: `packages/parser/src/parse-fixtures-and-results.ts`
- Modify: `packages/parser/tests/parse-fixtures-and-results.test.ts`

**Context:** The current `fixtureRef.resultCardUrl` bakes a bare-path URL that 404s against the live upstream. URL construction moves to walk-plan (Task 3); the parser returns the raw data: the upstream fixture id and the per-division card-template id (extracted from `onsubmit="return displayResultsCard('result_card_39', 127);"` — `parseResultCardCall` already captures both).

- [ ] **Step 1: Update the failing test**

In `packages/parser/tests/parse-fixtures-and-results.test.ts`, find the test `'played fixtures expose a fixtureRef (id + result card path)'` (around line 42). Replace it with:

```ts
  it('played fixtures expose a fixtureRef (upstream id + card template id)', async () => {
    const html = await loadFixture('fixtures-and-results-mens-div-1.html');
    const rows = parseFixturesAndResults(html);
    const played = rows.filter((r) => r.status === 'completed');
    expect(played.length).toBeGreaterThan(0);
    for (const r of played) {
      expect(r.fixtureRef).toBeDefined();
      expect(typeof r.fixtureRef?.id).toBe('number');
      expect(r.fixtureRef?.id).toBeGreaterThan(0);
      // Mens Div 1 fixtures all share the per-division card template result_card_39.
      expect(r.fixtureRef?.cardId).toBe(39);
    }
  });
```

(Adapt the inner setup lines — fixture loading and row filtering — to match what the existing test body actually does; the key changes are the test name, dropping the `resultCardUrl` regex assertion, and adding the `cardId` assertion.)

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/parser/tests/parse-fixtures-and-results.test.ts`
Expected: FAIL — `cardId` is `undefined` on the current `fixtureRef` shape.

- [ ] **Step 3: Change the parser type and construction**

In `packages/parser/src/parse-fixtures-and-results.ts`:

a. Find the `fixtureRef` field in the `FixtureRow` type (around line 12):

```ts
  fixtureRef?: {
    id: number;
    resultCardUrl: string;
  };
```

Replace with:

```ts
  fixtureRef?: {
    id: number;       // upstream fixture_id
    cardId: number;   // N from result_card_N.php — per-division card template id
  };
```

b. Find the construction site (around line 136):

```ts
      fixtureRef = {
        id: parsed.fixtureId,
        resultCardUrl: `https://www.ludus-online.com/result_card_${parsed.cardId}.php?fixture_id=${parsed.fixtureId}`,
      };
```

Replace with:

```ts
      fixtureRef = {
        id: parsed.fixtureId,
        cardId: parsed.cardId,
      };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run packages/parser/tests/parse-fixtures-and-results.test.ts`
Expected: all pass.

Note: the full suite will NOT pass yet — `apps/scraper` does not reference `resultCardUrl` anywhere (the orchestrator's fixtures handler only uses `row.fixtureRef.id`), so no other test breaks. Verify with: `grep -rn "resultCardUrl" apps/ packages/` — expect zero hits after this change.

- [ ] **Step 5: Commit**

```bash
git add packages/parser/src/parse-fixtures-and-results.ts packages/parser/tests/parse-fixtures-and-results.test.ts
git commit -m "fix(parser): fixtureRef carries cardId — bare-path resultCardUrl 404s upstream"
```

---

### Task 2: Migration — `fixtures.upstream_card_id`

**Files:**
- Modify: `packages/db/src/schema/fixtures.ts`
- Create: `packages/db/src/migrations/0006_*.sql` (drizzle-kit generated)

**Context:** Nullable integer column; no index needed (the missing-cards query runs once per scrape over ~600 rows). No dedicated schema test — a nullable unconstrained int column has no behaviour to lock; the orchestrator e2e (Task 5) covers it end-to-end.

- [ ] **Step 1: Modify the schema**

In `packages/db/src/schema/fixtures.ts`, find the `fixtures` table columns:

```ts
    upstreamId: integer('upstream_id'),       // fixture_id from upstream, when known
```

Add directly below it:

```ts
    upstreamCardId: integer('upstream_card_id'),   // result_card_N template id, when known
```

- [ ] **Step 2: Generate the migration**

Run: `pnpm --filter @ctl/db db:generate`
Expected: a new `packages/db/src/migrations/0006_<name>.sql` containing exactly one statement:

```sql
ALTER TABLE "fixtures" ADD COLUMN "upstream_card_id" integer;
```

Open it and confirm — if drizzle-kit emits anything else, stop and investigate.

- [ ] **Step 3: Run the db test suite to confirm migrations still apply cleanly**

Run: `pnpm vitest run packages/db/tests/`
Expected: all pass (the Testcontainers setup applies all migrations including the new one).

- [ ] **Step 4: Commit**

```bash
git add packages/db/src/schema/fixtures.ts packages/db/src/migrations/0006_*.sql packages/db/src/migrations/meta
git commit -m "feat(db): add fixtures.upstream_card_id"
```

---

### Task 3: Walk-plan — `buildMatchCardStep` constructs the verified URL

**Files:**
- Modify: `apps/scraper/src/walk-plan.ts`
- Modify: `apps/scraper/tests/walk-plan.test.ts`

**Context:** The step variant keeps its shape (`{ kind: 'match-card'; url; fixtureId }` — `fixtureId` is OUR DB id, used by the handler). The builder signature changes from `(fixtureId, resultCardUrl)` to `(fixtureId, cardId, upstreamFixtureId)` and owns the URL.

- [ ] **Step 1: Update the test**

In `apps/scraper/tests/walk-plan.test.ts`, replace the test `'match card step references fixture id and url'`:

```ts
  it('match card step builds the nested result-card URL with required params', () => {
    const step = buildMatchCardStep(5, 39, 127);
    expect(step.kind).toBe('match-card');
    if (step.kind === 'match-card') {
      expect(step.fixtureId).toBe(5);
      expect(step.url).toContain('/tennis-league/functions/results/results_cards/result_card_39.php');
      expect(step.url).toContain('fixture_id=127');
      expect(step.url).toContain('WebsiteTimeZone=Europe/London');
      expect(step.url).toContain('database=ludus3_tl_calderdale');
      expect(step.url).toContain('commonDatabase=ludus3_tennis_common');
      expect(step.url).toContain('refreshProtectionCode=0');
    }
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run apps/scraper/tests/walk-plan.test.ts`
Expected: FAIL — current builder takes `(fixtureId, resultCardUrl)`.

- [ ] **Step 3: Replace the builder**

In `apps/scraper/src/walk-plan.ts`, find:

```ts
export const buildMatchCardStep = (fixtureId: number, resultCardUrl: string): WalkStep => ({
  kind: 'match-card',
  url: resultCardUrl,
  fixtureId,
});
```

Replace with:

```ts
export const buildMatchCardStep = (
  fixtureId: number,          // our DB fixtures.id — used by the handler
  cardId: number,             // upstream result_card_N template id (per-division)
  upstreamFixtureId: number,  // upstream fixture_id — goes in the URL
): WalkStep => ({
  kind: 'match-card',
  // Spike-verified: the bare /result_card_N.php path 404s; the nested path requires
  // WebsiteTimeZone and both database params or it returns an error/empty stub.
  url: `https://www.ludus-online.com/tennis-league/functions/results/results_cards/result_card_${cardId}.php?WebsiteTimeZone=Europe/London&fixture_id=${upstreamFixtureId}&database=ludus3_tl_calderdale&commonDatabase=ludus3_tennis_common&refreshProtectionCode=0`,
  fixtureId,
});
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run apps/scraper/tests/walk-plan.test.ts`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add apps/scraper/src/walk-plan.ts apps/scraper/tests/walk-plan.test.ts
git commit -m "feat(scraper): buildMatchCardStep constructs the verified nested card URL"
```

---

### Task 4: Orchestrator — card-id persistence, match-card handler, missing-cards stage, retry guard

**Files:**
- Modify: `apps/scraper/src/orchestrator.ts`

**Context:** Four changes in one file:
1. `runStep` retry guard: only pass `prior` to the fetch when the previous parse succeeded — otherwise a failed parse whose page content hasn't changed returns `'unchanged'` forever and the handler never re-runs.
2. Fixtures handler stores `upstreamCardId`.
3. Match-card handler replaces the no-op: parse → resolve players against each side's club → transactional write (card upsert + delete-and-reinsert rubbers/sets).
4. Missing-cards stage appended to both `runCurrent` and `runSeason`.

No new unit tests in this task — Task 5's e2e covers all four. Existing suite must stay green.

- [ ] **Step 1: Update the drizzle import**

Replace:

```ts
import { and, eq, sql } from 'drizzle-orm';
```

with:

```ts
import { aliasedTable, and, eq, inArray, isNotNull, notExists, sql } from 'drizzle-orm';
```

(`resolvePlayer` and `buildMatchCardStep` are already imported from earlier work — verify, don't duplicate.)

- [ ] **Step 2: runStep retry guard**

In `runStep`, find:

```ts
    const [prior] = await db.select().from(schema.scrapeRuns).where(eq(schema.scrapeRuns.url, runKey));
    const priorFetch = prior
      ? {
          ...(prior.lastModified != null ? { lastModified: prior.lastModified } : {}),
          ...(prior.contentHash != null ? { contentHash: prior.contentHash } : {}),
        }
      : undefined;
```

Replace with:

```ts
    const [prior] = await db.select().from(schema.scrapeRuns).where(eq(schema.scrapeRuns.url, runKey));
    // Only dedup against the prior fetch when its parse SUCCEEDED. A failed parse must
    // re-run the handler even if the page content is unchanged — otherwise the content
    // hash returns 'unchanged' on every retry and the failure can never self-heal.
    const priorFetch = prior && prior.lastParseOk
      ? {
          ...(prior.lastModified != null ? { lastModified: prior.lastModified } : {}),
          ...(prior.contentHash != null ? { contentHash: prior.contentHash } : {}),
        }
      : undefined;
```

- [ ] **Step 3: Store upstreamCardId in the fixtures handler**

In the `'fixtures-and-results'` case, the fixture upsert currently reads:

```ts
              .values({
                upstreamId: row.fixtureRef!.id,
                date: row.date,
                homeTeamId,
                awayTeamId,
                divisionId: step.divisionId,
                status: row.status,
              })
              .onConflictDoUpdate({
                target: schema.fixtures.upstreamId,
                set: { date: row.date, status: row.status, homeTeamId, awayTeamId, divisionId: step.divisionId },
              })
```

Replace with:

```ts
              .values({
                upstreamId: row.fixtureRef!.id,
                upstreamCardId: row.fixtureRef!.cardId,
                date: row.date,
                homeTeamId,
                awayTeamId,
                divisionId: step.divisionId,
                status: row.status,
              })
              .onConflictDoUpdate({
                target: schema.fixtures.upstreamId,
                set: {
                  date: row.date,
                  status: row.status,
                  homeTeamId,
                  awayTeamId,
                  divisionId: step.divisionId,
                  upstreamCardId: row.fixtureRef!.cardId,
                },
              })
```

- [ ] **Step 4: Replace the match-card no-op handler**

Find:

```ts
      case 'match-card': {
        parseMatchCard(html);
        // Upsert match_cards, rubbers, set_scores under the fixtureId
        // (Implementation depends on player resolution which depends on team resolution.)
        return;
      }
```

Replace with:

```ts
      case 'match-card': {
        const { rubbers: parsedRubbers } = parseMatchCard(html);

        // Both sides' clubs in one query — players resolve against their team's club.
        const homeTeam = aliasedTable(schema.teams, 'home_team');
        const awayTeam = aliasedTable(schema.teams, 'away_team');
        const [fx] = await db
          .select({ homeClubId: homeTeam.clubId, awayClubId: awayTeam.clubId })
          .from(schema.fixtures)
          .innerJoin(homeTeam, eq(homeTeam.id, schema.fixtures.homeTeamId))
          .innerJoin(awayTeam, eq(awayTeam.id, schema.fixtures.awayTeamId))
          .where(eq(schema.fixtures.id, step.fixtureId));
        if (!fx) throw new Error(`match-card: fixture ${step.fixtureId} not found`);

        // Resolve players OUTSIDE the tx — resolvePlayer has its own internal
        // transaction and is idempotent (same pattern as resolveTeam).
        const resolvedRubbers: Array<{
          orderInCard: number;
          homeIds: number[];
          awayIds: number[];
          sets: { home: number; away: number }[];
        }> = [];
        for (const r of parsedRubbers) {
          const homeIds: number[] = [];
          for (const name of r.homePlayerNames) homeIds.push(await resolvePlayer(db, name, fx.homeClubId));
          const awayIds: number[] = [];
          for (const name of r.awayPlayerNames) awayIds.push(await resolvePlayer(db, name, fx.awayClubId));
          resolvedRubbers.push({ orderInCard: r.orderInCard, homeIds, awayIds, sets: r.sets });
        }

        // Atomic unit: card + children. An EMPTY card still gets a match_cards row —
        // "fetched, nothing there" — so the missing-cards query doesn't refetch forever.
        await db.transaction(async (tx) => {
          const [card] = await tx
            .insert(schema.matchCards)
            .values({ fixtureId: step.fixtureId })
            .onConflictDoUpdate({
              target: schema.matchCards.fixtureId,
              set: { fixtureId: step.fixtureId },   // no-op set to make .returning() work on conflict
            })
            .returning();
          // Delete-and-reinsert children (cascades rubbers → set_scores). Cards are
          // tiny (≤9 rubbers × ≤3 sets); diffing isn't worth the complexity.
          await tx.delete(schema.rubbers).where(eq(schema.rubbers.matchCardId, card!.id));
          for (const r of resolvedRubbers) {
            const [rubber] = await tx
              .insert(schema.rubbers)
              .values({
                matchCardId: card!.id,
                orderInCard: r.orderInCard,
                homePlayerIds: r.homeIds,
                awayPlayerIds: r.awayIds,
              })
              .returning();
            for (const [i, s] of r.sets.entries()) {
              await tx.insert(schema.setScores).values({
                rubberId: rubber!.id,
                orderInRubber: i + 1,
                homeScore: s.home,
                awayScore: s.away,
              });
            }
          }
        });
        return;
      }
```

- [ ] **Step 5: Add the missing-cards stage to `runCurrent`**

In `runCurrent`, find the end of the rankings stage (the `for (const g of groupReps)` loop) and the `return report;` after it. Insert between them:

```ts
    // 5. Match cards — fetch only played fixtures that don't have a card yet.
    // Failed fetches/parses self-heal: no match_cards row lands, so the fixture
    // reappears in this query next run (and the runStep retry guard ensures the
    // handler actually re-runs even when page content is unchanged).
    const missingCards = await db
      .select({
        fixtureId: schema.fixtures.id,
        upstreamId: schema.fixtures.upstreamId,
        upstreamCardId: schema.fixtures.upstreamCardId,
      })
      .from(schema.fixtures)
      .innerJoin(schema.divisions, eq(schema.divisions.id, schema.fixtures.divisionId))
      .where(
        and(
          eq(schema.divisions.seasonId, detection.currentSeasonId),
          inArray(schema.fixtures.status, ['completed', 'rubbers-conceded']),
          isNotNull(schema.fixtures.upstreamCardId),
          notExists(
            db
              .select()
              .from(schema.matchCards)
              .where(eq(schema.matchCards.fixtureId, schema.fixtures.id)),
          ),
        ),
      );

    for (const f of missingCards) {
      const cardStep = buildMatchCardStep(f.fixtureId, f.upstreamCardId!, f.upstreamId!);
      const outcome = await runStep(cardStep);
      outcome === 'executed' ? report.stepsExecuted++ : outcome === 'skipped' ? report.stepsSkipped++ : report.parseFailures++;
    }

    return report;
```

(`upstreamId` is non-null by construction — the fixtures handler only writes rows that had a `fixtureRef` — but the column is nullable, hence the `!`.)

- [ ] **Step 6: Add the same stage to `runSeason`**

In `runSeason`, find the end of its rankings stage and the `return report;` after it. Insert between them the same block, with the season-scoped names:

```ts
    // Match cards — same stage as runCurrent, keyed to this season.
    const missingCards = await db
      .select({
        fixtureId: schema.fixtures.id,
        upstreamId: schema.fixtures.upstreamId,
        upstreamCardId: schema.fixtures.upstreamCardId,
      })
      .from(schema.fixtures)
      .innerJoin(schema.divisions, eq(schema.divisions.id, schema.fixtures.divisionId))
      .where(
        and(
          eq(schema.divisions.seasonId, season.id),
          inArray(schema.fixtures.status, ['completed', 'rubbers-conceded']),
          isNotNull(schema.fixtures.upstreamCardId),
          notExists(
            db
              .select()
              .from(schema.matchCards)
              .where(eq(schema.matchCards.fixtureId, schema.fixtures.id)),
          ),
        ),
      );

    for (const f of missingCards) {
      const cardStep = buildMatchCardStep(f.fixtureId, f.upstreamCardId!, f.upstreamId!);
      const outcome = await runStep(cardStep);
      outcome === 'executed' ? report.stepsExecuted++ : outcome === 'skipped' ? report.stepsSkipped++ : report.parseFailures++;
    }
    return report;
```

- [ ] **Step 7: Run the full suite**

Run: `pnpm test`
Expected: all tests pass. The existing `modes.test.ts` e2e gains match-card fetches (the fixtures in its displayResults fixture are completed and now get card steps), which hit the mock's `<html></html>` fallback → `parseMatchCard` returns `{ rubbers: [] }` → empty cards written. Its assertions don't count steps, so it stays green. If it fails on something else, report rather than patching blind.

- [ ] **Step 8: Commit**

```bash
git add apps/scraper/src/orchestrator.ts
git commit -m "feat(scraper): match-card handler + missing-cards stage + failed-parse retry guard"
```

---

### Task 5: End-to-end test — cards, rubbers, set scores, self-healing

**Files:**
- Modify: `apps/scraper/tests/modes.test.ts`

**Context:** Route `result_card` URLs to the sample card fixture; assert the full write path; verify the only-missing strategy by deleting one card and re-running.

- [ ] **Step 1: Update the test**

In `apps/scraper/tests/modes.test.ts`:

a. Load the card fixture — add after the `playerRankings` fixture load:

```ts
    const matchCard = await fixtureHtml('match-card-sample.html');
```

b. Route card URLs in the `fetchPage` mock — insert BEFORE the final fallback return:

```ts
        if (url.includes('result_card_')) {
          return { kind: 'changed' as const, status: 200, html: matchCard, contentHash: `mc:${url}`.slice(0, 64) };
        }
```

c. Rename the test to `'runCurrent populates seasons, clubs, divisions, teams, fixtures, standings, rankings, match cards'`.

d. Add assertions after the rankings block and before the final `fixtures` assertion:

```ts
    const cards = await db.select().from(schema.matchCards);
    expect(cards.length).toBeGreaterThan(0);

    const rubberRows = await db.select().from(schema.rubbers);
    // Sample card parses to exactly 9 rubbers, each pair 2v2.
    expect(rubberRows.length).toBe(cards.length * 9);
    for (const r of rubberRows) {
      expect(r.homePlayerIds).toHaveLength(2);
      expect(r.awayPlayerIds).toHaveLength(2);
    }

    const setRows = await db.select().from(schema.setScores);
    expect(setRows.length).toBe(cards.length * 9);   // 1 set per rubber in the sample
    for (const s of setRows) {
      expect(Number.isInteger(s.homeScore)).toBe(true);
      expect(Number.isInteger(s.awayScore)).toBe(true);
    }

    // Self-healing + only-missing: delete one card, re-run, exactly one card refetch.
    const cardFetches = () =>
      (http.fetchPage.mock.calls as unknown[][]).filter(
        (c) => typeof c[0] === 'string' && (c[0] as string).includes('result_card_'),
      ).length;
    const fetchesAfterFirstRun = cardFetches();
    expect(fetchesAfterFirstRun).toBe(cards.length);   // one fetch per missing card

    await db.delete(schema.matchCards).where(eq(schema.matchCards.id, cards[0]!.id));
    await orch.runCurrent();

    expect(cardFetches()).toBe(fetchesAfterFirstRun + 1);   // only the deleted card refetched
    const cardsAfter = await db.select().from(schema.matchCards);
    expect(cardsAfter.length).toBe(cards.length);           // restored
```

- [ ] **Step 2: Run the test**

Run: `pnpm vitest run apps/scraper/tests/modes.test.ts`
Expected: PASS. If the `fetchesAfterFirstRun` equality fails, check whether any card fetch failed (a `parseFailure` means a card is missing a row and would be refetched — investigate rather than loosening the assertion).

- [ ] **Step 3: Run the full suite**

Run: `pnpm test`
Expected: all pass.

- [ ] **Step 4: Commit**

```bash
git add apps/scraper/tests/modes.test.ts
git commit -m "test(scraper): e2e covers match cards, rubbers, set scores, self-healing refetch"
```

---

### Task 6: Live verification against the upstream

**Files:**
- None (manual / shell-only)

- [ ] **Step 1: Ensure dev DB is up + migrated**

Run: `docker ps --filter name=ctl-db-dev --format '{{.Names}} {{.Status}}'`
If empty: `pnpm db:dev`, wait ~3s. Then: `pnpm db:migrate` (applies 0006).

- [ ] **Step 2: Truncate and run the full scrape**

```bash
docker exec ctl-db-dev psql -U ctl -d ctl -c "TRUNCATE seasons, divisions, clubs, club_aliases, teams, players, player_aliases, scrape_runs, fixtures, results, standings, rankings, match_cards RESTART IDENTITY CASCADE"
DATABASE_URL=postgres://ctl:ctl@localhost:5433/ctl pnpm scrape
```

Expected: `stepsExecuted` ≈ 23 + (count of completed + rubbers-conceded fixtures, ~220); `parseFailures: 0`; runtime ~4.5 min (1 req/s pacing dominates).

- [ ] **Step 3: psql verification**

```bash
docker exec ctl-db-dev psql -U ctl -d ctl -c "SELECT 'match_cards' t, count(*) FROM match_cards UNION ALL SELECT 'rubbers', count(*) FROM rubbers UNION ALL SELECT 'set_scores', count(*) FROM set_scores UNION ALL SELECT 'played fixtures', count(*) FROM fixtures WHERE status IN ('completed','rubbers-conceded');"
docker exec ctl-db-dev psql -U ctl -d ctl -c "SELECT r.order_in_card, hp.name AS home_p1, ap.name AS away_p1, ss.home_score || '-' || ss.away_score AS set1 FROM rubbers r JOIN match_cards mc ON mc.id = r.match_card_id JOIN players hp ON hp.id = r.home_player_ids[1] JOIN players ap ON ap.id = r.away_player_ids[1] LEFT JOIN set_scores ss ON ss.rubber_id = r.id AND ss.order_in_rubber = 1 WHERE mc.fixture_id = (SELECT fixture_id FROM match_cards LIMIT 1) ORDER BY r.order_in_card;"
```

Expected:
- `match_cards` ≈ played-fixtures count (some conceded cards may be empty but still have a row).
- `rubbers` up to 9× cards (conceded gaps reduce it); `set_scores` ≈ 1-3× rubbers.
- The spot-check card shows real player names and plausible set scores — verify one card against the live site.

- [ ] **Step 4: Second scrape — only-missing verification**

Run: `DATABASE_URL=postgres://ctl:ctl@localhost:5433/ctl pnpm scrape`
Expected: runtime back to ~40-50s; `stepsExecuted` ≈ 23 (zero match-card steps — all cards present).

- [ ] **Step 5: Push**

```bash
git pull --rebase
git push
git status   # MUST show "up to date with origin"
```

---

## Post-implementation: bd housekeeping

After Task 6 succeeds:

- Close `calderdale-tennis-league-pi8` with live verification numbers.
- Remaining open: `i79` contacts (P3), `3ix` location (P3), `xq6` runBackfill N+1 (P3), stale-snapshot-rows (P4).
