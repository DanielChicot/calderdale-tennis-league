# Wire divisions, teams, and fixtures Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Populate `divisions`, `teams`, `fixtures`, and `results` rows on every `pnpm scrape` run via idempotent GETs — discover divisions from the league-table `<select>` dropdown, walk `displayResults.php?modeID=<N>` per division, and persist with proper FK resolution.

**Architecture:** New parser (`parseDivisionsDropdown`) + new walk step (`divisions-discovery`) bootstraps the per-division loop after season detection. Existing per-division `fixtures-and-results` handler is wired from a no-op into a real write path that resolves team names via a new `resolveTeam` entity resolver. One schema migration adds `divisions.upstream_mode_id` so the orchestrator can build per-division `displayResults` URLs.

**Tech Stack:** TypeScript 5.6, pnpm 9 workspaces, Drizzle ORM 0.36 + drizzle-kit 0.28, postgres-js 3.4, Cheerio (named `load` import), Vitest 2.1, Testcontainers 10.13 (`GenericContainer` postgres:16-alpine).

**Spec:** `docs/superpowers/specs/2026-06-01-wire-divisions-teams-fixtures-design.md`

---

### Task 1: Parse the divisions dropdown

**Files:**
- Create: `packages/parser/src/parse-divisions-dropdown.ts`
- Create: `packages/parser/tests/parse-divisions-dropdown.test.ts`
- Modify: `packages/parser/src/index.ts` (add export)

**Context:** The league-table page contains a `<select name="season_subNav_division">` with `<option value="<modeID>">Mens Division 1</option>` etc. We parse all 9 options from the existing `fixtures/league-table-mixed-div-1.html` fixture. Cheerio is imported as named `load` for tree-shaking. `slugify` lives in `packages/parser/src/helpers.ts`.

- [ ] **Step 1: Write the failing test**

Create `packages/parser/tests/parse-divisions-dropdown.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseDivisionsDropdown } from '../src/parse-divisions-dropdown.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const loadFixture = async (name: string) =>
  readFile(resolve(__dirname, '../../../fixtures', name), 'utf8');

describe('parseDivisionsDropdown', () => {
  it('returns all 9 divisions with mode ids', async () => {
    const html = await loadFixture('league-table-mixed-div-1.html');
    const rows = parseDivisionsDropdown(html);
    expect(rows).toHaveLength(9);
    const modeIds = rows.map((r) => r.modeId).sort((a, b) => a - b);
    expect(modeIds).toEqual([3, 4, 5, 6, 8, 9, 10, 11, 14]);
  });

  it('classifies groups: 2 Mixed, 3 Ladies, 4 Mens', async () => {
    const html = await loadFixture('league-table-mixed-div-1.html');
    const rows = parseDivisionsDropdown(html);
    const counts = rows.reduce<Record<string, number>>((acc, r) => {
      acc[r.group] = (acc[r.group] ?? 0) + 1;
      return acc;
    }, {});
    expect(counts).toEqual({ Mixed: 2, Ladies: 3, Mens: 4 });
  });

  it('produces kebab-case slugs', async () => {
    const html = await loadFixture('league-table-mixed-div-1.html');
    const rows = parseDivisionsDropdown(html);
    for (const r of rows) {
      expect(r.slug).toMatch(/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/);
    }
    expect(rows.find((r) => r.modeId === 8)?.slug).toBe('mens-division-1');
  });

  it('skips options without a numeric value (placeholders)', () => {
    const html = `
      <select name="season_subNav_division">
        <option id="0">select a division...</option>
        <option value="8">Mens Division 1</option>
      </select>
    `;
    expect(parseDivisionsDropdown(html)).toHaveLength(1);
  });

  it('skips options whose text does not start with Mens/Ladies/Mixed', () => {
    const html = `
      <select name="season_subNav_division">
        <option value="99">Tournament Cup</option>
        <option value="8">Mens Division 1</option>
      </select>
    `;
    const rows = parseDivisionsDropdown(html);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.observedName).toBe('Mens Division 1');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/parser/tests/parse-divisions-dropdown.test.ts`
Expected: FAIL (module not found / `parseDivisionsDropdown` undefined).

- [ ] **Step 3: Write the parser**

Create `packages/parser/src/parse-divisions-dropdown.ts`:

```ts
import { load } from 'cheerio';
import { slugify } from './helpers.js';

export type DivisionsDropdownRow = {
  observedName: string;                    // "Mens Division 1"
  modeId: number;                          // 8
  group: 'Mens' | 'Ladies' | 'Mixed';
  slug: string;                            // "mens-division-1"
};

const GROUP_REGEX = /^(Mens|Ladies|Mixed)\b/;

export const parseDivisionsDropdown = (html: string): DivisionsDropdownRow[] => {
  const $ = load(html);
  const rows: DivisionsDropdownRow[] = [];

  $('select[name="season_subNav_division"] option').each((_, el) => {
    const valueAttr = $(el).attr('value');
    if (!valueAttr) return;
    const modeId = Number(valueAttr);
    if (!Number.isInteger(modeId) || modeId <= 0) return;

    const observedName = $(el).text().trim();
    const match = GROUP_REGEX.exec(observedName);
    if (!match) return;

    rows.push({
      observedName,
      modeId,
      group: match[1] as 'Mens' | 'Ladies' | 'Mixed',
      slug: slugify(observedName),
    });
  });

  return rows;
};
```

