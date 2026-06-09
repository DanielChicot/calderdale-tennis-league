# Per-fixture match-card walk

## Goal

Populate `match_cards`, `rubbers`, and `set_scores` for every played fixture by fetching its result-card fragment. The richest data vein left in the upstream: individual rubbers with player pairs and per-set game scores.

This is bd issue `calderdale-tennis-league-pi8`. Unblocked by `9am` (players are now seeded and `resolvePlayer` is wired).

## Decisions captured during brainstorming

| Question | Choice | Why |
|---|---|---|
| Result-card URL shape | Nested path `/tennis-league/functions/results/results_cards/result_card_<cardId>.php` with `WebsiteTimeZone=Europe/London`, `fixture_id=<upstream fixture id>`, `database=ludus3_tl_calderdale`, `commonDatabase=ludus3_tennis_common`, `refreshProtectionCode=0` | Live spike: the bare path (what `parseFixturesAndResults` constructs today) 404s; the nested path without `WebsiteTimeZone` throws "TimeZone not recognised"; without the database params returns a near-empty stub. The five-param set returns the real 36 KB card. Plain GET — no POST, no cookies. |
| `fixtureRef` shape | `{ id: number; cardId: number }` — drop `resultCardUrl` | The parser was baking a wrong URL. Parsers should return data; walk-plan owns URL construction. The card id is per-division (all Mens Div 1 fixtures share `result_card_39`), extracted from `displayResultsCard('result_card_39', 127)` onsubmit handlers. |
| Card-id persistence | New nullable column `fixtures.upstream_card_id` | Lets later runs schedule card fetches for fixtures whose card fetch previously failed, without re-parsing displayResults (which may be conditional-GET-skipped). |
| Fetch strategy | Only fixtures missing a card | First run ≈ +220 fetches (~3.7 min extra). Steady state: only newly-completed fixtures (~5-15/week → seconds). Upstream corrections to already-fetched cards are not picked up — rare and accepted. |
| Eligible statuses | `completed` and `rubbers-conceded` only | `match-conceded` is a whole-match forfeit with no real rubber data. |
| Empty cards | Write the `match_cards` row even when `rubbers.length === 0` | Marks "fetched, nothing there". Otherwise a genuinely-empty card is refetched forever. |
| Child-row idempotency | Delete-and-reinsert rubbers (cascading to set_scores) inside one transaction | Cards are small (≤9 rubbers × ≤3 sets); diffing arrays is not worth the complexity. The existing `ON DELETE CASCADE` chain (match_cards → rubbers → set_scores) does the cleanup. |
| Player resolution | Outside the transaction, via existing `resolvePlayer(name, clubId)`; home pair names resolve against the home team's club, away against the away team's | Same pattern as `resolveTeam`: the resolver has its own internal transaction and is idempotent. The card+rubbers+sets write is the atomic unit. |
| Failure semantics | A failed card parse logs as `parseFailure`; no `match_cards` row lands; the next run's missing-cards query retries it automatically | Self-healing for free from the fetch strategy. |
| Retry-vs-dedup interaction | `runStep` only passes `prior` (contentHash / lastModified) to the fetch when the previous parse SUCCEEDED (`scrape_runs.last_parse_ok`) | Without this, a failed parse whose page content hasn't changed returns `'unchanged'` on every retry and the handler never re-runs — the missing-cards query would schedule the fetch forever without ever re-parsing. General fix; benefits all step kinds. |

## Scope

**In:**
- Parser change: `parseFixturesAndResults`'s `fixtureRef` becomes `{ id, cardId }` (breaking change to the parser's public type; the orchestrator is the only consumer).
- Migration `0006_*`: `fixtures.upstream_card_id INTEGER` (nullable).
- Fixtures-and-results handler stores `upstreamCardId` on upsert.
- `buildMatchCardStep(fixtureId, cardId, upstreamFixtureId)` constructs the verified nested URL. `step.fixtureId` is OUR DB id; `upstreamFixtureId` goes in the URL.
- New match-cards walk stage in `runCurrent` and `runSeason`, after the rankings stage.
- Match-card handler: parse → resolve players → transactional write.

