# Courtside Personal Panel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A visitor can pin themselves as a league player (no auth) and the homepage server-renders a personal panel: last result, rank + movement, team standing, season W/L, next fixture.

**Architecture:** Identity lives in a `ctl_me` first-party cookie (JSON list of `{slug, name}`; v1 uses the first entry). The home `+page.server.ts` reads it and calls a new `getPlayerPanel` read function in `@ctl/data`. Claim/forget are SvelteKit form actions on the player page (progressive enhancement — no JS required); discovery is a new `/players` SSR search route. The player's team is derived from the side they appeared on in their most recent rubber. No schema changes.

**Tech Stack:** SvelteKit 2 (Svelte 5 runes), Drizzle ORM (postgres-js), Vitest, Testcontainers (data-layer tests), pnpm workspace.

**Spec:** `docs/superpowers/specs/2026-08-09-courtside-personal-panel-design.md` (approved). Beads issue: `calderdale-tennis-league-mt9`.

## Global Constraints

- Node >= 22, pnpm 9 (`packageManager` pinned in root package.json).
- Data-layer tests use Testcontainers — Docker must be running; `beforeAll` gets a 120_000 ms timeout.
- NO database schema changes, NO migrations, NO new npm dependencies.
- Cookie name is exactly `ctl_me`; shape is exactly `{"players":[{"slug":"…","name":"…"}]}`.
- Rank movement is direction only (`up`/`down`/`same`/`new` enum already in `rankings.movement`) — never invent magnitude.
- Numeric DB columns (scores, points) arrive as **strings** from drizzle postgres — keep them strings in data-layer types (existing convention).
- Privacy microcopy is verbatim: "Saved only on this device — nothing is sent anywhere."
- All user-visible dates go through `formatDate` from `apps/web/src/lib/format.ts`.
- Run data tests from the repo root: `pnpm vitest run packages/data/tests/<file>`. Run web tests from `apps/web`: `pnpm vitest run <file>` (or `npm test` for all).
- Commit after every task; commit messages end with the repo's Co-Authored-By convention.

---

### Task 1: `getPlayerPanel` data function

**Files:**
- Create: `packages/data/src/player-panel.ts`
- Modify: `packages/data/src/index.ts` (add `export * from './player-panel.js';`)
- Test: `packages/data/tests/player-panel.test.ts`

**Interfaces:**
- Consumes: `schema` and `Database` from `@ctl/db`; drizzle operators (`aliasedTable, and, arrayContains, eq, gte, inArray, or`).
- Produces (used by Task 6):
  - `getPlayerPanel(db: Database, slug: string, today: string): Promise<PlayerPanel | null>` — `today` is an ISO date `YYYY-MM-DD` passed in by the caller (keeps the function pure/testable).
  - `type PlayerPanel` exactly as defined below.

- [ ] **Step 1: Write the failing tests**

Create `packages/data/tests/player-panel.test.ts`. Follow the existing Testcontainers pattern (see `packages/data/tests/fixtures.test.ts`):