- [ ] **Step 4: Export from package index**

Modify `packages/parser/src/index.ts` — append:

```ts
export { parseDivisionsDropdown } from './parse-divisions-dropdown.js';
export type { DivisionsDropdownRow } from './parse-divisions-dropdown.js';
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm vitest run packages/parser/tests/parse-divisions-dropdown.test.ts`
Expected: 5 passed.

- [ ] **Step 6: Commit**

```bash
git add packages/parser/src/parse-divisions-dropdown.ts packages/parser/tests/parse-divisions-dropdown.test.ts packages/parser/src/index.ts
git commit -m "feat(parser): add parseDivisionsDropdown for league-table <select>"
```

---

### Task 2: Add `divisions.upstream_mode_id` column + migration

**Files:**
- Modify: `packages/db/src/schema/divisions.ts`
- Create: `packages/db/src/migrations/0004_*.sql` (generated by drizzle-kit)

**Context:** drizzle-kit 0.28 generates the SQL from a schema change. Cross-schema imports use `.ts` extensions (CJS resolution quirk — see existing schema files). The dev DB has zero divisions, so `NOT NULL` is safe without a backfill default.

- [ ] **Step 1: Write the failing test**

Modify `packages/db/tests/core-entities.test.ts`. Find the existing `describe('core entities round-trip', ...)` block and add this test before the closing `});`:

```ts
  it('divisions.upstream_mode_id is required and unique within a season', async () => {
    const db = getDb();
    const [season] = await db.insert(seasons).values({ slug: 's', name: 'S', current: true }).returning();
    await db.execute(
      sql`INSERT INTO divisions (slug, name, "group", season_id, upstream_mode_id)
          VALUES ('d1', 'D1', 'Mens', ${season!.id}, 8)`,
    );
    // Duplicate (upstream_mode_id, season_id) must be rejected
    await expect(
      db.execute(
        sql`INSERT INTO divisions (slug, name, "group", season_id, upstream_mode_id)
            VALUES ('d2', 'D2', 'Mens', ${season!.id}, 8)`,
      ),
    ).rejects.toThrow();
    // Same mode_id across a different season is fine
    const [s2] = await db.insert(seasons).values({ slug: 's2', name: 'S2', current: false }).returning();
    await db.execute(
      sql`INSERT INTO divisions (slug, name, "group", season_id, upstream_mode_id)
          VALUES ('d2', 'D2', 'Mens', ${s2!.id}, 8)`,
    );
  });
```

Also make sure `divisions` is imported at the top of that file. Confirm `import { seasons, clubs, ..., divisions }` includes `divisions` — add if missing.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/db/tests/core-entities.test.ts -t "upstream_mode_id"`
Expected: FAIL — column `upstream_mode_id` doesn't exist (Postgres error from the first INSERT).

- [ ] **Step 3: Modify the schema**

Replace `packages/db/src/schema/divisions.ts` with:

```ts
import { pgTable, serial, varchar, integer, pgEnum, uniqueIndex } from 'drizzle-orm/pg-core';
import { seasons } from './seasons.ts';

export const divisionGroup = pgEnum('division_group', ['Mens', 'Ladies', 'Mixed']);