**Out (separate issues / accepted):**
- Upstream corrections to fetched cards (fetch-strategy decision).
- `match-conceded` fixtures.
- Per-team contacts (`i79`) / location (`3ix`) walks.
- `runBackfill` N+1 home fetches (`xq6`).
- Stale snapshot rows (P4 issue, applies to rankings/standings, not cards — cards are append-only facts).

## Architecture / data flow

```
runCurrent / runSeason (after the rankings stage):
  5. match-cards stage:
       SELECT f.id, f.upstream_id, f.upstream_card_id
       FROM fixtures f
       WHERE f.status IN ('completed', 'rubbers-conceded')
         AND f.upstream_card_id IS NOT NULL
         AND f.division_id IN (SELECT id FROM divisions WHERE season_id = <season>)
         AND NOT EXISTS (SELECT 1 FROM match_cards mc WHERE mc.fixture_id = f.id)
       for each row:
         buildMatchCardStep(f.id, f.upstream_card_id, f.upstream_id) → runStep
           ↳ GET nested result_card URL (plain GET)
           ↳ handler: parseMatchCard → resolve players → tx write
```

### Parser change (`packages/parser/src/parse-fixtures-and-results.ts`)

```ts
fixtureRef?: {
  id: number;       // upstream fixture_id
  cardId: number;   // N from result_card_N.php — per-division card template id
};
```

`parseResultCardCall` already extracts both values from the onsubmit handler; the change drops the URL-string construction.

### Walk-plan (`apps/scraper/src/walk-plan.ts`)

`'match-card'` variant keeps its shape `{ kind: 'match-card'; url: string; fixtureId: number }`. The builder changes:

```ts
export const buildMatchCardStep = (
  fixtureId: number,          // our DB fixtures.id — used by the handler
  cardId: number,             // upstream result_card_N template id
  upstreamFixtureId: number,  // upstream fixture_id — goes in the URL
): WalkStep => ({
  kind: 'match-card',
  url: `https://www.ludus-online.com/tennis-league/functions/results/results_cards/result_card_${cardId}.php?WebsiteTimeZone=Europe/London&fixture_id=${upstreamFixtureId}&database=ludus3_tl_calderdale&commonDatabase=ludus3_tennis_common&refreshProtectionCode=0`,
  fixtureId,
});
```

### Orchestrator — fixtures-and-results handler

The fixture upsert's `values` and `set` clauses gain `upstreamCardId: row.fixtureRef.cardId`.

### Orchestrator — match-card handler (replaces the no-op)

```ts
case 'match-card': {
  const { rubbers: parsedRubbers } = parseMatchCard(html);

  // Fixture + both teams' clubs in one round-trip each side.
  const [fixture] = await db
    .select({
      id: schema.fixtures.id,
      homeClubId: homeTeam.clubId,
      awayClubId: awayTeam.clubId,
    })
    .from(schema.fixtures)
    .innerJoin(homeTeam, eq(homeTeam.id, schema.fixtures.homeTeamId))
    .innerJoin(awayTeam, eq(awayTeam.id, schema.fixtures.awayTeamId))
    .where(eq(schema.fixtures.id, step.fixtureId));
  // (homeTeam/awayTeam are aliasedTable(schema.teams, ...) instances)
  if (!fixture) throw new Error(`match-card: fixture ${step.fixtureId} not found`);

  // Resolve players OUTSIDE the tx (resolvePlayer has its own internal tx, idempotent).
  const resolvedRubbers = [];
  for (const r of parsedRubbers) {
    const homeIds = [];
    for (const name of r.homePlayerNames) homeIds.push(await resolvePlayer(db, name, fixture.homeClubId));
    const awayIds = [];
    for (const name of r.awayPlayerNames) awayIds.push(await resolvePlayer(db, name, fixture.awayClubId));
    resolvedRubbers.push({ ...r, homeIds, awayIds });
  }

  // Atomic unit: card + children. Empty cards still get a match_cards row
  // ("fetched, nothing there") so the missing-cards query doesn't refetch forever.
  await db.transaction(async (tx) => {
    const [card] = await tx
      .insert(schema.matchCards)
      .values({ fixtureId: step.fixtureId })
      .onConflictDoUpdate({ target: schema.matchCards.fixtureId, set: { fixtureId: step.fixtureId } })
      .returning();
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

(The no-op upsert on `matchCards` — `set: { fixtureId }` — is the drizzle idiom to get `.returning()` on conflict; alternatively select-then-insert. Implementation may choose either; behaviour is "ensure row exists, get its id".)

### Match-cards stage (both `runCurrent` and `runSeason`)

```ts
// 5. Match cards — fetch only played fixtures that don't have a card yet.
const missingCards = await db
  .select({
    fixtureId: schema.fixtures.id,
    upstreamId: schema.fixtures.upstreamId,
    upstreamCardId: schema.fixtures.upstreamCardId,
  })
  .from(schema.fixtures)
  .innerJoin(schema.divisions, eq(schema.divisions.id, schema.fixtures.divisionId))
  .where(and(
    eq(schema.divisions.seasonId, seasonId),
    inArray(schema.fixtures.status, ['completed', 'rubbers-conceded']),
    isNotNull(schema.fixtures.upstreamCardId),
    notExists(
      db.select().from(schema.matchCards).where(eq(schema.matchCards.fixtureId, schema.fixtures.id)),
    ),
  ));

for (const f of missingCards) {
  const step = buildMatchCardStep(f.fixtureId, f.upstreamCardId!, f.upstreamId!);
  const outcome = await runStep(step);
  // tally into report as usual
}
```

(`upstreamId` is non-null by construction — the fixtures handler only writes rows that had a `fixtureRef` — but the column is nullable, hence the `!`. Drizzle helpers needed: `inArray`, `isNotNull`, `notExists` from `drizzle-orm`.)

## Schema delta

One migration (`packages/db/src/migrations/0006_*.sql`):

```sql
ALTER TABLE fixtures
  ADD COLUMN upstream_card_id INTEGER;
```

Nullable; no index (the missing-cards query runs once per scrape over ~600 rows). Drizzle-side: `upstreamCardId: integer('upstream_card_id')` in `packages/db/src/schema/fixtures.ts`.

`match_cards`, `rubbers`, `set_scores` used as-is — the cascade chain (match_cards → rubbers → set_scores) supports the delete-and-reinsert idempotency.

## Testing strategy

**Unit (no DB):**
- `parseFixturesAndResults`: `fixtureRef` is `{ id, cardId }`; Mens Div 1 fixture rows all carry `cardId === 39`.
- `parseMatchCard`: existing tests against `fixtures/match-card-sample.html` unchanged (parser untouched).
- `buildMatchCardStep(5, 39, 127)`: URL contains the nested path, `result_card_39.php`, `fixture_id=127`, `WebsiteTimeZone`, both database params, `refreshProtectionCode=0`; `step.fixtureId === 5`.

**Integration (Testcontainers):**
- Handler write-path: seed season/division/clubs/teams/fixture, run the handler twice with `match-card-sample.html`, assert: one `match_cards` row; rubbers match the sample's grid; set_scores land as integers; second run reproduces identical row counts (delete+reinsert idempotency); players created against the correct clubs.

**Orchestrator end-to-end** (extend `modes.test.ts`):
- Route `result_card` URLs in the `fetchPage` mock → `match-card-sample.html`.
- Assert after `runCurrent`: `match_cards` > 0; `rubbers` > 0 with non-empty player-id arrays; `set_scores` > 0.
- Refetch-protection: the count of match-card fetches equals the count of played fixtures (only-missing query did its job).

**Live verification (manual):**
1. Fresh truncate + `pnpm scrape` — expect ~220 extra steps, total runtime ~4.5 min, `parseFailures: 0`.
2. psql: `match_cards` ≈ completed+rubbers-conceded fixture count; `rubbers` ≈ up to 9× cards; `set_scores` ≈ 2-3× rubbers; spot-check one card against the live site.
3. **Second `pnpm scrape` immediately after**: match-card steps ≈ 0 — verifies the missing-only strategy end-to-end.

## Out of scope (will not be filed)

- A correction-window refetch (option rejected during brainstorming; revisit only if upstream corrections prove common).
- Rubber-level conceded flags (the parser doesn't currently surface them; the conceded checkbox is only used for cell discovery).
- Walk-volume optimisation beyond only-missing (e.g. batching) — 1 req/s pacing is the deliberate politeness floor.