```ts
import { afterAll, beforeAll, beforeEach, describe, it, expect } from 'vitest';
import { sql } from 'drizzle-orm';
import { startDb, stopDb, getDb } from './setup.js';
import { schema } from '@ctl/db';
import { getPlayerPanel } from '../src/player-panel.js';

// Seeds one season/division/club, two teams, and four players; returns ids.
const seed = async () => {
  const db = getDb();
  const [season] = await db.insert(schema.seasons).values({ slug: 's', name: 'S', current: true }).returning();
  const [division] = await db.insert(schema.divisions).values({
    slug: 'mens-1', name: 'Mens Division 1', group: 'Mens', seasonId: season!.id, upstreamModeId: 1,
  }).returning();
  const [club] = await db.insert(schema.clubs).values({ slug: 'oak', canonicalName: 'Oak' }).returning();
  const [ours] = await db.insert(schema.teams).values({ slug: 'oak-a', name: 'Oak A', clubId: club!.id, divisionId: division!.id }).returning();
  const [rivals] = await db.insert(schema.teams).values({ slug: 'elm-a', name: 'Elm A', clubId: club!.id, divisionId: division!.id }).returning();
  const [me] = await db.insert(schema.players).values({ slug: 'jo-bloggs', name: 'Jo Bloggs', clubId: club!.id }).returning();
  const [partner] = await db.insert(schema.players).values({ slug: 'sam-day', name: 'Sam Day', clubId: club!.id }).returning();
  const [oppA] = await db.insert(schema.players).values({ slug: 'ann-oa', name: 'Ann Oa', clubId: club!.id }).returning();
  const [oppB] = await db.insert(schema.players).values({ slug: 'bob-ob', name: 'Bob Ob', clubId: club!.id }).returning();
  return { db, season: season!, division: division!, club: club!, ours: ours!, rivals: rivals!, me: me!, partner: partner!, oppA: oppA!, oppB: oppB! };
};

// Creates a completed fixture with one rubber (and optional set scores) on it.
const playFixture = async (
  db: ReturnType<typeof getDb>,
  args: {
    date: string; divisionId: number; homeTeamId: number; awayTeamId: number;
    homeIds: number[]; awayIds: number[]; sets: [number, number][];
  },
) => {
  const [fixture] = await db.insert(schema.fixtures).values({
    date: args.date, homeTeamId: args.homeTeamId, awayTeamId: args.awayTeamId,
    divisionId: args.divisionId, status: 'completed',
  }).returning();
  const [card] = await db.insert(schema.matchCards).values({ fixtureId: fixture!.id }).returning();
  const [rubber] = await db.insert(schema.rubbers).values({
    matchCardId: card!.id, orderInCard: 1, homePlayerIds: args.homeIds, awayPlayerIds: args.awayIds,
  }).returning();
  for (const [i, [home, away]] of args.sets.entries()) {
    await db.insert(schema.setScores).values({ rubberId: rubber!.id, orderInRubber: i + 1, homeScore: home, awayScore: away });
  }
  return fixture!;
};

describe('getPlayerPanel', () => {
  beforeAll(async () => { await startDb(); }, 120_000);
  afterAll(async () => { await stopDb(); });

  beforeEach(async () => {
    const db = getDb();
    await db.execute(sql`TRUNCATE seasons, divisions, clubs, teams, players, fixtures, match_cards, rubbers, set_scores, standings, rankings RESTART IDENTITY CASCADE`);
  });

  it('returns null for an unknown slug', async () => {
    expect(await getPlayerPanel(getDb(), 'nobody', '2026-08-09')).toBeNull();
  });

  it('builds the full panel: last result, record, team standing, ranking, next fixture', async () => {
    const s = await seed();
    // Older loss (away side, 0–2).
    await playFixture(s.db, {
      date: '2026-07-01', divisionId: s.division.id, homeTeamId: s.rivals.id, awayTeamId: s.ours.id,
      homeIds: [s.oppA.id, s.oppB.id], awayIds: [s.me.id, s.partner.id], sets: [[6, 3], [6, 4]],
    });
    // Latest win (home side, 2–0).
    await playFixture(s.db, {
      date: '2026-07-08', divisionId: s.division.id, homeTeamId: s.ours.id, awayTeamId: s.rivals.id,
      homeIds: [s.me.id, s.partner.id], awayIds: [s.oppA.id, s.oppB.id], sets: [[6, 1], [6, 4]],
    });
    // Team standing + player ranking + one future scheduled fixture.
    await s.db.insert(schema.standings).values({
      teamId: s.ours.id, divisionId: s.division.id, position: 2,
      resultsReceived: 2, resultsTotal: 18, pointsWon: '10', pointsLost: '6',
    });
    await s.db.insert(schema.rankings).values({
      playerId: s.me.id, divisionId: s.division.id, rank: 4,
      rubbersWon: '1', rubbersPlayed: '2', gamesWon: 24, gamesPlayed: 40,
      rankingScore: '55.00', movement: 'up',
    });
    const upcoming = await s.db.insert(schema.fixtures).values({
      date: '2026-08-14', homeTeamId: s.ours.id, awayTeamId: s.rivals.id,
      divisionId: s.division.id, status: 'scheduled',
    }).returning();

    const panel = await getPlayerPanel(s.db, 'jo-bloggs', '2026-08-09');
    expect(panel).not.toBeNull();
    expect(panel!.player).toEqual({ slug: 'jo-bloggs', name: 'Jo Bloggs' });
    expect(panel!.club).toEqual({ slug: 'oak', name: 'Oak' });
    expect(panel!.lastResult).toMatchObject({
      date: '2026-07-08', outcome: 'W', setsFor: 2, setsAgainst: 0,
      opponentTeam: { slug: 'elm-a', name: 'Elm A', divisionSlug: 'mens-1' },
    });
    expect(panel!.seasonRecord).toEqual({ wins: 1, losses: 1, draws: 0 });
    expect(panel!.team).toEqual({ slug: 'oak-a', name: 'Oak A', divisionSlug: 'mens-1', position: 2 });
    expect(panel!.primaryRanking).toEqual({ division: { slug: 'mens-1', name: 'Mens Division 1' }, rank: 4, movement: 'up' });
    expect(panel!.otherRankings).toEqual([]);
    expect(panel!.nextFixture).toMatchObject({
      fixtureId: upcoming[0]!.id, date: '2026-08-14', home: true, opponent: { slug: 'elm-a', name: 'Elm A' },
    });
  });

  it('handles a player with no rubbers: null result/team/next, zero record, ranking still shown', async () => {
    const s = await seed();
    await s.db.insert(schema.rankings).values({
      playerId: s.me.id, divisionId: s.division.id, rank: 9,
      rubbersWon: '0', rubbersPlayed: '0', gamesWon: 0, gamesPlayed: 0,
      rankingScore: '0.00', movement: 'new',
    });
    const panel = await getPlayerPanel(s.db, 'jo-bloggs', '2026-08-09');
    expect(panel!.lastResult).toBeNull();
    expect(panel!.team).toBeNull();
    expect(panel!.nextFixture).toBeNull();
    expect(panel!.seasonRecord).toEqual({ wins: 0, losses: 0, draws: 0 });
    expect(panel!.primaryRanking).toEqual({ division: { slug: 'mens-1', name: 'Mens Division 1' }, rank: 9, movement: 'new' });
  });

  it('counts a 1–1 two-set rubber as a draw and reports outcome D', async () => {
    const s = await seed();
    await playFixture(s.db, {
      date: '2026-07-08', divisionId: s.division.id, homeTeamId: s.ours.id, awayTeamId: s.rivals.id,
      homeIds: [s.me.id, s.partner.id], awayIds: [s.oppA.id, s.oppB.id], sets: [[6, 3], [4, 6]],
    });
    const panel = await getPlayerPanel(s.db, 'jo-bloggs', '2026-08-09');
    expect(panel!.lastResult!.outcome).toBe('D');
    expect(panel!.seasonRecord).toEqual({ wins: 0, losses: 0, draws: 1 });
  });

  it('derives the team from the most recent rubber when the player appears for two teams', async () => {
    const s = await seed();
    const [oakB] = await s.db.insert(schema.teams).values({ slug: 'oak-b', name: 'Oak B', clubId: s.club.id, divisionId: s.division.id }).returning();
    await playFixture(s.db, {
      date: '2026-07-01', divisionId: s.division.id, homeTeamId: s.ours.id, awayTeamId: s.rivals.id,
      homeIds: [s.me.id, s.partner.id], awayIds: [s.oppA.id, s.oppB.id], sets: [[6, 1], [6, 1]],
    });
    // Most recent appearance is for Oak B (away side).
    await playFixture(s.db, {
      date: '2026-07-15', divisionId: s.division.id, homeTeamId: s.rivals.id, awayTeamId: oakB!.id,
      homeIds: [s.oppA.id, s.oppB.id], awayIds: [s.me.id, s.partner.id], sets: [[6, 4], [3, 6], [10, 6]],
    });
    const panel = await getPlayerPanel(s.db, 'jo-bloggs', '2026-08-09');
    expect(panel!.team!.slug).toBe('oak-b');
    expect(panel!.lastResult).toMatchObject({ outcome: 'L', setsFor: 1, setsAgainst: 2 });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run (repo root): `pnpm vitest run packages/data/tests/player-panel.test.ts`
Expected: FAIL — `Cannot find module '../src/player-panel.js'` (or equivalent resolve error).

- [ ] **Step 3: Implement `packages/data/src/player-panel.ts`**

```ts
import { aliasedTable, and, arrayContains, eq, gte, inArray, or } from 'drizzle-orm';
import type { Database } from '@ctl/db';
import { schema } from '@ctl/db';

export type PanelRankingRow = {
  division: { slug: string; name: string };
  rank: number;
  movement: 'up' | 'down' | 'same' | 'new';
};

