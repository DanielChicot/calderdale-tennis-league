# Web Viewer — Data-Tier Getters Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the five new/extended `@ctl/data` getters the web viewer needs — `listFixturesByDivision`, `getMatchCard`, `getClubDetail`, `getTeam`, `getPlayerProfile` — each pure, Testcontainers-tested, and exported.

**Architecture:** Plain `(db, ...) => Promise<T | null | T[]>` functions in `packages/data/src/*.ts`, matching the existing getters exactly (drizzle queries, `schema` from `@ctl/db`, numeric columns surfaced as strings). This is Plan 1 of 3 for the web viewer (spec: `docs/superpowers/specs/2026-06-13-web-viewer-design.md`); the SvelteKit app and deployment are separate plans that consume these.

**Tech Stack:** TypeScript 5.6 strict (verbatimModuleSyntax, exactOptionalPropertyTypes, noUncheckedIndexedAccess), Drizzle ORM 0.36 + postgres-js, Vitest 2.1, Testcontainers 10.13 (`GenericContainer` postgres:16-alpine).

**Conventions (verified against the existing code):**
- Cross-file imports in `packages/data/src` use `.js` extensions (`from '../src/players.js'` in tests; `export * from './players.js'` in `index.ts`).
- Tests live in `packages/data/tests/*.test.ts`, use the shared `startDb/stopDb/getDb` from `./setup.js`, a `beforeEach` `TRUNCATE`, and 120s `beforeAll` timeout.
- `numeric` columns (`results.homeScore`, `standings.pointsWon`, `rankings.rankingScore`, `clubs.lat/lng`) come back as **strings**. `integer` columns (`set_scores.homeScore`) come back as **numbers**.
- `exactOptionalPropertyTypes`: build optional fields with a conditional spread (`...(x != null ? { score: ... } : {})`), never `score: undefined`.
- Run a single test file: `pnpm vitest run packages/data/tests/<file>.test.ts`. Cold container start is 60–120s.

---

### Task 1: `listFixturesByDivision`

**Files:**
- Modify: `packages/data/src/fixtures.ts`
- Modify: `packages/data/src/index.ts` (already exports `./fixtures.js` — no change needed; verify)
- Test: `packages/data/tests/fixtures-by-division.test.ts` (new)

**Context:** Fixtures for a division with home/away team slug+name, the result score (left join `results`, null when not played), and whether a match card exists (left join `match_cards`). Self-join on `teams` via `aliasedTable`. This `FixtureRow` type is reused by `getTeam` (Task 4).

- [ ] **Step 1: Write the failing test**

Create `packages/data/tests/fixtures-by-division.test.ts`:

```ts
import { afterAll, beforeAll, beforeEach, describe, it, expect } from 'vitest';
import { sql } from 'drizzle-orm';
import { startDb, stopDb, getDb } from './setup.js';
import { schema } from '@ctl/db';
import { listFixturesByDivision } from '../src/fixtures.js';

describe('listFixturesByDivision', () => {
  beforeAll(async () => { await startDb(); }, 120_000);
  afterAll(async () => { await stopDb(); });
  beforeEach(async () => {
    await getDb().execute(
      sql`TRUNCATE seasons, divisions, clubs, teams, fixtures, results, match_cards RESTART IDENTITY CASCADE`,
    );
  });

  const seed = async () => {
    const db = getDb();
    const [season] = await db.insert(schema.seasons).values({ slug: 's', name: 'S', current: true }).returning();
    const [division] = await db.insert(schema.divisions).values({
      slug: 'mens-1', name: 'Mens Division 1', group: 'Mens', seasonId: season!.id, upstreamModeId: 8,
    }).returning();
    const [club] = await db.insert(schema.clubs).values({ slug: 'c', canonicalName: 'C' }).returning();
    const [home, away] = await db.insert(schema.teams).values([
      { slug: 'home-a', name: 'Home A', clubId: club!.id, divisionId: division!.id },
      { slug: 'away-a', name: 'Away A', clubId: club!.id, divisionId: division!.id },
    ]).returning();
    return { db, division: division!, home: home!, away: away! };
  };

  it('returns empty for a division with no fixtures', async () => {
    const { db, division } = await seed();
    expect(await listFixturesByDivision(db, division.id)).toEqual([]);
  });

  it('returns fixtures with team names, score, and hasCard flag', async () => {
    const { db, division, home, away } = await seed();
    // A played fixture with a result + a card, and a scheduled one with neither.
    const [played] = await db.insert(schema.fixtures).values({
      upstreamId: 100, date: '2026-04-23', homeTeamId: home.id, awayTeamId: away.id,
      divisionId: division.id, status: 'completed',
    }).returning();
    await db.insert(schema.results).values({ fixtureId: played!.id, homeScore: '5.5', awayScore: '3.5' });
    await db.insert(schema.matchCards).values({ fixtureId: played!.id });
    await db.insert(schema.fixtures).values({
      upstreamId: 101, date: '2026-05-01', homeTeamId: away.id, awayTeamId: home.id,
      divisionId: division.id, status: 'scheduled',
    });

    const rows = await listFixturesByDivision(db, division.id);
    expect(rows).toHaveLength(2);

    // ordered by date — played (Apr 23) first
    expect(rows[0]).toEqual({
      id: played!.id,
      date: '2026-04-23',
      homeTeam: { slug: 'home-a', name: 'Home A' },
      awayTeam: { slug: 'away-a', name: 'Away A' },
      status: 'completed',
      score: { home: '5.5', away: '3.5' },   // half-point preserved as string
      hasCard: true,
    });
    expect(rows[1]?.score).toBeUndefined();
    expect(rows[1]?.hasCard).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/data/tests/fixtures-by-division.test.ts`