export const divisions = pgTable(
  'divisions',
  {
    id: serial('id').primaryKey(),
    slug: varchar('slug', { length: 64 }).notNull(),
    name: varchar('name', { length: 128 }).notNull(),
    group: divisionGroup('group').notNull(),
    seasonId: integer('season_id').notNull().references(() => seasons.id),
    upstreamModeId: integer('upstream_mode_id').notNull(),
  },
  (t) => ({
    slugIdx: uniqueIndex('divisions_slug_season_idx').on(t.slug, t.seasonId),
    upstreamModeIdx: uniqueIndex('divisions_upstream_mode_id_season_idx').on(t.upstreamModeId, t.seasonId),
  }),
);
```

- [ ] **Step 4: Generate the migration**

Run: `pnpm --filter @ctl/db db:generate`
Expected: a new file appears under `packages/db/src/migrations/0004_<random-name>.sql` containing `ALTER TABLE "divisions" ADD COLUMN "upstream_mode_id" integer NOT NULL` and a unique index DDL. Open the generated SQL and confirm. If drizzle generates extra unrelated DDL (it shouldn't — schema only changed in one place), inspect before committing.

- [ ] **Step 5: Run the test again to verify it passes**

Run: `pnpm vitest run packages/db/tests/core-entities.test.ts -t "upstream_mode_id"`
Expected: PASS.

- [ ] **Step 6: Run the whole core-entities suite to confirm nothing else broke**

Run: `pnpm vitest run packages/db/tests/core-entities.test.ts`
Expected: all tests pass.

- [ ] **Step 7: Commit**

```bash
git add packages/db/src/schema/divisions.ts packages/db/src/migrations/0004_*.sql packages/db/src/migrations/meta packages/db/tests/core-entities.test.ts
git commit -m "feat(db): add divisions.upstream_mode_id with per-season uniqueness"
```

---

### Task 3: `stripTeamSuffix` helper

**Files:**
- Modify: `apps/scraper/src/entity-resolver.ts` (append helper)
- Modify: `apps/scraper/tests/entity-resolver.test.ts` (add tests)

**Context:** Team names like "Halifax Queens A" strip to "Halifax Queens"; "Akroydon" (no suffix) stays as-is; "Halifax Queens Reserves" doesn't match the single-letter pattern, so it also stays as-is — the caller's `resolveClub` will create a tentative `needs_review` club for it. Pure function, no DB.

- [ ] **Step 1: Write the failing tests**

Modify `apps/scraper/tests/entity-resolver.test.ts`. Replace the top-level imports line `import { resolveClub, resolvePlayer } from '../src/entity-resolver.js';` with:

```ts
import { resolveClub, resolvePlayer, stripTeamSuffix } from '../src/entity-resolver.js';
```

Add this `describe` block at the bottom of the file (after the existing `describe('entity-resolver', ...)` closes):

```ts
describe('stripTeamSuffix', () => {
  it('strips a trailing single capital letter', () => {
    expect(stripTeamSuffix('Halifax Queens A')).toBe('Halifax Queens');
    expect(stripTeamSuffix('Halifax Queens B')).toBe('Halifax Queens');
  });

  it('returns the name unchanged when no trailing letter token', () => {
    expect(stripTeamSuffix('Akroydon')).toBe('Akroydon');
    expect(stripTeamSuffix('Halifax Queens Reserves')).toBe('Halifax Queens Reserves');
  });

  it('handles single-word club + letter ("X B")', () => {
    expect(stripTeamSuffix('X B')).toBe('X');
  });

  it('ignores trailing lowercase letters (only capital is a suffix marker)', () => {
    expect(stripTeamSuffix('Akroydon a')).toBe('Akroydon a');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run apps/scraper/tests/entity-resolver.test.ts -t "stripTeamSuffix"`
Expected: FAIL (`stripTeamSuffix` not exported).

- [ ] **Step 3: Add the helper**

Append to `apps/scraper/src/entity-resolver.ts`:

```ts
const TEAM_SUFFIX_REGEX = /^(.*\S)\s+[A-Z]$/;

export const stripTeamSuffix = (observedName: string): string => {
  const match = TEAM_SUFFIX_REGEX.exec(observedName);
  return match ? match[1]! : observedName;
};
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run apps/scraper/tests/entity-resolver.test.ts -t "stripTeamSuffix"`
Expected: 4 passed.

- [ ] **Step 5: Commit**

```bash
git add apps/scraper/src/entity-resolver.ts apps/scraper/tests/entity-resolver.test.ts
git commit -m "feat(scraper): add stripTeamSuffix helper for team→club name derivation"
```

---

### Task 4: `resolveTeam` entity resolver

**Files:**
- Modify: `apps/scraper/src/entity-resolver.ts` (add `resolveTeam`)
- Modify: `apps/scraper/tests/entity-resolver.test.ts` (add integration tests)

**Context:** Mirrors the `resolveClub` / `resolvePlayer` pattern. `resolveTeam` looks up `(slug, division_id)` first, derives club name via `stripTeamSuffix`, calls existing `resolveClub` for the club FK, inserts the team row. No `team_aliases` table — the `(slug, division_id)` unique index is the natural key.

- [ ] **Step 1: Write the failing test**

Append to `apps/scraper/tests/entity-resolver.test.ts` (inside the existing `describe('entity-resolver', ...)` block, before its closing `});`):

```ts
  it('resolveTeam: known club → creates team with correct club_id', async () => {
    const db = getDb();
    const [club] = await db
      .insert(schema.clubs)
      .values({ slug: 'halifax-queens', canonicalName: 'Queens Sports Club' })
      .returning();
    await db
      .insert(schema.clubAliases)
      .values({ clubId: club!.id, observedName: 'Halifax Queens' });
    const [season] = await db.insert(schema.seasons).values({ slug: 's', name: 'S', current: true }).returning();
    const [division] = await db
      .insert(schema.divisions)
      .values({ slug: 'mens-1', name: 'Mens Division 1', group: 'Mens', seasonId: season!.id, upstreamModeId: 8 })
      .returning();

    const teamId = await resolveTeam(db, 'Halifax Queens A', division!.id);

    const teams = await db.select().from(schema.teams);
    expect(teams).toHaveLength(1);
    expect(teams[0]).toMatchObject({
      id: teamId,
      slug: 'halifax-queens-a',
      name: 'Halifax Queens A',
      clubId: club!.id,
      divisionId: division!.id,
    });
  });

  it('resolveTeam: unknown club → tentative club + team, linked', async () => {
    const db = getDb();
    const [season] = await db.insert(schema.seasons).values({ slug: 's2', name: 'S2', current: true }).returning();
    const [division] = await db
      .insert(schema.divisions)
      .values({ slug: 'mens-1', name: 'Mens Division 1', group: 'Mens', seasonId: season!.id, upstreamModeId: 8 })
      .returning();

    const teamId = await resolveTeam(db, 'Mystery Players B', division!.id);

    const clubs = await db.select().from(schema.clubs);
    expect(clubs).toHaveLength(1);
    expect(clubs[0]).toMatchObject({
      slug: 'mystery-players',
      canonicalName: 'Mystery Players',
      needsReview: true,
    });
    const teams = await db.select().from(schema.teams);
    expect(teams).toHaveLength(1);
    expect(teams[0]).toMatchObject({
      id: teamId,
      slug: 'mystery-players-b',
      name: 'Mystery Players B',
      clubId: clubs[0]!.id,
      divisionId: division!.id,
    });
  });

  it('resolveTeam: idempotent — same (name, divisionId) returns same id', async () => {
    const db = getDb();
    const [season] = await db.insert(schema.seasons).values({ slug: 's3', name: 'S3', current: true }).returning();
    const [division] = await db
      .insert(schema.divisions)
      .values({ slug: 'mens-1', name: 'Mens Division 1', group: 'Mens', seasonId: season!.id, upstreamModeId: 8 })
      .returning();

    const id1 = await resolveTeam(db, 'Akroydon A', division!.id);
    const id2 = await resolveTeam(db, 'Akroydon A', division!.id);
    expect(id1).toBe(id2);
    const teams = await db.select().from(schema.teams);
    expect(teams).toHaveLength(1);
  });
```

Add `resolveTeam` to the top-level import (replace the previous import line introduced in Task 3):

```ts
import { resolveClub, resolvePlayer, resolveTeam, stripTeamSuffix } from '../src/entity-resolver.js';
```

Update the `beforeEach` in the existing `describe('entity-resolver', ...)` block — the current `TRUNCATE clubs RESTART IDENTITY CASCADE` doesn't cover seasons/divisions/teams. Replace with:

```ts
  beforeEach(async () => {
    const db = getDb();
    await db.execute(sql`TRUNCATE seasons, divisions, clubs, club_aliases, teams, players, player_aliases RESTART IDENTITY CASCADE`);
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run apps/scraper/tests/entity-resolver.test.ts -t "resolveTeam"`
Expected: FAIL (`resolveTeam` not exported).

- [ ] **Step 3: Implement `resolveTeam`**

Append to `apps/scraper/src/entity-resolver.ts`:

```ts
export const resolveTeam = async (
  db: Database,
  observedName: string,
  divisionId: number,
): Promise<number> => {
  const slug = slugify(observedName);
  const [existing] = await db
    .select({ id: schema.teams.id })
    .from(schema.teams)
    .where(and(eq(schema.teams.slug, slug), eq(schema.teams.divisionId, divisionId)))
    .limit(1);
  if (existing) return existing.id;

  const clubName = stripTeamSuffix(observedName);
  const clubId = await resolveClub(db, clubName);

  const [created] = await db
    .insert(schema.teams)
    .values({ slug, name: observedName, clubId, divisionId })
    .returning();
  return created!.id;
};
```

Add `and` to the existing drizzle-orm import at the top of the file:

```ts
import { and, eq } from 'drizzle-orm';
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run apps/scraper/tests/entity-resolver.test.ts`
Expected: all entity-resolver tests pass (original 4 + 4 stripTeamSuffix + 3 resolveTeam = 11).

- [ ] **Step 5: Commit**

```bash
git add apps/scraper/src/entity-resolver.ts apps/scraper/tests/entity-resolver.test.ts
git commit -m "feat(scraper): add resolveTeam entity resolver"
```

---

### Task 5: New `divisions-discovery` walk step

**Files:**
- Modify: `apps/scraper/src/walk-plan.ts`
- Modify: `apps/scraper/tests/walk-plan.test.ts`

**Context:** New step kind. Builder takes a season name (which we only have after season detection). URL pattern matches existing league-table page URLs.

- [ ] **Step 1: Write the failing test**

Modify `apps/scraper/tests/walk-plan.test.ts` — update the import line and add a test:

```ts
import { buildInitialSteps, buildDivisionSteps, buildMatchCardStep, buildDivisionsDiscoveryStep } from '../src/walk-plan.js';
```

Append before the closing `});` of `describe('walk plan', ...)`:

```ts
  it('divisions discovery step uses the league-table URL for the named season', () => {
    const step = buildDivisionsDiscoveryStep('Summer 2026');
    expect(step.kind).toBe('divisions-discovery');
    if (step.kind === 'divisions-discovery') {
      expect(step.url).toContain('navButtonSelect=Summer%202026');
      expect(step.url).toContain('tabIndex=0');
      expect(step.url).toContain('refreshProtectionCode=0');
    }
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run apps/scraper/tests/walk-plan.test.ts -t "divisions discovery"`
Expected: FAIL (`buildDivisionsDiscoveryStep` not exported).

- [ ] **Step 3: Add the step kind and builder**

Modify `apps/scraper/src/walk-plan.ts` — extend the `WalkStep` union:

```ts
export type WalkStep =
  | { kind: 'season-nav'; url: string }
  | { kind: 'clubs-directory'; url: string }
  | { kind: 'divisions-discovery'; url: string }
  | { kind: 'locations-directory'; url: string }
  | { kind: 'club-contacts'; url: string; teamId: number }
  | { kind: 'club-location'; url: string; clubId: number }
  | { kind: 'league-table'; url: string; divisionSlug: string }
  | { kind: 'fixtures-and-results'; url: string; divisionId: number; modeId: number }
  | { kind: 'player-rankings'; url: string; divisionSlug: string }
  | { kind: 'match-card'; url: string; fixtureId: number };
```

Append the new builder at the bottom of the file:

```ts
export const buildDivisionsDiscoveryStep = (seasonName: string): WalkStep => ({
  kind: 'divisions-discovery',
  url: `${BASE_SHELL}?navButtonSelect=${encodeURIComponent(seasonName)}&tabIndex=0&refreshProtectionCode=0`,
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run apps/scraper/tests/walk-plan.test.ts`
Expected: all walk-plan tests pass (3 original + 1 new = 4).

- [ ] **Step 5: Commit**

```bash
git add apps/scraper/src/walk-plan.ts apps/scraper/tests/walk-plan.test.ts
git commit -m "feat(scraper): add divisions-discovery walk step"
```

---

### Task 6: Wire divisions-discovery + `upstream_mode_id` reads into orchestrator

**Files:**
- Modify: `apps/scraper/src/orchestrator.ts`

**Context:** Two changes:
1. Add `'divisions-discovery'` case to `handleStep` — parses the dropdown, upserts divisions.
2. In `runCurrent` and `runSeason`, schedule the new step after clubs-directory, then read `upstream_mode_id` from the DB (instead of the `0` placeholder).

We will not write a separate orchestrator test for this task — Task 8 covers the end-to-end behavior. We're verifying compile + that the existing tests don't regress.

- [ ] **Step 1: Add the parser import**

In `apps/scraper/src/orchestrator.ts`, find the existing parser import block and add `parseDivisionsDropdown`:

```ts
import {
  parseClubsDirectory,
  parseDivisionsDropdown,
  parseFixturesAndResults,
  parseMatchCard,
  parseClubContacts,
  parseClubLocation,
  parseLeagueTable,
  parsePlayerRankings,
} from '@ctl/parser';
```

Also add the new walk-plan builder to that file's existing walk-plan import:

```ts
import {
  buildInitialSteps,
  buildDivisionSteps,
  buildDivisionsDiscoveryStep,
  buildMatchCardStep,
  type WalkStep,
  type DivisionDescriptor,
} from './walk-plan.js';
```

- [ ] **Step 2: Add the `divisions-discovery` handler**

In `apps/scraper/src/orchestrator.ts`, find the `handleStep` switch. Add this case (place it after `'clubs-directory'`):

```ts
      case 'divisions-discovery': {
        const rows = parseDivisionsDropdown(html);
        // Pin to the current season — division uniqueness is (slug, season_id) and
        // (upstream_mode_id, season_id), so a re-run for the same season is idempotent.
        const [currentSeason] = await db
          .select({ id: schema.seasons.id })
          .from(schema.seasons)
          .where(eq(schema.seasons.current, true))
          .limit(1);
        if (!currentSeason) throw new Error('divisions-discovery: no current season set');
        for (const row of rows) {
          await db
            .insert(schema.divisions)
            .values({
              slug: row.slug,
              name: row.observedName,
              group: row.group,
              seasonId: currentSeason.id,
              upstreamModeId: row.modeId,
            })
            .onConflictDoUpdate({
              target: [schema.divisions.slug, schema.divisions.seasonId],
              set: { name: row.observedName, upstreamModeId: row.modeId, group: row.group },
            });
        }
        return;
      }
```

- [ ] **Step 3: Schedule the new step in `runCurrent`**

Find the existing comment `// 3. Division-level steps for the current season` in `runCurrent`. **Before** that comment, insert:

```ts
    // 2b. discover divisions from the league-table page
    const [currentSeasonRow] = await db
      .select({ name: schema.seasons.name })
      .from(schema.seasons)
      .where(eq(schema.seasons.id, detection.currentSeasonId))
      .limit(1);
    if (!currentSeasonRow) throw new Error('runCurrent: current season lookup failed');
    const discStep = buildDivisionsDiscoveryStep(currentSeasonRow.name);
    const dr = await runStep(discStep);
    dr === 'executed' ? report.stepsExecuted++ : dr === 'skipped' ? report.stepsSkipped++ : report.parseFailures++;
```

- [ ] **Step 4: Read `upstream_mode_id` in `runCurrent`**

In `runCurrent`, the existing division-fetch query reads only `id` and `slug`. Replace the query AND the descriptors mapping. Find:

```ts
    const divisions = await db
      .select({
        divisionId: schema.divisions.id,
        divisionSlug: schema.divisions.slug,
      })
      .from(schema.divisions)
      .where(eq(schema.divisions.seasonId, detection.currentSeasonId));

    // Phase 2 minimum: upstream modeID-per-division is read from a static seed file
    // OR discovered by parsing the home page season nav. For now, the orchestrator
    // assumes a `division.upstream_mode_id` column will be added in a follow-up — and
    // skips division-level steps if no mapping is available. This is a known
    // limitation, called out in the spec.
    const descriptors: DivisionDescriptor[] = divisions.map((d) => ({
      divisionId: d.divisionId,
      divisionSlug: d.divisionSlug,
      upstreamModeId: 0,        // placeholder — populated when known
    }));
    const divisionSteps = buildDivisionSteps('Summer 2026', descriptors);
    for (const step of divisionSteps) {
      if (step.kind === 'fixtures-and-results' && step.modeId === 0) continue;
      const outcome = await runStep(step);
      outcome === 'executed' ? report.stepsExecuted++ : outcome === 'skipped' ? report.stepsSkipped++ : report.parseFailures++;
    }
```

Replace with:

```ts
    const divisions = await db
      .select({
        divisionId: schema.divisions.id,
        divisionSlug: schema.divisions.slug,
        upstreamModeId: schema.divisions.upstreamModeId,
      })
      .from(schema.divisions)
      .where(eq(schema.divisions.seasonId, detection.currentSeasonId));

    const descriptors: DivisionDescriptor[] = divisions.map((d) => ({
      divisionId: d.divisionId,
      divisionSlug: d.divisionSlug,
      upstreamModeId: d.upstreamModeId,
    }));
    const divisionSteps = buildDivisionSteps(currentSeasonRow.name, descriptors);
    for (const step of divisionSteps) {
      const outcome = await runStep(step);
      outcome === 'executed' ? report.stepsExecuted++ : outcome === 'skipped' ? report.stepsSkipped++ : report.parseFailures++;
    }
```

- [ ] **Step 5: Apply the upstream_mode_id read to `runSeason`**

In `runSeason`, find:

```ts
    const divisions = await db
      .select({ divisionId: schema.divisions.id, divisionSlug: schema.divisions.slug })
      .from(schema.divisions)
      .where(eq(schema.divisions.seasonId, season.id));
    const descriptors: DivisionDescriptor[] = divisions.map((d) => ({
      divisionId: d.divisionId,
      divisionSlug: d.divisionSlug,
      upstreamModeId: 0,
    }));
    for (const step of buildDivisionSteps(season.name, descriptors)) {
      if (step.kind === 'fixtures-and-results' && step.modeId === 0) continue;
      const outcome = await runStep(step);
```

Replace with:

```ts
    const divisions = await db
      .select({
        divisionId: schema.divisions.id,
        divisionSlug: schema.divisions.slug,
        upstreamModeId: schema.divisions.upstreamModeId,
      })
      .from(schema.divisions)
      .where(eq(schema.divisions.seasonId, season.id));
    const descriptors: DivisionDescriptor[] = divisions.map((d) => ({
      divisionId: d.divisionId,
      divisionSlug: d.divisionSlug,
      upstreamModeId: d.upstreamModeId,
    }));
    for (const step of buildDivisionSteps(season.name, descriptors)) {
      const outcome = await runStep(step);
```

**Note:** `runSeason` deliberately does NOT schedule divisions-discovery. The handler keys off `seasons.current=true`, so scheduling it from a non-current-season run would overwrite the wrong season's divisions. For Plan C this means `--season=summer-2024` only walks divisions already present in the DB for that season — typically empty for archive seasons. Widening the handler to accept an explicit season id is filed as a follow-up bd issue (see end of plan).

- [ ] **Step 6: Run the full suite to confirm no regression**

Run: `pnpm test`
Expected: all tests pass. The orchestrator `modes.test.ts` test from earlier (`runCurrent populates seasons and runs without throwing`) still passes because its mock `fetchPage` returns `clubsDir` for any URL not equal to the home page — which now includes the new divisions-discovery URL. It'll attempt to parse `clubsDir` as a dropdown and find no `<select name="season_subNav_division">` elements → empty `rows` → no inserts → handler returns cleanly. Don't change the test in this task.

- [ ] **Step 7: Commit**

```bash
git add apps/scraper/src/orchestrator.ts
git commit -m "feat(scraper): wire divisions-discovery and upstream_mode_id reads"
```

---

### Task 7: Wire `fixtures-and-results` write path

**Files:**
- Modify: `apps/scraper/src/orchestrator.ts`

**Context:** Replace the existing no-op `'fixtures-and-results'` case in `handleStep` with the real write path. Per `FixtureRow`: skip if no `fixtureRef`, resolve home + away teams, upsert fixture using the existing `upstream_id` unique index, and if a `score` is present, upsert into `results`.

Same testing strategy as Task 6 — orchestrator unit tests skipped here; the full end-to-end test in Task 8 covers it.

- [ ] **Step 1: Add `resolveTeam` import**

In `apps/scraper/src/orchestrator.ts`, find:

```ts
import { resolveClub } from './entity-resolver.js';
```

Replace with:

```ts
import { resolveClub, resolveTeam } from './entity-resolver.js';
```

- [ ] **Step 2: Replace the fixtures-and-results case**

In the `handleStep` switch, find:

```ts
      case 'fixtures-and-results': {
        parseFixturesAndResults(html);
        // Resolve teams via club aliases (team name is also the club's team name in this league)
        // For Phase 2 minimum: upsert fixture, skip team FK resolution if teams not yet seeded.
        // Teams are created when the league table is parsed (not yet implemented in this minimum).
        // This is a known gap — see follow-up Phase 2 task on league-table → teams seeding.
        return;
      }
```

Replace with:

```ts
      case 'fixtures-and-results': {
        const rows = parseFixturesAndResults(html);
        let skipped = 0;
        for (const row of rows) {
          if (!row.fixtureRef) {
            skipped++;
            continue;
          }
          const homeTeamId = await resolveTeam(db, row.homeTeamName, step.divisionId);
          const awayTeamId = await resolveTeam(db, row.awayTeamName, step.divisionId);
          const [fixture] = await db
            .insert(schema.fixtures)
            .values({
              upstreamId: row.fixtureRef.id,
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
            .returning();
          if (row.score) {
            await db
              .insert(schema.results)
              .values({
                fixtureId: fixture!.id,
                homeScore: String(row.score.home),
                awayScore: String(row.score.away),
              })
              .onConflictDoUpdate({
                target: schema.results.fixtureId,
                set: { homeScore: String(row.score.home), awayScore: String(row.score.away) },
              });
          }
        }
        if (skipped > 0) {
          console.warn(`[orchestrator] fixtures-and-results: skipped ${skipped} row(s) without fixtureRef (division ${step.divisionId})`);
        }
        return;
      }
```

(`numeric` columns in postgres-js / drizzle accept either `number` or `string` for input — string is the safe path that preserves half-points without float-rounding surprises. `parseFixturesAndResults` already returns `score` as `{ home: number; away: number }`, but tennis points can be half-values (`.5`) so casting via `String(...)` keeps things explicit.)

- [ ] **Step 3: Run the full suite to verify no regression**

Run: `pnpm test`
Expected: all tests still pass. The existing `modes.test.ts` test uses a generic `clubsDir` fallback for non-home URLs — the new branch processes `parseFixturesAndResults(html)` on clubs-directory HTML, which returns `[]`, so no inserts happen.

- [ ] **Step 4: Commit**

```bash
git add apps/scraper/src/orchestrator.ts
git commit -m "feat(scraper): wire fixtures-and-results write path with team resolution"
```

---

### Task 8: Extend orchestrator end-to-end test

**Files:**
- Modify: `apps/scraper/tests/modes.test.ts`

**Context:** Replace the existing single-test in `modes.test.ts` with a routed mock that returns the league-table fixture for the divisions-discovery URL and the fixtures-and-results fixture for `displayResults.php`. Assert that all the new rows land.

- [ ] **Step 1: Write the new failing test**

Replace the body of the existing `describe('orchestrator modes', ...)` in `apps/scraper/tests/modes.test.ts`. Keep the `beforeAll` / `afterAll` / `beforeEach` blocks; replace the single `it(...)` with:

```ts
  it('runCurrent populates seasons, clubs, divisions, teams, fixtures', async () => {
    const seasonNav = await fixtureHtml('season-nav.html');
    const clubsDir = await fixtureHtml('clubs-directory.html');
    const leagueTable = await fixtureHtml('league-table-mixed-div-1.html');
    const fixturesAndResults = await fixtureHtml('fixtures-and-results-mens-div-1.html');

    const http = {
      fetchPage: vi.fn(async (url: string) => {
        if (url === 'https://www.calderdale.tennis-league.org/') {
          return { kind: 'changed' as const, status: 200, html: seasonNav, contentHash: 'home' };
        }
        if (url.includes('navButtonSelect=Directory')) {
          return { kind: 'changed' as const, status: 200, html: clubsDir, contentHash: 'clubs' };
        }
        if (url.includes('tabIndex=0')) {
          return { kind: 'changed' as const, status: 200, html: leagueTable, contentHash: `lt:${url}` };
        }
        if (url.includes('displayResults.php')) {
          return { kind: 'changed' as const, status: 200, html: fixturesAndResults, contentHash: `fr:${url}` };
        }
        // tabIndex=4 (player-rankings), match-card etc — keep no-op
        return { kind: 'changed' as const, status: 200, html: '<html></html>', contentHash: `other:${url}` };
      }),
    };
    const orch = createOrchestrator(getDb(), http);
    const report = await orch.runCurrent();

    expect(report.currentSeasonId).toBeGreaterThan(0);

    const db = getDb();
    const seasons = await db.select().from(schema.seasons);
    expect(seasons.filter((s) => s.current)).toHaveLength(1);

    const divisions = await db.select().from(schema.divisions);
    expect(divisions).toHaveLength(9);
    for (const d of divisions) {
      expect(d.upstreamModeId).toBeGreaterThan(0);
    }

    const teams = await db.select().from(schema.teams);
    expect(teams.length).toBeGreaterThanOrEqual(6);

    const fixtures = await db.select().from(schema.fixtures);
    expect(fixtures.length).toBeGreaterThan(0);
    for (const f of fixtures) {
      expect(f.upstreamId).not.toBeNull();
      expect(f.homeTeamId).toBeGreaterThan(0);
      expect(f.awayTeamId).toBeGreaterThan(0);
      expect(f.divisionId).toBeGreaterThan(0);
    }
  });
```

Add the `schema` import at the top of the file. Replace `import { createOrchestrator } from '../src/orchestrator.js';` with:

```ts
import { createOrchestrator } from '../src/orchestrator.js';
import { schema } from '@ctl/db';
```

- [ ] **Step 2: Run test to verify it fails or passes**

Run: `pnpm vitest run apps/scraper/tests/modes.test.ts`
Expected: PASS — Tasks 1-7 should already deliver this end-to-end. If it fails, the failure mode tells us which earlier task has a gap; fix the earlier task, then re-run.

- [ ] **Step 3: Commit**

```bash
git add apps/scraper/tests/modes.test.ts
git commit -m "test(scraper): orchestrator end-to-end covers divisions, teams, fixtures"
```

---

### Task 9: Live verification against the upstream

**Files:**
- None (manual / shell-only)

**Context:** Sanity-check that the whole pipeline persists real data. The dev DB container should already be running (`ctl-db-dev` on `:5433`). If it isn't, start it first.

- [ ] **Step 1: Ensure dev DB is up**

Run: `docker ps --filter name=ctl-db-dev --format '{{.Names}} {{.Status}}'`
If empty: `pnpm db:dev` and wait ~2s for postgres to accept connections.

- [ ] **Step 2: Reset the schema with the new migration**

Run:

```bash
docker exec ctl-db-dev psql -U ctl -d ctl -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;"
pnpm db:migrate
```

Expected: `migrations applied`. The previous `divisions` rows (if any) are gone — `NOT NULL` on `upstream_mode_id` would have blocked re-migration otherwise.

- [ ] **Step 3: Run the scraper**

Run: `DATABASE_URL=postgres://ctl:ctl@localhost:5433/ctl pnpm scrape`
Expected: report logged with `currentSeasonId: 1`, `stepsExecuted > 10`. Exit cleanly in under 60s (1 req/s × ~28 requests for current season).

- [ ] **Step 4: psql verification**

Run each:

```bash
docker exec ctl-db-dev psql -U ctl -d ctl -c 'SELECT id, slug, name, current FROM seasons;'
docker exec ctl-db-dev psql -U ctl -d ctl -c 'SELECT COUNT(*) FROM clubs;'
docker exec ctl-db-dev psql -U ctl -d ctl -c 'SELECT COUNT(*) FROM divisions;'
docker exec ctl-db-dev psql -U ctl -d ctl -c 'SELECT "group", COUNT(*) FROM divisions GROUP BY "group" ORDER BY 1;'
docker exec ctl-db-dev psql -U ctl -d ctl -c 'SELECT COUNT(*) FROM teams;'
docker exec ctl-db-dev psql -U ctl -d ctl -c 'SELECT COUNT(*) FROM fixtures;'
docker exec ctl-db-dev psql -U ctl -d ctl -c 'SELECT COUNT(*) FROM results;'
docker exec ctl-db-dev psql -U ctl -d ctl -c 'SELECT canonical_name FROM clubs WHERE needs_review = true ORDER BY canonical_name;'
```

Expected:
- `seasons` — 1 current row.
- `clubs` — ≥ 18.
- `divisions` — 9.
- groups — `Ladies | 3`, `Mens | 4`, `Mixed | 2`.
- `teams` — ~50–60 (varies with live data).
- `fixtures` — 150+, all with non-null `upstream_id`.
- `results` — non-zero (only completed fixtures).
- `clubs.needs_review` — small set (any tentative clubs created from unrecognized team names). Eyeball this — if it's a long list, the team-suffix heuristic missed something and we'd want to investigate before the next scheduled scrape.

- [ ] **Step 5: Push**

```bash
git pull --rebase
git push
git status   # MUST show "up to date with origin"
```

---

## Post-implementation: file follow-up bd issues

After Task 9 succeeds, file these issues (each as a separate `bd create`):

1. **Standings + upstream team IDs via POST league-table walk** (Plan A). Will need new `standings` table, `teams.upstream_team_id` column, POST in http-client.
2. **Per-team contacts walk** — depends on (1).
3. **Per-team location walk** — depends on (1).
4. **Per-fixture match-card walk** — depends on (1) and players seeding.
5. **Player rankings persistence** — schema exists; orchestrator write path missing.
6. **`runSeason` divisions-discovery for non-current seasons** — current handler keys off `seasons.current=true`; widen it (e.g. parse season id from URL or pass via step) so `--season=summer-2024` populates divisions for archive seasons.