export type PlayerPanel = {
  player: { slug: string; name: string };
  club: { slug: string; name: string };
  // Most recent rubber that has recorded set scores; null when none exist.
  lastResult: {
    fixtureId: number;
    date: string;
    outcome: 'W' | 'L' | 'D';
    setsFor: number;
    setsAgainst: number;
    opponentTeam: { slug: string; name: string; divisionSlug: string };
  } | null;
  // W/L/D tally over all rubbers with recorded sets.
  seasonRecord: { wins: number; losses: number; draws: number };
  // Derived from the side of the most recent rubber; null when no rubbers.
  team: { slug: string; name: string; divisionSlug: string; position: number | null } | null;
  // Ranking for the derived team's division (falls back to first ranking).
  primaryRanking: PanelRankingRow | null;
  otherRankings: PanelRankingRow[];
  // Next scheduled fixture for the derived team on/after `today`.
  nextFixture: { fixtureId: number; date: string; home: boolean; opponent: { slug: string; name: string } } | null;
};

export const getPlayerPanel = async (db: Database, slug: string, today: string): Promise<PlayerPanel | null> => {
  const [player] = await db
    .select({
      id: schema.players.id,
      slug: schema.players.slug,
      name: schema.players.name,
      clubSlug: schema.clubs.slug,
      clubName: schema.clubs.canonicalName,
    })
    .from(schema.players)
    .innerJoin(schema.clubs, eq(schema.clubs.id, schema.players.clubId))
    .where(eq(schema.players.slug, slug))
    .limit(1);
  if (!player) return null;

  const home = aliasedTable(schema.teams, 'home_team');
  const away = aliasedTable(schema.teams, 'away_team');
  const rubberRows = await db
    .select({
      rubberId: schema.rubbers.id,
      homeIds: schema.rubbers.homePlayerIds,
      fixtureId: schema.fixtures.id,
      date: schema.fixtures.date,
      divSlug: schema.divisions.slug,
      homeTeamId: home.id, homeTeamSlug: home.slug, homeTeamName: home.name,
      awayTeamId: away.id, awayTeamSlug: away.slug, awayTeamName: away.name,
    })
    .from(schema.rubbers)
    .innerJoin(schema.matchCards, eq(schema.matchCards.id, schema.rubbers.matchCardId))
    .innerJoin(schema.fixtures, eq(schema.fixtures.id, schema.matchCards.fixtureId))
    .innerJoin(schema.divisions, eq(schema.divisions.id, schema.fixtures.divisionId))
    .innerJoin(home, eq(home.id, schema.fixtures.homeTeamId))
    .innerJoin(away, eq(away.id, schema.fixtures.awayTeamId))
    .where(or(arrayContains(schema.rubbers.homePlayerIds, [player.id]), arrayContains(schema.rubbers.awayPlayerIds, [player.id])))
    .orderBy(schema.fixtures.date, schema.rubbers.id);

  const rubberIds = rubberRows.map((r) => r.rubberId);
  const setRows = rubberIds.length
    ? await db.select().from(schema.setScores).where(inArray(schema.setScores.rubberId, rubberIds)).orderBy(schema.setScores.orderInRubber)
    : [];
  const setsByRubber = new Map<number, { home: number; away: number }[]>();
  for (const s of setRows) {
    const arr = setsByRubber.get(s.rubberId) ?? [];
    arr.push({ home: s.homeScore, away: s.awayScore });
    setsByRubber.set(s.rubberId, arr);
  }

  const played = rubberRows.map((r) => {
    const onHome = r.homeIds.includes(player.id);
    const sets = setsByRubber.get(r.rubberId) ?? [];
    const setsFor = sets.filter((s) => (onHome ? s.home > s.away : s.away > s.home)).length;
    const setsAgainst = sets.length - setsFor;
    const outcome: 'W' | 'L' | 'D' = setsFor > setsAgainst ? 'W' : setsFor < setsAgainst ? 'L' : 'D';
    return {
      fixtureId: r.fixtureId,
      date: r.date,
      divSlug: r.divSlug,
      hasSets: sets.length > 0,
      setsFor,
      setsAgainst,
      outcome,
      myTeam: onHome
        ? { id: r.homeTeamId, slug: r.homeTeamSlug, name: r.homeTeamName }
        : { id: r.awayTeamId, slug: r.awayTeamSlug, name: r.awayTeamName },
      opponentTeam: onHome
        ? { slug: r.awayTeamSlug, name: r.awayTeamName }
        : { slug: r.homeTeamSlug, name: r.homeTeamName },
    };
  });

  const scored = played.filter((p) => p.hasSets);
  const seasonRecord = {
    wins: scored.filter((p) => p.outcome === 'W').length,
    losses: scored.filter((p) => p.outcome === 'L').length,
    draws: scored.filter((p) => p.outcome === 'D').length,
  };
  const latest = played.at(-1) ?? null;         // team derivation uses any rubber
  const latestScored = scored.at(-1) ?? null;   // headline result needs set scores

  const lastResult = latestScored
    ? {
        fixtureId: latestScored.fixtureId,
        date: latestScored.date,
        outcome: latestScored.outcome,
        setsFor: latestScored.setsFor,
        setsAgainst: latestScored.setsAgainst,
        opponentTeam: { ...latestScored.opponentTeam, divisionSlug: latestScored.divSlug },
      }
    : null;

  let team: PlayerPanel['team'] = null;
  let nextFixture: PlayerPanel['nextFixture'] = null;
  if (latest) {
    const [standing] = await db
      .select({ position: schema.standings.position })
      .from(schema.standings)
      .where(eq(schema.standings.teamId, latest.myTeam.id))
      .limit(1);
    team = { slug: latest.myTeam.slug, name: latest.myTeam.name, divisionSlug: latest.divSlug, position: standing?.position ?? null };

    const [next] = await db
      .select({
        id: schema.fixtures.id,
        date: schema.fixtures.date,
        homeTeamId: schema.fixtures.homeTeamId,
        homeSlug: home.slug, homeName: home.name,
        awaySlug: away.slug, awayName: away.name,
      })
      .from(schema.fixtures)
      .innerJoin(home, eq(home.id, schema.fixtures.homeTeamId))
      .innerJoin(away, eq(away.id, schema.fixtures.awayTeamId))
      .where(
        and(
          eq(schema.fixtures.status, 'scheduled'),
          gte(schema.fixtures.date, today),
          or(eq(schema.fixtures.homeTeamId, latest.myTeam.id), eq(schema.fixtures.awayTeamId, latest.myTeam.id)),
        ),
      )
      .orderBy(schema.fixtures.date)
      .limit(1);
    if (next) {
      const isHome = next.homeTeamId === latest.myTeam.id;
      nextFixture = {
        fixtureId: next.id,
        date: next.date,
        home: isHome,
        opponent: isHome ? { slug: next.awaySlug, name: next.awayName } : { slug: next.homeSlug, name: next.homeName },
      };
    }
  }

  const rankingRows = await db
    .select({
      divSlug: schema.divisions.slug,
      divName: schema.divisions.name,
      rank: schema.rankings.rank,
      movement: schema.rankings.movement,
    })
    .from(schema.rankings)
    .innerJoin(schema.divisions, eq(schema.divisions.id, schema.rankings.divisionId))
    .where(eq(schema.rankings.playerId, player.id))
    .orderBy(schema.divisions.name);
  const rankings: PanelRankingRow[] = rankingRows.map((r) => ({
    division: { slug: r.divSlug, name: r.divName },
    rank: r.rank,
    movement: r.movement,
  }));
  const primaryRanking = rankings.find((r) => r.division.slug === latest?.divSlug) ?? rankings[0] ?? null;
  const otherRankings = rankings.filter((r) => r !== primaryRanking);

  return {
    player: { slug: player.slug, name: player.name },
    club: { slug: player.clubSlug, name: player.clubName },
    lastResult,
    seasonRecord,
    team,
    primaryRanking,
    otherRankings,
    nextFixture,
  };
};
```

Then add to `packages/data/src/index.ts`:

```ts
export * from './player-panel.js';
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run packages/data/tests/player-panel.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/data/src/player-panel.ts packages/data/src/index.ts packages/data/tests/player-panel.test.ts
git commit -m "feat(data): getPlayerPanel — personal panel read model