Expected: FAIL (`listFixturesByDivision` not exported).

- [ ] **Step 3: Implement the getter**

Append to `packages/data/src/fixtures.ts`. First extend the imports at the top of the file — the current line is `import { and, eq, gte } from 'drizzle-orm';`. Replace it with:

```ts
import { aliasedTable, and, eq, gte } from 'drizzle-orm';
```

Then append:

```ts
export type FixtureRow = {
  id: number;
  date: string;
  homeTeam: { slug: string; name: string };
  awayTeam: { slug: string; name: string };
  status: string;
  score?: { home: string; away: string };
  hasCard: boolean;
};

const mapFixtureRow = (r: {
  id: number; date: string; status: string;
  homeSlug: string; homeName: string; awaySlug: string; awayName: string;
  homeScore: string | null; awayScore: string | null; cardId: number | null;
}): FixtureRow => ({
  id: r.id,
  date: r.date,
  homeTeam: { slug: r.homeSlug, name: r.homeName },
  awayTeam: { slug: r.awaySlug, name: r.awayName },
  status: r.status,
  ...(r.homeScore != null && r.awayScore != null ? { score: { home: r.homeScore, away: r.awayScore } } : {}),
  hasCard: r.cardId != null,
});

export const listFixturesByDivision = async (db: Database, divisionId: number): Promise<FixtureRow[]> => {
  const home = aliasedTable(schema.teams, 'home_team');
  const away = aliasedTable(schema.teams, 'away_team');
  const rows = await db
    .select({
      id: schema.fixtures.id,
      date: schema.fixtures.date,
      status: schema.fixtures.status,
      homeSlug: home.slug, homeName: home.name,
      awaySlug: away.slug, awayName: away.name,
      homeScore: schema.results.homeScore,
      awayScore: schema.results.awayScore,
      cardId: schema.matchCards.id,
    })
    .from(schema.fixtures)
    .innerJoin(home, eq(home.id, schema.fixtures.homeTeamId))
    .innerJoin(away, eq(away.id, schema.fixtures.awayTeamId))
    .leftJoin(schema.results, eq(schema.results.fixtureId, schema.fixtures.id))
    .leftJoin(schema.matchCards, eq(schema.matchCards.fixtureId, schema.fixtures.id))
    .where(eq(schema.fixtures.divisionId, divisionId))
    .orderBy(schema.fixtures.date);
  return rows.map(mapFixtureRow);
};
```

(`mapFixtureRow` is a module-private helper. `getTeam` in Task 4 needs the same `FixtureRow` shape but a different `WHERE` (home-or-away rather than by division), so it inlines an equivalent query + mapping — a small, deliberate duplication rather than threading a shared query builder. Only the exported `FixtureRow` type is shared across files.)

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run packages/data/tests/fixtures-by-division.test.ts`
Expected: 2 passed.

- [ ] **Step 5: Commit**

```bash
git add packages/data/src/fixtures.ts packages/data/tests/fixtures-by-division.test.ts
git commit -m "feat(data): listFixturesByDivision with score + hasCard"
```

---

### Task 2: `getMatchCard`

**Files:**
- Create: `packages/data/src/match-cards.ts`
- Modify: `packages/data/src/index.ts`
- Test: `packages/data/tests/match-cards.test.ts` (new)

**Context:** One fixture's full match card — fixture meta (division, teams, result score) + rubbers with resolved player names + per-set scores. `innerJoin matchCards` means a fixture without a card returns `null`. Player-id arrays are resolved to names with ONE `players` lookup (collect all ids, `inArray`, map in memory). Set scores are integers.

- [ ] **Step 1: Write the failing test**

Create `packages/data/tests/match-cards.test.ts`:

```ts
import { afterAll, beforeAll, beforeEach, describe, it, expect } from 'vitest';
import { sql } from 'drizzle-orm';
import { startDb, stopDb, getDb } from './setup.js';
import { schema } from '@ctl/db';
import { getMatchCard } from '../src/match-cards.js';