Refs calderdale-tennis-league-mt9

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: `searchPlayers` data function

**Files:**
- Modify: `packages/data/src/players.ts` (append at end of file)
- Test: `packages/data/tests/player-search.test.ts`

**Interfaces:**
- Produces (used by Task 4):
  - `searchPlayers(db: Database, query: string): Promise<PlayerSearchRow[]>`
  - `type PlayerSearchRow = { slug: string; name: string; club: { slug: string; name: string } }`

- [ ] **Step 1: Write the failing tests**

Create `packages/data/tests/player-search.test.ts`:

```ts
import { afterAll, beforeAll, beforeEach, describe, it, expect } from 'vitest';
import { sql } from 'drizzle-orm';
import { startDb, stopDb, getDb } from './setup.js';
import { schema } from '@ctl/db';
import { searchPlayers } from '../src/players.js';

describe('searchPlayers', () => {
  beforeAll(async () => { await startDb(); }, 120_000);
  afterAll(async () => { await stopDb(); });

  beforeEach(async () => {
    const db = getDb();
    await db.execute(sql`TRUNCATE clubs, players RESTART IDENTITY CASCADE`);
    const [oak] = await db.insert(schema.clubs).values({ slug: 'oak', canonicalName: 'Oak' }).returning();
    const [elm] = await db.insert(schema.clubs).values({ slug: 'elm', canonicalName: 'Elm' }).returning();
    await db.insert(schema.players).values([
      { slug: 'jo-bloggs', name: 'Jo Bloggs', clubId: oak!.id },
      { slug: 'joan-blake', name: 'Joan Blake', clubId: elm!.id },
      { slug: 'sam-day', name: 'Sam Day', clubId: oak!.id },
    ]);
  });

  it('matches case-insensitively on a substring and includes the club', async () => {
    const rows = await searchPlayers(getDb(), 'blo');
    expect(rows).toEqual([{ slug: 'jo-bloggs', name: 'Jo Bloggs', club: { slug: 'oak', name: 'Oak' } }]);
  });

  it('orders results by name', async () => {
    const rows = await searchPlayers(getDb(), 'jo');
    expect(rows.map((r) => r.name)).toEqual(['Jo Bloggs', 'Joan Blake']);
  });

  it('returns empty for no match', async () => {
    expect(await searchPlayers(getDb(), 'zzz')).toEqual([]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run packages/data/tests/player-search.test.ts`
Expected: FAIL — `searchPlayers` is not exported.

- [ ] **Step 3: Implement**

Append to `packages/data/src/players.ts` (and add `ilike` to the existing drizzle-orm import at the top, making it `import { arrayContains, eq, ilike, inArray, or } from 'drizzle-orm';`):

```ts
export type PlayerSearchRow = { slug: string; name: string; club: { slug: string; name: string } };

// Case-insensitive substring search over player names, for the /players
// "find your name" page. Capped at 25 rows — plenty for disambiguation.
export const searchPlayers = async (db: Database, query: string): Promise<PlayerSearchRow[]> => {
  const rows = await db
    .select({
      slug: schema.players.slug,
      name: schema.players.name,
      clubSlug: schema.clubs.slug,
      clubName: schema.clubs.canonicalName,
    })
    .from(schema.players)
    .innerJoin(schema.clubs, eq(schema.clubs.id, schema.players.clubId))
    .where(ilike(schema.players.name, `%${query.trim()}%`))
    .orderBy(schema.players.name)
    .limit(25);
  return rows.map((r) => ({ slug: r.slug, name: r.name, club: { slug: r.clubSlug, name: r.clubName } }));
};
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run packages/data/tests/player-search.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/data/src/players.ts packages/data/tests/player-search.test.ts
git commit -m "feat(data): searchPlayers — name search for the claim flow

Refs calderdale-tennis-league-mt9

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: identity cookie helpers

**Files:**
- Create: `apps/web/src/lib/server/identity.ts`
- Test: `apps/web/src/lib/server/identity.test.ts`

**Interfaces:**
- Produces (used by Tasks 5 & 6):
  - `ME_COOKIE = 'ctl_me'` (string constant)
  - `type Identity = { slug: string; name: string }`
  - `parseMeCookie(raw: string | undefined): Identity[]` — never throws; `[]` on any bad input
  - `serializeMeCookie(identities: Identity[]): string`
  - `ME_COOKIE_OPTS` — SvelteKit cookie options object

- [ ] **Step 1: Write the failing tests**

Create `apps/web/src/lib/server/identity.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { parseMeCookie, serializeMeCookie } from './identity';

describe('identity cookie', () => {
  it('round-trips a single identity', () => {
    const raw = serializeMeCookie([{ slug: 'jo-bloggs', name: 'Jo Bloggs' }]);
    expect(parseMeCookie(raw)).toEqual([{ slug: 'jo-bloggs', name: 'Jo Bloggs' }]);
  });

  it('returns [] for undefined, empty, non-JSON, and wrong-shape input', () => {
    expect(parseMeCookie(undefined)).toEqual([]);
    expect(parseMeCookie('')).toEqual([]);
    expect(parseMeCookie('not json')).toEqual([]);
    expect(parseMeCookie('{"players":"nope"}')).toEqual([]);
    expect(parseMeCookie('[]')).toEqual([]);
    expect(parseMeCookie('{"players":[{"slug":1}]}')).toEqual([]);
  });

  it('keeps only well-formed entries', () => {
    const raw = '{"players":[{"slug":"a","name":"A"},{"bad":true}]}';
    expect(parseMeCookie(raw)).toEqual([{ slug: 'a', name: 'A' }]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run (from `apps/web`): `pnpm vitest run src/lib/server/identity.test.ts`
Expected: FAIL — cannot resolve `./identity`.

- [ ] **Step 3: Implement `apps/web/src/lib/server/identity.ts`**

```ts
// The visitor's claimed player identity, stored client-side only in a
// first-party cookie. A LIST so "follow teammates" can arrive later without
// a cookie migration — v1 reads only the first entry.
export const ME_COOKIE = 'ctl_me';

export type Identity = { slug: string; name: string };

// Never throws: any malformed/legacy cookie is treated as "not identified".
export const parseMeCookie = (raw: string | undefined): Identity[] => {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    const players = (parsed as { players?: unknown } | null)?.players;
    if (!Array.isArray(players)) return [];
    return players.filter(
      (p): p is Identity =>
        typeof p === 'object' && p !== null &&
        typeof (p as Record<string, unknown>).slug === 'string' &&
        typeof (p as Record<string, unknown>).name === 'string',
    ).map((p) => ({ slug: p.slug, name: p.name }));
  } catch {
    return [];
  }
};

export const serializeMeCookie = (identities: Identity[]): string =>
  JSON.stringify({ players: identities.map(({ slug, name }) => ({ slug, name })) });

// Not HttpOnly: this is the visitor's own device state, clearable client-side.
export const ME_COOKIE_OPTS = {
  path: '/',
  maxAge: 60 * 60 * 24 * 365,
  sameSite: 'lax',
  httpOnly: false,
} as const;
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run src/lib/server/identity.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/server/identity.ts apps/web/src/lib/server/identity.test.ts
git commit -m "feat(web): ctl_me identity cookie helpers

Refs calderdale-tennis-league-mt9

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: `/players` search route

**Files:**
- Create: `apps/web/src/routes/players/+page.server.ts`
- Create: `apps/web/src/routes/players/+page.svelte`
- Test: `apps/web/src/routes/players/page.server.test.ts`
- Modify: `apps/web/src/app.css` (append `.searchbox` styles)

**Interfaces:**
- Consumes: `searchPlayers` from `@ctl/data` (Task 2).
- Produces: page data `{ q: string; results: PlayerSearchRow[] }`.

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/routes/players/page.server.test.ts` (mirrors the existing mock pattern in `apps/web/src/routes/page.server.test.ts`):

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('$lib/server/db', () => ({ getDb: () => ({}) }));
vi.mock('@ctl/data', () => ({ searchPlayers: vi.fn() }));

import { load } from './+page.server.js';
import { searchPlayers } from '@ctl/data';

const event = (q: string | null) =>
  ({ url: new URL(`http://localhost/players${q != null ? `?q=${encodeURIComponent(q)}` : ''}`) }) as never;

describe('players search load', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('does not query for a missing or short q', async () => {
    expect(await load(event(null))).toEqual({ q: '', results: [] });
    expect(await load(event('j'))).toEqual({ q: 'j', results: [] });
    expect(vi.mocked(searchPlayers)).not.toHaveBeenCalled();
  });

  it('queries and returns results for q of 2+ chars', async () => {
    vi.mocked(searchPlayers).mockResolvedValue([
      { slug: 'jo-bloggs', name: 'Jo Bloggs', club: { slug: 'oak', name: 'Oak' } },
    ]);
    const result = await load(event('jo'));
    expect(vi.mocked(searchPlayers)).toHaveBeenCalledWith({}, 'jo');
    expect(result.results).toHaveLength(1);
    expect(result.q).toBe('jo');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/routes/players/page.server.test.ts`
Expected: FAIL — cannot resolve `./+page.server.js`.

- [ ] **Step 3: Implement server + page**

`apps/web/src/routes/players/+page.server.ts`:

```ts
import { searchPlayers } from '@ctl/data';
import { getDb } from '$lib/server/db';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ url }) => {
  const q = url.searchParams.get('q')?.trim() ?? '';
  const results = q.length >= 2 ? await searchPlayers(getDb(), q) : [];
  return { q, results };
};
```

`apps/web/src/routes/players/+page.svelte`:

```svelte
<script lang="ts">
  let { data } = $props();
</script>

<nav class="crumbs"><a href="/">Home</a> › Find your name</nav>
<h1>Find your name</h1>
<p class="muted">Pick yourself to pin your results to the homepage on this device.</p>

<form method="GET" class="searchbox" role="search">
  <input type="search" name="q" value={data.q} placeholder="Your name…" aria-label="Player name" />
  <button type="submit">Search</button>
</form>

{#if data.q.length < 2}
  <p class="muted">Type at least two letters of your name.</p>
{:else if data.results.length === 0}
  <p class="muted">No players match “{data.q}”.</p>
{:else}
  <div class="cards">
    {#each data.results as p (p.slug)}
      <a class="card" href="/players/{p.slug}">
        <h3>{p.name}</h3>
        <p class="muted">{p.club.name}</p>
      </a>
    {/each}
  </div>
{/if}
```

Append to `apps/web/src/app.css`:

```css
/* ---- /players name search ------------------------------------------------ */
.searchbox { display: flex; gap: 8px; margin: 16px 0 8px; }
.searchbox input {
  flex: 1; font: inherit; color: var(--text);
  background: var(--panel); border: 1px solid var(--border); border-radius: 999px;
  padding: 10px 18px; outline: none;
}
.searchbox input:focus { border-color: var(--accent); }
.searchbox button {
  font: inherit; font-weight: 700; font-size: 13px; cursor: pointer;
  background: var(--accent); color: var(--accent-ink);
  border: none; border-radius: 999px; padding: 10px 22px;
}
.card p.muted { margin: 4px 0 0; font-size: 13px; }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/routes/players/page.server.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/routes/players/+page.server.ts apps/web/src/routes/players/+page.svelte apps/web/src/routes/players/page.server.test.ts apps/web/src/app.css
git commit -m "feat(web): /players find-your-name search page

Refs calderdale-tennis-league-mt9

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: claim/forget actions + player-page UI

**Files:**
- Modify: `apps/web/src/routes/players/[slug]/+page.server.ts` (add cookie read to load; add actions)
- Modify: `apps/web/src/routes/players/[slug]/+page.svelte` (claim/forget UI under the club line)
- Test: `apps/web/src/routes/players/[slug]/page.server.test.ts` (create)
- Modify: `apps/web/src/app.css` (append `.me-claim` styles)

**Interfaces:**
- Consumes: `getPlayer`, `getPlayerProfile` from `@ctl/data`; `ME_COOKIE`, `ME_COOKIE_OPTS`, `parseMeCookie`, `serializeMeCookie` from `$lib/server/identity` (Task 3).
- Produces: page data gains `isMe: boolean`; form actions `?/claim` (sets cookie, redirects `/`) and `?/forget` (deletes cookie).

- [ ] **Step 1: Write the failing tests**

Create `apps/web/src/routes/players/[slug]/page.server.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('$lib/server/db', () => ({ getDb: () => ({}) }));
vi.mock('@ctl/data', () => ({ getPlayer: vi.fn(), getPlayerProfile: vi.fn() }));

import { load, actions } from './+page.server.js';
import { getPlayer, getPlayerProfile } from '@ctl/data';
import { serializeMeCookie } from '$lib/server/identity';

const profile = {
  player: { slug: 'jo-bloggs', name: 'Jo Bloggs' },
  club: { slug: 'oak', name: 'Oak' },
  rankings: [], matchHistory: [],
};

describe('player page load', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('flags isMe when the cookie matches the page slug', async () => {
    vi.mocked(getPlayerProfile).mockResolvedValue(profile);
    const cookies = { get: () => serializeMeCookie([{ slug: 'jo-bloggs', name: 'Jo Bloggs' }]) };
    const result = await load({ params: { slug: 'jo-bloggs' }, cookies } as never);
    expect(result.isMe).toBe(true);
  });

  it('flags isMe false with no cookie', async () => {
    vi.mocked(getPlayerProfile).mockResolvedValue(profile);
    const cookies = { get: () => undefined };
    const result = await load({ params: { slug: 'jo-bloggs' }, cookies } as never);
    expect(result.isMe).toBe(false);
  });
});

describe('claim/forget actions', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('claim sets the cookie and redirects home', async () => {
    vi.mocked(getPlayer).mockResolvedValue({ id: 1, slug: 'jo-bloggs', name: 'Jo Bloggs', clubId: 1 });
    const set = vi.fn();
    await expect(
      actions.claim({ params: { slug: 'jo-bloggs' }, cookies: { set } } as never),
    ).rejects.toMatchObject({ status: 303, location: '/' });
    expect(set).toHaveBeenCalledWith(
      'ctl_me',
      JSON.stringify({ players: [{ slug: 'jo-bloggs', name: 'Jo Bloggs' }] }),
      expect.objectContaining({ path: '/', sameSite: 'lax' }),
    );
  });

  it('claim 404s for an unknown player and sets nothing', async () => {
    vi.mocked(getPlayer).mockResolvedValue(null);
    const set = vi.fn();
    await expect(
      actions.claim({ params: { slug: 'nobody' }, cookies: { set } } as never),
    ).rejects.toMatchObject({ status: 404 });
    expect(set).not.toHaveBeenCalled();
  });

  it('forget deletes the cookie', async () => {
    const del = vi.fn();
    await actions.forget({ cookies: { delete: del } } as never);
    expect(del).toHaveBeenCalledWith('ctl_me', { path: '/' });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run 'src/routes/players/[slug]/page.server.test.ts'`
Expected: FAIL — `actions` is not exported (and `load` lacks `isMe`).

- [ ] **Step 3: Implement**

Replace `apps/web/src/routes/players/[slug]/+page.server.ts` with:

```ts
import { error, redirect } from '@sveltejs/kit';
import { getPlayer, getPlayerProfile } from '@ctl/data';
import { getDb } from '$lib/server/db';
import { ME_COOKIE, ME_COOKIE_OPTS, parseMeCookie, serializeMeCookie } from '$lib/server/identity';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, cookies }) => {
  const profile = await getPlayerProfile(getDb(), params.slug);
  if (!profile) throw error(404, 'Player not found');
  const me = parseMeCookie(cookies.get(ME_COOKIE))[0];
  return { profile, isMe: me?.slug === params.slug };
};

export const actions: Actions = {
  // "This is me" — pin this player to the homepage on this device.
  claim: async ({ params, cookies }) => {
    const player = await getPlayer(getDb(), params.slug);
    if (!player) throw error(404, 'Player not found');
    cookies.set(ME_COOKIE, serializeMeCookie([{ slug: player.slug, name: player.name }]), ME_COOKIE_OPTS);
    throw redirect(303, '/');
  },
  forget: async ({ cookies }) => {
    cookies.delete(ME_COOKIE, { path: '/' });
  },
};
```

In `apps/web/src/routes/players/[slug]/+page.svelte`, insert directly after the club line (`<p class="muted"><a href="/clubs/{p.club.slug}">{p.club.name}</a></p>`):

```svelte
{#if data.isMe}
  <form method="POST" action="?/forget" class="me-claim">
    <span class="pinned">✓ Pinned to your homepage</span>
    <button class="ghost" type="submit">Forget me on this device</button>
  </form>
{:else}
  <form method="POST" action="?/claim" class="me-claim">
    <button class="pill" type="submit">This is me — pin to homepage</button>
    <span class="muted note">Saved only on this device — nothing is sent anywhere.</span>
  </form>
{/if}
```

Append to `apps/web/src/app.css`:

```css
/* ---- Claim / forget (player page) --------------------------------------- */
.me-claim { display: flex; align-items: center; gap: 12px; margin: 14px 0 4px; flex-wrap: wrap; }
.me-claim .pill {
  font: inherit; font-weight: 700; font-size: 13px; cursor: pointer;
  background: var(--accent); color: var(--accent-ink);
  border: none; border-radius: 999px; padding: 9px 18px;
}
.me-claim .note { font-size: 12px; font-family: var(--mono); color: var(--muted-2); }
.me-claim .pinned { color: var(--accent); font-weight: 700; font-size: 13px; }
button.ghost {
  font: inherit; font-size: 12px; cursor: pointer;
  background: transparent; color: var(--muted);
  border: 1px solid var(--border); border-radius: 999px; padding: 7px 14px;
}
button.ghost:hover { color: var(--text); border-color: var(--muted); }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run 'src/routes/players/[slug]/page.server.test.ts'`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add 'apps/web/src/routes/players/[slug]/+page.server.ts' 'apps/web/src/routes/players/[slug]/+page.svelte' 'apps/web/src/routes/players/[slug]/page.server.test.ts' apps/web/src/app.css
git commit -m "feat(web): claim/forget identity from the player page

Refs calderdale-tennis-league-mt9

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: homepage Courtside panel

**Files:**
- Modify: `apps/web/src/routes/+page.server.ts` (cookie read, panel fetch, forget action)
- Modify: `apps/web/src/routes/+page.svelte` (panel markup + discovery line)
- Modify: `apps/web/src/routes/page.server.test.ts` (update existing calls; add panel tests)
- Modify: `apps/web/src/app.css` (append panel styles)

**Interfaces:**
- Consumes: `getPlayerPanel` + `PlayerPanel` from `@ctl/data` (Task 1); identity helpers (Task 3); `formatDate` from `$lib/format`.
- Produces: home page data gains `me: Identity | null` and `panel: PlayerPanel | null`; form action `?/forget`.

- [ ] **Step 1: Update/extend the tests (failing first)**

In `apps/web/src/routes/page.server.test.ts`:

1. Extend the `@ctl/data` mock with `getPlayerPanel: vi.fn()`.
2. The two existing tests call `load({} as never)` — change both to `load({ cookies: { get: () => undefined } } as never)` and add to each: `expect(result.me).toBeNull(); expect(result.panel).toBeNull();` (in the second test just the `me` assertion is enough).
3. Add these tests (the `import` line gains `getPlayerPanel`; also `import { serializeMeCookie } from '$lib/server/identity';`):

```ts
  it('fetches the panel when a valid ctl_me cookie is present', async () => {
    vi.mocked(getCurrentSeason).mockResolvedValue({ id: 1, slug: 'summer-2026', name: 'Summer 2026', current: true });
    vi.mocked(listSeasons).mockResolvedValue([{ id: 1, slug: 'summer-2026', name: 'Summer 2026', current: true }]);
    vi.mocked(listDivisions).mockResolvedValue([]);
    vi.mocked(listClubs).mockResolvedValue([]);
    const panel = { player: { slug: 'jo-bloggs', name: 'Jo Bloggs' } };
    vi.mocked(getPlayerPanel).mockResolvedValue(panel as never);
    const cookies = { get: () => serializeMeCookie([{ slug: 'jo-bloggs', name: 'Jo Bloggs' }]) };
    const result = await load({ cookies } as never);
    expect(vi.mocked(getPlayerPanel)).toHaveBeenCalledWith({}, 'jo-bloggs', expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/));
    expect(result.me).toEqual({ slug: 'jo-bloggs', name: 'Jo Bloggs' });
    expect(result.panel).toEqual(panel);
  });

  it('treats a malformed cookie as unidentified', async () => {
    vi.mocked(getCurrentSeason).mockResolvedValue(null);
    vi.mocked(listSeasons).mockResolvedValue([]);
    vi.mocked(listClubs).mockResolvedValue([]);
    const result = await load({ cookies: { get: () => 'not json' } } as never);
    expect(result.me).toBeNull();
    expect(result.panel).toBeNull();
    expect(vi.mocked(getPlayerPanel)).not.toHaveBeenCalled();
  });
```

- [ ] **Step 2: Run tests to verify the new ones fail**

Run: `pnpm vitest run src/routes/page.server.test.ts`
Expected: FAIL — `load` does not return `me`/`panel` (existing tests may also fail on the destructure until Step 3).

- [ ] **Step 3: Implement server + page + styles**

Replace `apps/web/src/routes/+page.server.ts` with:

```ts
import { getCurrentSeason, listSeasons, listDivisions, listClubs, getPlayerPanel } from '@ctl/data';
import { getDb } from '$lib/server/db';
import { groupByDivisionGroup } from '$lib/format';
import { ME_COOKIE, parseMeCookie } from '$lib/server/identity';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ cookies }) => {
  const db = getDb();
  const currentSeason = await getCurrentSeason(db);
  const seasons = await listSeasons(db);
  const me = parseMeCookie(cookies.get(ME_COOKIE))[0] ?? null;
  const today = new Date().toISOString().slice(0, 10);
  const [divisions, clubs, panel] = await Promise.all([
    currentSeason ? listDivisions(db, currentSeason.id) : Promise.resolve([]),
    listClubs(db),
    me ? getPlayerPanel(db, me.slug, today) : Promise.resolve(null),
  ]);
  const stats = { divisions: divisions.length, clubs: clubs.length, seasons: seasons.length };
  return { currentSeason, seasons, groups: groupByDivisionGroup(divisions), stats, me, panel };
};

export const actions: Actions = {
  forget: async ({ cookies }) => {
    cookies.delete(ME_COOKIE, { path: '/' });
  },
};
```

In `apps/web/src/routes/+page.svelte`: add `import { formatDate } from '$lib/format';` to the script block, then insert this block **between** `</section>` (hero close) and the `{#if data.currentSeason}` block:

```svelte
{#if data.me}
  <aside class="me-panel" aria-label="Your results">
    {#if data.panel}
      <header class="me-head">
        <span class="me-title">Your results</span>
        <a class="me-name" href="/players/{data.panel.player.slug}">{data.panel.player.name}</a>
        <a class="muted" href="/clubs/{data.panel.club.slug}">{data.panel.club.name}</a>
      </header>
      {#if data.panel.lastResult}
        <p class="me-result">
          <span class="badge badge-{data.panel.lastResult.outcome}">{data.panel.lastResult.outcome}</span>
          <span class="score">{data.panel.lastResult.setsFor}–{data.panel.lastResult.setsAgainst}</span>
          vs {data.panel.lastResult.opponentTeam.name}
          <span class="muted">· {formatDate(data.panel.lastResult.date)}</span>
          <a href="/matches/{data.panel.lastResult.fixtureId}">card →</a>
        </p>
      {:else}
        <p class="me-result muted mono-dim">No rubbers yet this season</p>
      {/if}
      <div class="me-stats">
        {#if data.panel.primaryRanking}
          <div class="me-stat">
            <span class="label">Rank</span>
            <span class="value">
              {data.panel.primaryRanking.rank}
              {#if data.panel.primaryRanking.movement === 'up'}<span class="mvmt up" role="img" aria-label="moving up">▲</span>
              {:else if data.panel.primaryRanking.movement === 'down'}<span class="mvmt down" role="img" aria-label="moving down">▼</span>{/if}
            </span>
          </div>
        {/if}
        {#if data.panel.team}
          <div class="me-stat">
            <span class="label">Team</span>
            <span class="value">
              <a href="/teams/{data.panel.team.divisionSlug}/{data.panel.team.slug}">
                {data.panel.team.position != null ? `${data.panel.team.position}` : data.panel.team.name}
              </a>
              {#if data.panel.team.position != null}<span class="muted small">{data.panel.team.name}</span>{/if}
            </span>
          </div>
        {/if}
        <div class="me-stat">
          <span class="label">W–L</span>
          <span class="value">{data.panel.seasonRecord.wins}–{data.panel.seasonRecord.losses}{#if data.panel.seasonRecord.draws}–{data.panel.seasonRecord.draws}D{/if}</span>
        </div>
      </div>
      {#if data.panel.nextFixture}
        <p class="me-next">
          Next: {data.panel.nextFixture.home ? 'vs' : 'at'} {data.panel.nextFixture.opponent.name}
          <span class="muted">· {formatDate(data.panel.nextFixture.date)}</span>
        </p>
      {/if}
      {#if data.panel.otherRankings.length}
        <p class="muted small">
          Also ranked: {#each data.panel.otherRankings as r, i (r.division.slug)}{i > 0 ? ', ' : ''}{r.division.name} #{r.rank}{/each}
        </p>
      {/if}
    {:else}
      <header class="me-head"><span class="me-title">Your results</span></header>
      <p class="me-result muted">No entry for {data.me.name} this season.</p>
    {/if}
    <footer class="me-foot">
      {#if data.panel}<a href="/players/{data.panel.player.slug}">Full profile →</a>{/if}
      <span class="me-actions">
        Not you? <a href="/players">Switch</a>
        <form method="POST" action="?/forget"><button class="ghost" type="submit">Forget</button></form>
      </span>
    </footer>
    <p class="me-privacy">Saved only on this device — nothing is sent anywhere.</p>
  </aside>
{:else}
  <p class="me-hint">Play in the league? <a href="/players">Pin your results →</a></p>
{/if}
```

Append to `apps/web/src/app.css`:

```css
/* ---- Courtside: personal results panel (homepage) ------------------------ */
.me-hint { margin: 18px 0 0; font-size: 14px; color: var(--muted); }
.me-panel {
  margin: 26px 0 0; padding: 18px 20px;
  background: var(--panel); border: 1px solid var(--border); border-radius: 12px;
  border-left: 3px solid var(--accent);
}
.me-head { display: flex; align-items: baseline; gap: 12px; flex-wrap: wrap; }
.me-title {
  font-size: 10px; font-weight: 700; letter-spacing: 0.16em;
  text-transform: uppercase; color: var(--accent);
}
.me-name {
  font-family: var(--display); font-size: 22px; text-transform: uppercase;
  letter-spacing: 0.02em; color: var(--text);
}
.me-result { margin: 12px 0 0; font-size: 15px; }
.me-result .badge {
  display: inline-block; min-width: 22px; text-align: center;
  font-family: var(--mono); font-weight: 700; font-size: 13px;
  border-radius: 6px; padding: 2px 6px; margin-right: 4px;
}
.badge-W { background: var(--accent-dim); color: var(--accent); }
.badge-L { background: rgba(255, 107, 94, 0.14); color: #ff6b5e; }
.badge-D { background: var(--panel-2); color: var(--muted); }
.me-stats {
  display: grid; grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px; margin-top: 14px;
}
.me-stat .label {
  display: block; font-size: 10px; font-weight: 700;
  letter-spacing: 0.16em; text-transform: uppercase; color: var(--muted);
}
.me-stat .value {
  font-family: var(--mono); font-weight: 700; font-size: 20px;
  font-variant-numeric: tabular-nums;
}
.me-stat .value .small { font-size: 11px; font-weight: 400; margin-left: 6px; }
.mvmt.up { color: var(--accent); font-size: 12px; }
.mvmt.down { color: #ff6b5e; font-size: 12px; }
.me-next { margin: 12px 0 0; font-size: 14px; }
.me-foot {
  display: flex; justify-content: space-between; align-items: center;
  gap: 12px; margin-top: 14px; flex-wrap: wrap;
}
.me-actions { display: inline-flex; align-items: center; gap: 8px; font-size: 12px; color: var(--muted); }
.me-actions form { margin: 0; display: inline; }
.me-privacy { margin: 10px 0 0; font-size: 11px; font-family: var(--mono); color: var(--muted-2); }
.small { font-size: 12px; }
```

- [ ] **Step 4: Run the web test suite**

Run (from `apps/web`): `npm test`
Expected: PASS — all suites including the extended `page.server.test.ts`.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/routes/+page.server.ts apps/web/src/routes/+page.svelte apps/web/src/routes/page.server.test.ts apps/web/src/app.css
git commit -m "feat(web): Courtside — SSR personal results panel on the homepage

Refs calderdale-tennis-league-mt9

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 7: quality gates + live verification

**Files:** none created — verification only.

**Interfaces:** consumes the running app; produces evidence the claim → panel → forget loop works.

- [ ] **Step 1: Full test suite + typecheck + build**

```bash
cd /Users/danielchicot/ghq/github.com/DanielChicot/calderdale-tennis-league
pnpm test                       # full workspace suite (Docker required)
pnpm --filter @ctl/web check    # svelte-check: expect 0 errors
pnpm --filter @ctl/web build    # production build: expect success
```
Expected: all pass. Fix anything that fails before proceeding.

- [ ] **Step 2: Live claim-flow smoke test**

Start Postgres if needed (`pnpm db:dev && pnpm db:migrate`, then a scrape if empty), then:

```bash
cd apps/web
DATABASE_URL=postgres://ctl:ctl@localhost:5433/ctl npm run dev
```

In a browser (Chrome DevTools MCP or manually) verify, screenshotting each step:
1. `/` unidentified → hero unchanged + "Play in the league? Pin your results →" line, no panel.
2. Follow it → `/players`, search a real player (e.g. "duffin") → result card shows name + club.
3. Player page → "This is me — pin to homepage" → redirected to `/` → panel renders with real last result, stat row, next fixture (server-rendered: view-source contains the panel HTML).
4. Panel "Forget" → panel gone, discovery line back.
5. Edge: set cookie to garbage in DevTools (`document.cookie = 'ctl_me=broken'`) → reload: unidentified experience, no error.

- [ ] **Step 3: Close the issue, push**

```bash
bd close calderdale-tennis-league-mt9 --reason="Courtside panel shipped: claim/forget, /players search, SSR homepage panel, 13+ new tests"
git pull --rebase && git push && git status   # must end "up to date with origin"
```

---

## Self-review notes

- **Spec coverage:** claim entry points (Tasks 4+5), cookie shape/persistence (Task 3), SSR panel + content hierarchy + edge states (Tasks 1+6), derived team (Task 1), `/players` search (Tasks 2+4), forget/switch (Tasks 5+6), microcopy verbatim (Tasks 5+6), accessibility aside/aria (Task 6), no-schema-change constraint (all). Out-of-scope items untouched.
- **Type consistency:** `PlayerPanel`/`PanelRankingRow`/`Identity`/`PlayerSearchRow` defined once (Tasks 1–3) and consumed by name in Tasks 4–6; cookie literal `ctl_me` appears only in `identity.ts` and tests.
- **Sequencing:** Tasks 1–3 are independent of each other; 4 needs 2; 5 needs 3; 6 needs 1+3+5 (forget button styling from Task 5's `.ghost`). Execute in numeric order.