describe('getMatchCard', () => {
  beforeAll(async () => { await startDb(); }, 120_000);
  afterAll(async () => { await stopDb(); });
  beforeEach(async () => {
    await getDb().execute(
      sql`TRUNCATE seasons, divisions, clubs, teams, players, fixtures, results, match_cards, rubbers, set_scores RESTART IDENTITY CASCADE`,
    );
  });

  it('returns null when the fixture has no card', async () => {
    const db = getDb();
    expect(await getMatchCard(db, 999)).toBeNull();
  });

  it('returns fixture meta, rubbers with player names, and set scores', async () => {
    const db = getDb();
    const [season] = await db.insert(schema.seasons).values({ slug: 's', name: 'S', current: true }).returning();
    const [division] = await db.insert(schema.divisions).values({
      slug: 'mens-1', name: 'Mens Division 1', group: 'Mens', seasonId: season!.id, upstreamModeId: 8,
    }).returning();
    const [club] = await db.insert(schema.clubs).values({ slug: 'c', canonicalName: 'C' }).returning();
    const [home, away] = await db.insert(schema.teams).values([
      { slug: 'home-a', name: 'Home A', clubId: club!.id, divisionId: division!.id },
      { slug: 'away-a', name: 'Away A', clubId: club!.id, divisionId: division!.id },
    ]).returning();
    const [p1, p2, p3, p4] = await db.insert(schema.players).values([
      { slug: 'p1', name: 'Player One', clubId: club!.id },
      { slug: 'p2', name: 'Player Two', clubId: club!.id },
      { slug: 'p3', name: 'Player Three', clubId: club!.id },
      { slug: 'p4', name: 'Player Four', clubId: club!.id },
    ]).returning();
    const [fx] = await db.insert(schema.fixtures).values({
      upstreamId: 200, date: '2026-04-23', homeTeamId: home!.id, awayTeamId: away!.id,
      divisionId: division!.id, status: 'completed',
    }).returning();
    await db.insert(schema.results).values({ fixtureId: fx!.id, homeScore: '6', awayScore: '3' });
    const [card] = await db.insert(schema.matchCards).values({ fixtureId: fx!.id }).returning();
    const [rubber] = await db.insert(schema.rubbers).values({
      matchCardId: card!.id, orderInCard: 1,
      homePlayerIds: [p1!.id, p2!.id], awayPlayerIds: [p3!.id, p4!.id],
    }).returning();
    await db.insert(schema.setScores).values([
      { rubberId: rubber!.id, orderInRubber: 1, homeScore: 6, awayScore: 4 },
      { rubberId: rubber!.id, orderInRubber: 2, homeScore: 6, awayScore: 2 },
    ]);

    const card_ = await getMatchCard(db, fx!.id);
    expect(card_).not.toBeNull();
    expect(card_!.fixture).toEqual({
      id: fx!.id,
      date: '2026-04-23',
      division: { slug: 'mens-1', name: 'Mens Division 1' },
      homeTeam: { slug: 'home-a', name: 'Home A' },
      awayTeam: { slug: 'away-a', name: 'Away A' },
      score: { home: '6', away: '3' },
    });
    expect(card_!.rubbers).toHaveLength(1);
    expect(card_!.rubbers[0]).toEqual({
      orderInCard: 1,
      homePlayers: [{ slug: 'p1', name: 'Player One' }, { slug: 'p2', name: 'Player Two' }],
      awayPlayers: [{ slug: 'p3', name: 'Player Three' }, { slug: 'p4', name: 'Player Four' }],
      sets: [{ home: 6, away: 4 }, { home: 6, away: 2 }],
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/data/tests/match-cards.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement the getter**

Create `packages/data/src/match-cards.ts`:

```ts
import { aliasedTable, eq, inArray } from 'drizzle-orm';
import type { Database } from '@ctl/db';
import { schema } from '@ctl/db';

export type PlayerRef = { slug: string; name: string };

export type MatchCardRubber = {
  orderInCard: number;
  homePlayers: PlayerRef[];
  awayPlayers: PlayerRef[];
  sets: { home: number; away: number }[];
};

export type MatchCardDetail = {
  fixture: {
    id: number;
    date: string;
    division: { slug: string; name: string };
    homeTeam: { slug: string; name: string };
    awayTeam: { slug: string; name: string };
    score?: { home: string; away: string };
  };
  rubbers: MatchCardRubber[];
};

export const getMatchCard = async (db: Database, fixtureId: number): Promise<MatchCardDetail | null> => {
  const home = aliasedTable(schema.teams, 'home_team');
  const away = aliasedTable(schema.teams, 'away_team');
  const [fx] = await db
    .select({
      id: schema.fixtures.id,
      date: schema.fixtures.date,
      divSlug: schema.divisions.slug, divName: schema.divisions.name,
      homeSlug: home.slug, homeName: home.name,
      awaySlug: away.slug, awayName: away.name,
      homeScore: schema.results.homeScore,
      awayScore: schema.results.awayScore,
      cardId: schema.matchCards.id,
    })
    .from(schema.fixtures)
    .innerJoin(schema.divisions, eq(schema.divisions.id, schema.fixtures.divisionId))
    .innerJoin(home, eq(home.id, schema.fixtures.homeTeamId))
    .innerJoin(away, eq(away.id, schema.fixtures.awayTeamId))
    .leftJoin(schema.results, eq(schema.results.fixtureId, schema.fixtures.id))
    .innerJoin(schema.matchCards, eq(schema.matchCards.fixtureId, schema.fixtures.id))
    .where(eq(schema.fixtures.id, fixtureId))
    .limit(1);
  if (!fx) return null;

  const rubberRows = await db
    .select()
    .from(schema.rubbers)
    .where(eq(schema.rubbers.matchCardId, fx.cardId))
    .orderBy(schema.rubbers.orderInCard);

  // Resolve all player ids across the card in one query.
  const allIds = [...new Set(rubberRows.flatMap((r) => [...r.homePlayerIds, ...r.awayPlayerIds]))];
  const playerRows = allIds.length
    ? await db
        .select({ id: schema.players.id, slug: schema.players.slug, name: schema.players.name })
        .from(schema.players)
        .where(inArray(schema.players.id, allIds))
    : [];
  const byId = new Map(playerRows.map((p) => [p.id, { slug: p.slug, name: p.name }]));
  const resolve = (ids: number[]): PlayerRef[] =>
    ids.map((id) => byId.get(id)).filter((p): p is PlayerRef => p != null);

  // Set scores for all rubbers in one query; group preserving per-rubber order.
  const rubberIds = rubberRows.map((r) => r.id);
  const setRows = rubberIds.length
    ? await db
        .select()
        .from(schema.setScores)
        .where(inArray(schema.setScores.rubberId, rubberIds))
        .orderBy(schema.setScores.orderInRubber)
    : [];
  const setsByRubber = new Map<number, { home: number; away: number }[]>();
  for (const s of setRows) {
    const arr = setsByRubber.get(s.rubberId) ?? [];
    arr.push({ home: s.homeScore, away: s.awayScore });
    setsByRubber.set(s.rubberId, arr);
  }

  return {
    fixture: {
      id: fx.id,
      date: fx.date,
      division: { slug: fx.divSlug, name: fx.divName },
      homeTeam: { slug: fx.homeSlug, name: fx.homeName },
      awayTeam: { slug: fx.awaySlug, name: fx.awayName },
      ...(fx.homeScore != null && fx.awayScore != null ? { score: { home: fx.homeScore, away: fx.awayScore } } : {}),
    },
    rubbers: rubberRows.map((r) => ({
      orderInCard: r.orderInCard,
      homePlayers: resolve(r.homePlayerIds),
      awayPlayers: resolve(r.awayPlayerIds),
      sets: setsByRubber.get(r.id) ?? [],
    })),
  };
};
```

- [ ] **Step 4: Export from the barrel**

Modify `packages/data/src/index.ts` — append:

```ts
export * from './match-cards.js';
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm vitest run packages/data/tests/match-cards.test.ts`
Expected: 2 passed.

- [ ] **Step 6: Commit**

```bash
git add packages/data/src/match-cards.ts packages/data/src/index.ts packages/data/tests/match-cards.test.ts
git commit -m "feat(data): getMatchCard with resolved players and set scores"
```

---

### Task 3: `getClubDetail`

**Files:**
- Modify: `packages/data/src/clubs.ts`
- Test: `packages/data/tests/club-detail.test.ts` (new)

**Context:** The rich club page getter — club row with the location columns + the club's teams (joined to divisions for names). The existing `getClub`/`ClubSummary`/`listClubs` stay untouched. `lat`/`lng` are numeric → strings.

- [ ] **Step 1: Write the failing test**

Create `packages/data/tests/club-detail.test.ts`:

```ts
import { afterAll, beforeAll, beforeEach, describe, it, expect } from 'vitest';
import { sql } from 'drizzle-orm';
import { startDb, stopDb, getDb } from './setup.js';
import { schema } from '@ctl/db';
import { getClubDetail } from '../src/clubs.js';

describe('getClubDetail', () => {
  beforeAll(async () => { await startDb(); }, 120_000);
  afterAll(async () => { await stopDb(); });
  beforeEach(async () => {
    await getDb().execute(
      sql`TRUNCATE seasons, divisions, clubs, teams RESTART IDENTITY CASCADE`,
    );
  });

  it('returns null for unknown slug', async () => {
    expect(await getClubDetail(getDb(), 'nope')).toBeNull();
  });

  it('returns club with location and its teams', async () => {
    const db = getDb();
    const [season] = await db.insert(schema.seasons).values({ slug: 's', name: 'S', current: true }).returning();
    const [division] = await db.insert(schema.divisions).values({
      slug: 'mens-1', name: 'Mens Division 1', group: 'Mens', seasonId: season!.id, upstreamModeId: 8,
    }).returning();
    const [club] = await db.insert(schema.clubs).values({
      slug: 'cragg-vale', canonicalName: 'Cragg Vale',
      address: 'Hinchcliffe Arms, Cragg Vale', postcode: 'HX7 5TA', lat: '53.7', lng: '-2.0',
    }).returning();
    await db.insert(schema.teams).values([
      { slug: 'cragg-vale-a', name: 'Cragg Vale A', clubId: club!.id, divisionId: division!.id },
      { slug: 'cragg-vale-b', name: 'Cragg Vale B', clubId: club!.id, divisionId: division!.id },
    ]);

    const result = await getClubDetail(db, 'cragg-vale');
    expect(result).toEqual({
      slug: 'cragg-vale',
      name: 'Cragg Vale',
      address: 'Hinchcliffe Arms, Cragg Vale',
      postcode: 'HX7 5TA',
      lat: '53.7',
      lng: '-2.0',
      teams: [
        { slug: 'cragg-vale-a', name: 'Cragg Vale A', division: { slug: 'mens-1', name: 'Mens Division 1' } },
        { slug: 'cragg-vale-b', name: 'Cragg Vale B', division: { slug: 'mens-1', name: 'Mens Division 1' } },
      ],
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/data/tests/club-detail.test.ts`
Expected: FAIL (`getClubDetail` not exported).

- [ ] **Step 3: Implement the getter**

Append to `packages/data/src/clubs.ts`:

```ts
export type ClubDetail = {
  slug: string;
  name: string;
  address: string | null;
  postcode: string | null;
  lat: string | null;
  lng: string | null;
  teams: { slug: string; name: string; division: { slug: string; name: string } }[];
};

export const getClubDetail = async (db: Database, slug: string): Promise<ClubDetail | null> => {
  const [club] = await db
    .select({
      id: schema.clubs.id,
      slug: schema.clubs.slug,
      name: schema.clubs.canonicalName,
      address: schema.clubs.address,
      postcode: schema.clubs.postcode,
      lat: schema.clubs.lat,
      lng: schema.clubs.lng,
    })
    .from(schema.clubs)
    .where(eq(schema.clubs.slug, slug))
    .limit(1);
  if (!club) return null;

  const teams = await db
    .select({
      slug: schema.teams.slug,
      name: schema.teams.name,
      divSlug: schema.divisions.slug,
      divName: schema.divisions.name,
    })
    .from(schema.teams)
    .innerJoin(schema.divisions, eq(schema.divisions.id, schema.teams.divisionId))
    .where(eq(schema.teams.clubId, club.id))
    .orderBy(schema.teams.name);

  return {
    slug: club.slug,
    name: club.name,
    address: club.address,
    postcode: club.postcode,
    lat: club.lat,
    lng: club.lng,
    teams: teams.map((t) => ({ slug: t.slug, name: t.name, division: { slug: t.divSlug, name: t.divName } })),
  };
};
```

(`eq`, `Database`, and `schema` are already imported at the top of `clubs.ts` — verify before adding; if `eq` is missing, add it to the existing `drizzle-orm` import.)

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run packages/data/tests/club-detail.test.ts`
Expected: 2 passed.

- [ ] **Step 5: Commit**

```bash
git add packages/data/src/clubs.ts packages/data/tests/club-detail.test.ts
git commit -m "feat(data): getClubDetail with location and teams"
```

---

### Task 4: `getTeam`

**Files:**
- Create: `packages/data/src/teams.ts`
- Modify: `packages/data/src/index.ts`
- Test: `packages/data/tests/team-detail.test.ts` (new)

**Context:** Team page getter — team + club + division, its `team_contacts`, its fixtures (home OR away, same `FixtureRow` shape as Task 1), and a best-effort squad: the distinct players appearing in this team's match-card rubbers (home side when the team was home, away side when away). The squad is an approximation — there is no clean roster in the schema.

- [ ] **Step 1: Write the failing test**

Create `packages/data/tests/team-detail.test.ts`:

```ts
import { afterAll, beforeAll, beforeEach, describe, it, expect } from 'vitest';
import { sql } from 'drizzle-orm';
import { startDb, stopDb, getDb } from './setup.js';
import { schema } from '@ctl/db';
import { getTeam } from '../src/teams.js';

describe('getTeam', () => {
  beforeAll(async () => { await startDb(); }, 120_000);
  afterAll(async () => { await stopDb(); });
  beforeEach(async () => {
    await getDb().execute(
      sql`TRUNCATE seasons, divisions, clubs, teams, players, fixtures, results, match_cards, rubbers, team_contacts RESTART IDENTITY CASCADE`,
    );
  });

  it('returns null for unknown slug', async () => {
    expect(await getTeam(getDb(), 'nope')).toBeNull();
  });

  it('returns team meta, contacts, fixtures, and best-effort squad', async () => {
    const db = getDb();
    const [season] = await db.insert(schema.seasons).values({ slug: 's', name: 'S', current: true }).returning();
    const [division] = await db.insert(schema.divisions).values({
      slug: 'mens-1', name: 'Mens Division 1', group: 'Mens', seasonId: season!.id, upstreamModeId: 8,
    }).returning();
    const [club] = await db.insert(schema.clubs).values({ slug: 'cragg-vale', canonicalName: 'Cragg Vale' }).returning();
    const [team, opp] = await db.insert(schema.teams).values([
      { slug: 'cragg-vale-a', name: 'Cragg Vale A', clubId: club!.id, divisionId: division!.id },
      { slug: 'opponent-a', name: 'Opponent A', clubId: club!.id, divisionId: division!.id },
    ]).returning();
    const [p1, p2] = await db.insert(schema.players).values([
      { slug: 'p1', name: 'Player One', clubId: club!.id },
      { slug: 'p2', name: 'Player Two', clubId: club!.id },
    ]).returning();
    await db.insert(schema.teamContacts).values({
      teamId: team!.id, name: 'Captain Cathy', role: 'Captain', phone: '01234', email: null,
    });
    // Team plays at home, has a card; its players are on the HOME side.
    const [fx] = await db.insert(schema.fixtures).values({
      upstreamId: 300, date: '2026-04-23', homeTeamId: team!.id, awayTeamId: opp!.id,
      divisionId: division!.id, status: 'completed',
    }).returning();
    await db.insert(schema.results).values({ fixtureId: fx!.id, homeScore: '6', awayScore: '3' });
    const [card] = await db.insert(schema.matchCards).values({ fixtureId: fx!.id }).returning();
    await db.insert(schema.rubbers).values({
      matchCardId: card!.id, orderInCard: 1, homePlayerIds: [p1!.id, p2!.id], awayPlayerIds: [],
    });

    const result = await getTeam(db, 'cragg-vale-a');
    expect(result).not.toBeNull();
    expect(result!.slug).toBe('cragg-vale-a');
    expect(result!.club).toEqual({ slug: 'cragg-vale', name: 'Cragg Vale' });
    expect(result!.division).toEqual({ slug: 'mens-1', name: 'Mens Division 1' });
    expect(result!.contacts).toEqual([
      { name: 'Captain Cathy', role: 'Captain', phone: '01234', email: null },
    ]);
    expect(result!.fixtures).toHaveLength(1);
    expect(result!.fixtures[0]?.score).toEqual({ home: '6', away: '3' });
    expect(result!.squad.map((p) => p.slug).sort()).toEqual(['p1', 'p2']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/data/tests/team-detail.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement the getter**

Create `packages/data/src/teams.ts`:

```ts
import { aliasedTable, eq, inArray, or, sql } from 'drizzle-orm';
import type { Database } from '@ctl/db';
import { schema } from '@ctl/db';
import type { FixtureRow } from './fixtures.js';
import type { PlayerRef } from './match-cards.js';

export type TeamContact = {
  name: string;
  role: string | null;
  phone: string | null;
  email: string | null;
};

export type TeamDetail = {
  slug: string;
  name: string;
  club: { slug: string; name: string };
  division: { slug: string; name: string };
  contacts: TeamContact[];
  fixtures: FixtureRow[];
  squad: PlayerRef[];
};

export const getTeam = async (db: Database, slug: string): Promise<TeamDetail | null> => {
  const [team] = await db
    .select({
      id: schema.teams.id,
      slug: schema.teams.slug,
      name: schema.teams.name,
      clubSlug: schema.clubs.slug,
      clubName: schema.clubs.canonicalName,
      divSlug: schema.divisions.slug,
      divName: schema.divisions.name,
    })
    .from(schema.teams)
    .innerJoin(schema.clubs, eq(schema.clubs.id, schema.teams.clubId))
    .innerJoin(schema.divisions, eq(schema.divisions.id, schema.teams.divisionId))
    .where(eq(schema.teams.slug, slug))
    .limit(1);
  if (!team) return null;

  const contacts: TeamContact[] = await db
    .select({
      name: schema.teamContacts.name,
      role: schema.teamContacts.role,
      phone: schema.teamContacts.phone,
      email: schema.teamContacts.email,
    })
    .from(schema.teamContacts)
    .where(eq(schema.teamContacts.teamId, team.id));

  // Fixtures where this team is home OR away — same shape as listFixturesByDivision.
  const home = aliasedTable(schema.teams, 'home_team');
  const away = aliasedTable(schema.teams, 'away_team');
  const fxRows = await db
    .select({
      id: schema.fixtures.id,
      date: schema.fixtures.date,
      status: schema.fixtures.status,
      homeSlug: home.slug, homeName: home.name,
      awaySlug: away.slug, awayName: away.name,
      homeScore: schema.results.homeScore,
      awayScore: schema.results.awayScore,
      cardId: schema.matchCards.id,
    })
    .from(schema.fixtures)
    .innerJoin(home, eq(home.id, schema.fixtures.homeTeamId))
    .innerJoin(away, eq(away.id, schema.fixtures.awayTeamId))
    .leftJoin(schema.results, eq(schema.results.fixtureId, schema.fixtures.id))
    .leftJoin(schema.matchCards, eq(schema.matchCards.fixtureId, schema.fixtures.id))
    .where(or(eq(schema.fixtures.homeTeamId, team.id), eq(schema.fixtures.awayTeamId, team.id)))
    .orderBy(schema.fixtures.date);
  const fixtures: FixtureRow[] = fxRows.map((r) => ({
    id: r.id,
    date: r.date,
    homeTeam: { slug: r.homeSlug, name: r.homeName },
    awayTeam: { slug: r.awaySlug, name: r.awayName },
    status: r.status,
    ...(r.homeScore != null && r.awayScore != null ? { score: { home: r.homeScore, away: r.awayScore } } : {}),
    hasCard: r.cardId != null,
  }));

  // Best-effort squad: players in this team's match-card rubbers, home side when
  // the team was home, away side when away.
  const cards = await db
    .select({
      cardId: schema.matchCards.id,
      isHome: sql<boolean>`${schema.fixtures.homeTeamId} = ${team.id}`,
    })
    .from(schema.matchCards)
    .innerJoin(schema.fixtures, eq(schema.fixtures.id, schema.matchCards.fixtureId))
    .where(or(eq(schema.fixtures.homeTeamId, team.id), eq(schema.fixtures.awayTeamId, team.id)));
  const isHomeByCard = new Map(cards.map((c) => [c.cardId, c.isHome]));
  const cardIds = cards.map((c) => c.cardId);
  const rubberRows = cardIds.length
    ? await db.select().from(schema.rubbers).where(inArray(schema.rubbers.matchCardId, cardIds))
    : [];
  const squadIds = new Set<number>();
  for (const r of rubberRows) {
    const ids = isHomeByCard.get(r.matchCardId) ? r.homePlayerIds : r.awayPlayerIds;
    for (const id of ids) squadIds.add(id);
  }
  const squad: PlayerRef[] = squadIds.size
    ? await db
        .select({ slug: schema.players.slug, name: schema.players.name })
        .from(schema.players)
        .where(inArray(schema.players.id, [...squadIds]))
        .orderBy(schema.players.name)
    : [];

  return {
    slug: team.slug,
    name: team.name,
    club: { slug: team.clubSlug, name: team.clubName },
    division: { slug: team.divSlug, name: team.divName },
    contacts,
    fixtures,
    squad,
  };
};
```

- [ ] **Step 4: Export from the barrel**

Modify `packages/data/src/index.ts` — append:

```ts
export * from './teams.js';
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm vitest run packages/data/tests/team-detail.test.ts`
Expected: 2 passed.

- [ ] **Step 6: Commit**

```bash
git add packages/data/src/teams.ts packages/data/src/index.ts packages/data/tests/team-detail.test.ts
git commit -m "feat(data): getTeam with contacts, fixtures, best-effort squad"
```

---

### Task 5: `getPlayerProfile`

**Files:**
- Modify: `packages/data/src/players.ts`
- Test: `packages/data/tests/player-profile.test.ts` (new)

**Context:** Player page getter — player + club, rankings across divisions, and match history (rubbers the player appeared in, with partners, opponents, set scores). Array-membership uses `arrayContains(column, [playerId])` (Postgres `@>`). The heaviest getter; resolves all partner/opponent names in one `players` lookup.

- [ ] **Step 1: Write the failing test**

Create `packages/data/tests/player-profile.test.ts`:

```ts
import { afterAll, beforeAll, beforeEach, describe, it, expect } from 'vitest';
import { sql } from 'drizzle-orm';
import { startDb, stopDb, getDb } from './setup.js';
import { schema } from '@ctl/db';
import { getPlayerProfile } from '../src/players.js';

describe('getPlayerProfile', () => {
  beforeAll(async () => { await startDb(); }, 120_000);
  afterAll(async () => { await stopDb(); });
  beforeEach(async () => {
    await getDb().execute(
      sql`TRUNCATE seasons, divisions, clubs, teams, players, fixtures, match_cards, rubbers, set_scores, rankings RESTART IDENTITY CASCADE`,
    );
  });

  it('returns null for unknown slug', async () => {
    expect(await getPlayerProfile(getDb(), 'nope')).toBeNull();
  });

  it('returns player, rankings, and match history', async () => {
    const db = getDb();
    const [season] = await db.insert(schema.seasons).values({ slug: 's', name: 'S', current: true }).returning();
    const [division] = await db.insert(schema.divisions).values({
      slug: 'mens-1', name: 'Mens Division 1', group: 'Mens', seasonId: season!.id, upstreamModeId: 8,
    }).returning();
    const [club] = await db.insert(schema.clubs).values({ slug: 'c', canonicalName: 'C' }).returning();
    const [home, away] = await db.insert(schema.teams).values([
      { slug: 'home-a', name: 'Home A', clubId: club!.id, divisionId: division!.id },
      { slug: 'away-a', name: 'Away A', clubId: club!.id, divisionId: division!.id },
    ]).returning();
    const [me, partner, opp1, opp2] = await db.insert(schema.players).values([
      { slug: 'me', name: 'Me Player', clubId: club!.id },
      { slug: 'partner', name: 'Partner Player', clubId: club!.id },
      { slug: 'opp1', name: 'Opp One', clubId: club!.id },
      { slug: 'opp2', name: 'Opp Two', clubId: club!.id },
    ]).returning();
    await db.insert(schema.rankings).values({
      playerId: me!.id, divisionId: division!.id, rank: 3,
      rubbersWon: '10.5', rubbersPlayed: '14', gamesWon: 100, gamesPlayed: 150, rankingScore: '480.5', movement: 'up',
    });
    const [fx] = await db.insert(schema.fixtures).values({
      upstreamId: 400, date: '2026-04-23', homeTeamId: home!.id, awayTeamId: away!.id,
      divisionId: division!.id, status: 'completed',
    }).returning();
    const [card] = await db.insert(schema.matchCards).values({ fixtureId: fx!.id }).returning();
    const [rubber] = await db.insert(schema.rubbers).values({
      matchCardId: card!.id, orderInCard: 1,
      homePlayerIds: [me!.id, partner!.id], awayPlayerIds: [opp1!.id, opp2!.id],
    }).returning();
    await db.insert(schema.setScores).values([
      { rubberId: rubber!.id, orderInRubber: 1, homeScore: 6, awayScore: 4 },
    ]);

    const profile = await getPlayerProfile(db, 'me');
    expect(profile).not.toBeNull();
    expect(profile!.player).toEqual({ slug: 'me', name: 'Me Player' });
    expect(profile!.club).toEqual({ slug: 'c', name: 'C' });
    expect(profile!.rankings).toEqual([
      { division: { slug: 'mens-1', name: 'Mens Division 1' }, rank: 3, rankingScore: '480.5', rubbersWon: '10.5', rubbersPlayed: '14' },
    ]);
    expect(profile!.matchHistory).toHaveLength(1);
    const m = profile!.matchHistory[0]!;
    expect(m.fixtureId).toBe(fx!.id);
    expect(m.division).toEqual({ slug: 'mens-1', name: 'Mens Division 1' });
    expect(m.partners.map((p) => p.slug)).toEqual(['partner']);
    expect(m.opponents.map((p) => p.slug).sort()).toEqual(['opp1', 'opp2']);
    expect(m.sets).toEqual([{ home: 6, away: 4 }]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/data/tests/player-profile.test.ts`
Expected: FAIL (`getPlayerProfile` not exported).

- [ ] **Step 3: Implement the getter**

In `packages/data/src/players.ts`, replace the import line `import { eq } from 'drizzle-orm';` with:

```ts
import { arrayContains, eq, inArray, or } from 'drizzle-orm';
```

Add an import for `PlayerRef` at the top (after the existing imports):

```ts
import type { PlayerRef } from './match-cards.js';
```

Then append:

```ts
export type PlayerRankingRow = {
  division: { slug: string; name: string };
  rank: number;
  rankingScore: string;
  rubbersWon: string;
  rubbersPlayed: string;
};

export type MatchHistoryRow = {
  fixtureId: number;
  date: string;
  division: { slug: string; name: string };
  partners: PlayerRef[];
  opponents: PlayerRef[];
  sets: { home: number; away: number }[];
};

export type PlayerProfile = {
  player: { slug: string; name: string };
  club: { slug: string; name: string };
  rankings: PlayerRankingRow[];
  matchHistory: MatchHistoryRow[];
};

export const getPlayerProfile = async (db: Database, slug: string): Promise<PlayerProfile | null> => {
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

  const rankingRows = await db
    .select({
      divSlug: schema.divisions.slug,
      divName: schema.divisions.name,
      rank: schema.rankings.rank,
      rankingScore: schema.rankings.rankingScore,
      rubbersWon: schema.rankings.rubbersWon,
      rubbersPlayed: schema.rankings.rubbersPlayed,
    })
    .from(schema.rankings)
    .innerJoin(schema.divisions, eq(schema.divisions.id, schema.rankings.divisionId))
    .where(eq(schema.rankings.playerId, player.id))
    .orderBy(schema.divisions.name);
  const rankings: PlayerRankingRow[] = rankingRows.map((r) => ({
    division: { slug: r.divSlug, name: r.divName },
    rank: r.rank,
    rankingScore: r.rankingScore,
    rubbersWon: r.rubbersWon,
    rubbersPlayed: r.rubbersPlayed,
  }));

  // Rubbers the player appeared in (either side).
  const rubberRows = await db
    .select({
      rubberId: schema.rubbers.id,
      homeIds: schema.rubbers.homePlayerIds,
      awayIds: schema.rubbers.awayPlayerIds,
      fixtureId: schema.fixtures.id,
      date: schema.fixtures.date,
      divSlug: schema.divisions.slug,
      divName: schema.divisions.name,
    })
    .from(schema.rubbers)
    .innerJoin(schema.matchCards, eq(schema.matchCards.id, schema.rubbers.matchCardId))
    .innerJoin(schema.fixtures, eq(schema.fixtures.id, schema.matchCards.fixtureId))
    .innerJoin(schema.divisions, eq(schema.divisions.id, schema.fixtures.divisionId))
    .where(or(arrayContains(schema.rubbers.homePlayerIds, [player.id]), arrayContains(schema.rubbers.awayPlayerIds, [player.id])))
    .orderBy(schema.fixtures.date);

  // Resolve all partner/opponent names in one query.
  const otherIds = [
    ...new Set(
      rubberRows.flatMap((r) => [...r.homeIds, ...r.awayIds]).filter((id) => id !== player.id),
    ),
  ];
  const otherRows = otherIds.length
    ? await db
        .select({ id: schema.players.id, slug: schema.players.slug, name: schema.players.name })
        .from(schema.players)
        .where(inArray(schema.players.id, otherIds))
    : [];
  const byId = new Map(otherRows.map((p) => [p.id, { slug: p.slug, name: p.name }]));
  const refs = (ids: number[]): PlayerRef[] =>
    ids.map((id) => byId.get(id)).filter((p): p is PlayerRef => p != null);

  // Set scores for the matched rubbers, grouped per rubber in order.
  const rubberIds = rubberRows.map((r) => r.rubberId);
  const setRows = rubberIds.length
    ? await db
        .select()
        .from(schema.setScores)
        .where(inArray(schema.setScores.rubberId, rubberIds))
        .orderBy(schema.setScores.orderInRubber)
    : [];
  const setsByRubber = new Map<number, { home: number; away: number }[]>();
  for (const s of setRows) {
    const arr = setsByRubber.get(s.rubberId) ?? [];
    arr.push({ home: s.homeScore, away: s.awayScore });
    setsByRubber.set(s.rubberId, arr);
  }

  const matchHistory: MatchHistoryRow[] = rubberRows.map((r) => {
    const onHome = r.homeIds.includes(player.id);
    const sameSide = onHome ? r.homeIds : r.awayIds;
    const otherSide = onHome ? r.awayIds : r.homeIds;
    return {
      fixtureId: r.fixtureId,
      date: r.date,
      division: { slug: r.divSlug, name: r.divName },
      partners: refs(sameSide.filter((id) => id !== player.id)),
      opponents: refs(otherSide),
      sets: setsByRubber.get(r.rubberId) ?? [],
    };
  });

  return {
    player: { slug: player.slug, name: player.name },
    club: { slug: player.clubSlug, name: player.clubName },
    rankings,
    matchHistory,
  };
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run packages/data/tests/player-profile.test.ts`
Expected: 2 passed.

- [ ] **Step 5: Run the full suite**

Run: `pnpm test`
Expected: all pass (the 181 existing + 10 new getter tests).

- [ ] **Step 6: Commit**

```bash
git add packages/data/src/players.ts packages/data/tests/player-profile.test.ts
git commit -m "feat(data): getPlayerProfile with rankings and match history"
```

---

### Task 6: Push + close-out

**Files:** none (git + bd)

- [ ] **Step 1: Push**

```bash
git pull --rebase
git push
git status   # MUST show "up to date with origin"
```

- [ ] **Step 2: bd housekeeping**

This plan is Plan 1 of 3 for the web viewer. File a bd feature for the web viewer epic if one doesn't exist, and note the data getters are done. (Run `bd dolt start` first if bd reports the server unreachable.)

```bash
bd create --type=feature --priority=2 \
  --title="Web viewer — data getters (Plan 1/3) complete" \
  --description="The 5 new @ctl/data getters (listFixturesByDivision, getMatchCard, getClubDetail, getTeam, getPlayerProfile) are implemented and Testcontainers-tested. Spec: docs/superpowers/specs/2026-06-13-web-viewer-design.md. Next: Plan 2 (SvelteKit app), Plan 3 (deployment)."
```

---

## Post-implementation

After this plan: the data tier exposes everything the six pages need, fully tested. Plan 2 scaffolds `apps/web` (SvelteKit) and builds the pages consuming these getters; Plan 3 wires Docker/compose/GHCR/Tailscale.
