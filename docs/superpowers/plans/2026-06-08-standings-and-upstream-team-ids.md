# Standings + upstream team IDs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Populate a new `standings` table and a new `teams.upstream_team_id` column on every `pnpm scrape` run, by POSTing the league-table page once per division and parsing both the standings rows and the contacts list from the same response.

**Architecture:** New `WalkStep` kind `'league-table-post'` replaces the existing no-op `'league-table'` step. A new `fetchPagePost` on the HTTP client carries the form body; `runStep` discriminates POST runs by URL+body hash in `scrape_runs`. A new parser walks two independent DOM regions (the league-table tbody and the contacts list) and the orchestrator joins them by team name. One new migration adds the `standings` table and the nullable `upstream_team_id` column with a partial unique index.

**Tech Stack:** TypeScript 5.6 (strict, verbatimModuleSyntax, exactOptionalPropertyTypes, noUncheckedIndexedAccess), pnpm 9 workspaces, Drizzle ORM 0.36 + drizzle-kit 0.28, postgres-js 3.4, Cheerio (named `load` import), Vitest 2.1, Testcontainers 10.13 (`GenericContainer` postgres:16-alpine).

**Spec:** `docs/superpowers/specs/2026-06-07-standings-and-upstream-team-ids-design.md`
**Fixture (already captured + committed):** `fixtures/league-table-mens-div-1-post.html`

---

### Task 1: Parse league-table standings + team handler IDs

**Files:**
- Create: `packages/parser/src/parse-league-table-with-team-ids.ts`
- Create: `packages/parser/tests/parse-league-table-with-team-ids.test.ts`
- Modify: `packages/parser/src/index.ts` (add exports)

**Context:** Two independent DOM regions to walk:
1. **Standings**: `#leagueTable table.leagueTable_table tbody tr` — same selector as the existing `parseLeagueTable` in `packages/parser/src/parse-league-table.ts`. Cell shape: `[teamName, 'N/M', pointsLost, pointsWon]` (3+ cells; trailing empty cell exists; existing code uses indices 0..3).
2. **Team handlers**: `<ul>` of `<li onClick="displayContact( this, <ID> )">teamName</li>` inside a contacts list further down the page. Team-name text content has trailing whitespace (`'Akroydon  '` observed); `.trim()` required.

The whole-page `displayContact( null, <ID>)` handler lives in a `<script>` block; our selector targets `li[onclick]` so it won't match. Belt-and-braces: the regex requires `this`, not `null`.

- [ ] **Step 1: Write the failing tests**

Create `packages/parser/tests/parse-league-table-with-team-ids.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseLeagueTableWithTeamIds } from '../src/parse-league-table-with-team-ids.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const loadFixture = async (name: string) =>
  readFile(resolve(__dirname, '../../../fixtures', name), 'utf8');

describe('parseLeagueTableWithTeamIds', () => {
  it('returns 10 standings rows for Mens Div 1, positions 1..10', async () => {
    const html = await loadFixture('league-table-mens-div-1-post.html');
    const { standings } = parseLeagueTableWithTeamIds(html);
    expect(standings).toHaveLength(10);
    expect(standings.map((s) => s.position)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });

  it('parses points as numbers (half-points preserved as numeric)', async () => {
    const html = await loadFixture('league-table-mens-div-1-post.html');
    const { standings } = parseLeagueTableWithTeamIds(html);
    for (const s of standings) {
      expect(Number.isFinite(s.pointsWon)).toBe(true);
      expect(Number.isFinite(s.pointsLost)).toBe(true);
      expect(s.resultsReceived).toBeGreaterThanOrEqual(0);
      expect(s.resultsTotal).toBeGreaterThan(0);
    }
  });

  it('returns 10 team handlers with numeric upstreamTeamId', async () => {
    const html = await loadFixture('league-table-mens-div-1-post.html');
    const { teamHandlers } = parseLeagueTableWithTeamIds(html);
    expect(teamHandlers).toHaveLength(10);
    for (const h of teamHandlers) {
      expect(Number.isInteger(h.upstreamTeamId)).toBe(true);
      expect(h.upstreamTeamId).toBeGreaterThan(0);
      expect(h.teamName).toBe(h.teamName.trim());
      expect(h.teamName.length).toBeGreaterThan(0);
    }
  });

  it('team-name set from standings equals team-name set from team handlers', async () => {
    const html = await loadFixture('league-table-mens-div-1-post.html');
    const { standings, teamHandlers } = parseLeagueTableWithTeamIds(html);
    const fromStandings = new Set(standings.map((s) => s.teamName));
    const fromHandlers = new Set(teamHandlers.map((h) => h.teamName));
    expect(fromStandings).toEqual(fromHandlers);
  });

  it('ignores displayContact(null, ...) outside the contacts list', () => {
    // The whole-page script call `displayContact( null, 31)` should never produce a handler.
    const html = `
      <html><body>
        <script>displayContact( null, 31);</script>
        <ul><li onclick="displayContact( this, 40 )">Cragg Vale A</li></ul>
        <div id="leagueTable"><table class="leagueTable_table">
          <thead><tr></tr></thead>
          <tbody>
            <tr><td>Cragg Vale A</td><td>1/2</td><td>3</td><td>5</td><td></td></tr>
          </tbody>
        </table></div>
      </body></html>
    `;
    const { teamHandlers } = parseLeagueTableWithTeamIds(html);
    expect(teamHandlers).toEqual([{ teamName: 'Cragg Vale A', upstreamTeamId: 40 }]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run packages/parser/tests/parse-league-table-with-team-ids.test.ts`
Expected: FAIL (`parseLeagueTableWithTeamIds` not found).

- [ ] **Step 3: Write the parser**

Create `packages/parser/src/parse-league-table-with-team-ids.ts`:

```ts
import { load } from 'cheerio';
import { parseDecimalStrict, parseFraction } from './helpers.js';

export type StandingsRow = {
  position: number;
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

// Match the inline JS handler form: displayContact( this , 42 )
// Requires `this` (the per-li form), not the whole-page `displayContact( null, …)`.
const DISPLAY_CONTACT_REGEX = /displayContact\(\s*this\s*,\s*(\d+)\s*\)/;

export const parseLeagueTableWithTeamIds = (html: string): ParsedLeagueTablePage => {
  const $ = load(html);

  const standings: StandingsRow[] = [];
  $('#leagueTable table.leagueTable_table tbody tr').each((_, el) => {
    const cells = $(el)
      .find('td')
      .map((__, td) => $(td).text().trim())
      .get();
    if (cells.length < 4) return;
    const teamName = cells[0]!;
    const received = cells[1]!;
    const lost = cells[2]!;
    const won = cells[3]!;
    if (!teamName || !received) return;
    const { num, denom } = parseFraction(received);
    standings.push({
      position: standings.length + 1,
      teamName,
      resultsReceived: num,
      resultsTotal: denom,
      pointsLost: parseDecimalStrict(lost),
      pointsWon: parseDecimalStrict(won),
    });
  });

  const teamHandlers: TeamHandlerEntry[] = [];
  $('li[onclick]').each((_, el) => {
    const onClick = $(el).attr('onclick') ?? '';
    const match = DISPLAY_CONTACT_REGEX.exec(onClick);
    if (!match) return;
    const teamName = $(el).text().trim();
    if (!teamName) return;
    teamHandlers.push({ teamName, upstreamTeamId: Number(match[1]!) });
  });

  return { standings, teamHandlers };
};
```

- [ ] **Step 4: Export from package index**

Modify `packages/parser/src/index.ts` — append:

```ts
export { parseLeagueTableWithTeamIds } from './parse-league-table-with-team-ids.js';
export type {
  ParsedLeagueTablePage,
  StandingsRow,
  TeamHandlerEntry,
} from './parse-league-table-with-team-ids.js';
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm vitest run packages/parser/tests/parse-league-table-with-team-ids.test.ts`
Expected: 5 passed.

- [ ] **Step 6: Commit**

```bash
git add packages/parser/src/parse-league-table-with-team-ids.ts packages/parser/tests/parse-league-table-with-team-ids.test.ts packages/parser/src/index.ts
git commit -m "feat(parser): parseLeagueTableWithTeamIds for POST league-table response"
```

---

### Task 2: Schema — `teams.upstream_team_id` + `standings` table

**Files:**
- Modify: `packages/db/src/schema/teams.ts`
- Create: `packages/db/src/schema/standings.ts`
- Modify: `packages/db/src/schema/index.ts`
- Create: `packages/db/src/migrations/0005_*.sql` (drizzle-kit generated)
- Modify: `packages/db/tests/core-entities.test.ts`

**Context:** Two new structural elements:
- `teams.upstream_team_id` is nullable (populated only after the POST walk runs) with a partial unique index `WHERE upstream_team_id IS NOT NULL`. Drizzle 0.36 supports the partial via `uniqueIndex(...).on(t.upstreamTeamId).where(sql\`upstream_team_id IS NOT NULL\`)`.
- `standings` is a snapshot table: PK is `team_id`, FK to `teams` with `ON DELETE CASCADE`, plus an FK to `divisions` and a secondary index on `division_id` for the read path.
- Scoring columns are `numeric` (half-points), same as `results.home_score`.

- [ ] **Step 1: Write the failing tests**

Modify `packages/db/tests/core-entities.test.ts`. Find the import line that includes schema tables (e.g. `import { seasons, clubs, ..., divisions }`) and add `teams` and `standings`:

```ts
import { seasons, clubs, clubAliases, players, playerAliases, divisions, teams, standings } from '../src/schema/index.js';
```

Append these tests before the closing `});` of `describe('core entities round-trip', ...)`:

```ts
  it('teams.upstream_team_id is nullable but unique when set', async () => {
    const db = getDb();
    const [season] = await db.insert(seasons).values({ slug: 's', name: 'S', current: true }).returning();
    const [division] = await db.insert(divisions).values({
      slug: 'd', name: 'D', group: 'Mens', seasonId: season!.id, upstreamModeId: 1,
    }).returning();
    const [club] = await db.insert(clubs).values({ slug: 'c', canonicalName: 'C' }).returning();

    // Two teams with NULL upstream_team_id — both allowed
    await db.insert(teams).values([
      { slug: 't1', name: 'T1', clubId: club!.id, divisionId: division!.id },
      { slug: 't2', name: 'T2', clubId: club!.id, divisionId: division!.id },
    ]);
    // Set first to 100 — fine
    await db.execute(sql`UPDATE teams SET upstream_team_id = 100 WHERE slug = 't1'`);
    // Setting second to 100 too — must fail
    await expect(
      db.execute(sql`UPDATE teams SET upstream_team_id = 100 WHERE slug = 't2'`),
    ).rejects.toThrow();
  });

  it('standings upsert overwrites on (team_id) conflict', async () => {
    const db = getDb();
    const [season] = await db.insert(seasons).values({ slug: 's2', name: 'S2', current: true }).returning();
    const [division] = await db.insert(divisions).values({
      slug: 'd', name: 'D', group: 'Mens', seasonId: season!.id, upstreamModeId: 1,
    }).returning();
    const [club] = await db.insert(clubs).values({ slug: 'c', canonicalName: 'C' }).returning();
    const [team] = await db.insert(teams).values({
      slug: 't', name: 'T', clubId: club!.id, divisionId: division!.id,
    }).returning();

    await db.insert(standings).values({
      teamId: team!.id, divisionId: division!.id,
      position: 5, resultsReceived: 2, resultsTotal: 10, pointsWon: '7.5', pointsLost: '3.5',
    });
    await db.insert(standings).values({
      teamId: team!.id, divisionId: division!.id,
      position: 3, resultsReceived: 4, resultsTotal: 10, pointsWon: '12', pointsLost: '6',
    }).onConflictDoUpdate({
      target: standings.teamId,
      set: { position: 3, resultsReceived: 4, resultsTotal: 10, pointsWon: '12', pointsLost: '6' },
    });

    const rows = await db.select().from(standings);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.position).toBe(3);
    expect(rows[0]?.pointsWon).toBe('12');
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run packages/db/tests/core-entities.test.ts -t "upstream_team_id|standings upsert"`
Expected: FAIL — either the migrations don't include the new structures (Postgres errors) or the imports don't resolve (`standings` not exported, `teams` schema field missing).

- [ ] **Step 3: Modify the teams schema**

Replace `packages/db/src/schema/teams.ts` with:

```ts
import { sql } from 'drizzle-orm';
import { pgTable, serial, varchar, integer, uniqueIndex } from 'drizzle-orm/pg-core';
import { clubs } from './clubs.ts';
import { divisions } from './divisions.ts';

export const teams = pgTable(
  'teams',
  {
    id: serial('id').primaryKey(),
    slug: varchar('slug', { length: 96 }).notNull(),
    name: varchar('name', { length: 128 }).notNull(),
    clubId: integer('club_id').notNull().references(() => clubs.id),
    divisionId: integer('division_id').notNull().references(() => divisions.id),
    upstreamTeamId: integer('upstream_team_id'),
  },
  (t) => ({
    slugDivisionIdx: uniqueIndex('teams_slug_division_idx').on(t.slug, t.divisionId),
    upstreamTeamIdIdx: uniqueIndex('teams_upstream_team_id_idx')
      .on(t.upstreamTeamId)
      .where(sql`upstream_team_id IS NOT NULL`),
  }),
);
```

- [ ] **Step 4: Create the standings schema**

Create `packages/db/src/schema/standings.ts`:

```ts
import { pgTable, integer, numeric, index } from 'drizzle-orm/pg-core';
import { teams } from './teams.ts';
import { divisions } from './divisions.ts';

export const standings = pgTable(
  'standings',
  {
    teamId: integer('team_id')
      .primaryKey()
      .references(() => teams.id, { onDelete: 'cascade' }),
    divisionId: integer('division_id').notNull().references(() => divisions.id),
    position: integer('position').notNull(),
    resultsReceived: integer('results_received').notNull(),
    resultsTotal: integer('results_total').notNull(),
    pointsWon: numeric('points_won').notNull(),
    pointsLost: numeric('points_lost').notNull(),
  },
  (t) => ({
    divisionIdx: index('standings_division_id_idx').on(t.divisionId),
  }),
);
```

- [ ] **Step 5: Export standings from the schema barrel**

Modify `packages/db/src/schema/index.ts` — append:

```ts
export * from './standings.ts';
```

- [ ] **Step 6: Generate the migration**

Run: `pnpm --filter @ctl/db db:generate`
Expected: a new `packages/db/src/migrations/0005_<name>.sql` containing:
- `ALTER TABLE "teams" ADD COLUMN "upstream_team_id" integer`
- `CREATE UNIQUE INDEX "teams_upstream_team_id_idx" ON "teams" USING btree ("upstream_team_id") WHERE "upstream_team_id" IS NOT NULL`
- `CREATE TABLE "standings" (...)` with the FK and PK clauses
- `CREATE INDEX "standings_division_id_idx" ON "standings" USING btree ("division_id")`

Open the generated SQL and confirm it includes ONLY those statements. If drizzle-kit adds extra unrelated DDL (it shouldn't), stop and investigate before continuing.

- [ ] **Step 7: Run tests to verify they pass**

Run: `pnpm vitest run packages/db/tests/core-entities.test.ts`
Expected: all tests pass.

- [ ] **Step 8: Commit**

```bash
git add packages/db/src/schema/teams.ts packages/db/src/schema/standings.ts packages/db/src/schema/index.ts packages/db/src/migrations/0005_*.sql packages/db/src/migrations/meta packages/db/tests/core-entities.test.ts
git commit -m "feat(db): add standings table and teams.upstream_team_id"
```

---

### Task 3: `fetchPagePost` on the HTTP client

**Files:**
- Modify: `apps/scraper/src/http-client.ts`
- Modify: `apps/scraper/tests/http-client.test.ts`

**Context:** Add a POST sibling to `fetchPage`. Same rate-limit, same retry policy (3 attempts, 2/4/8s backoff on 502/503/504), same 30s timeout. POST never sends `If-Modified-Since`; dedup leans entirely on SHA-256 content-hash matching `prior.contentHash`. Sets `Content-Type: application/x-www-form-urlencoded`.

The implementation refactors the existing private `requestOnce` so GET and POST share it (method + optional body + optional content-type), but keeps `fetchPage` as a public GET shim.

- [ ] **Step 1: Write the failing tests**

Append to `apps/scraper/tests/http-client.test.ts` (inside the existing `describe('createScrapeHttpClient', ...)` block, before its closing `});`):

```ts
  it('fetchPagePost sends POST with form body and correct headers', async () => {
    const fakeFetch = vi.fn(async () => makeResponse({ status: 200, body: '<ok/>' }));
    const client = createScrapeHttpClient({ fetch: fakeFetch as any, rateLimitMs: 0 });
    await client.fetchPagePost('https://example.test/page', 'a=1&b=2');
    const calls = fakeFetch.mock.calls as unknown[][];
    const init = calls[0]?.[1] as RequestInit;
    expect(init.method).toBe('POST');
    expect(init.body).toBe('a=1&b=2');
    expect(new Headers(init.headers).get('Content-Type')).toBe('application/x-www-form-urlencoded');
  });

  it('fetchPagePost reports unchanged on matching content hash', async () => {
    const fakeFetch = vi.fn(async () => makeResponse({ status: 200, body: '<same/>' }));
    const client = createScrapeHttpClient({ fetch: fakeFetch as any, rateLimitMs: 0 });
    const first = await client.fetchPagePost('https://example.test/page', 'a=1');
    const hash = first.kind === 'changed' ? first.contentHash : '';
    const second = await client.fetchPagePost('https://example.test/page', 'a=1', { contentHash: hash });
    expect(second.kind).toBe('unchanged');
  });

  it('fetchPagePost retries on 503 then succeeds', async () => {
    const fakeFetch = vi
      .fn()
      .mockResolvedValueOnce(makeResponse({ status: 503 }))
      .mockResolvedValueOnce(makeResponse({ status: 200, body: '<ok/>' }));
    const client = createScrapeHttpClient({
      fetch: fakeFetch as any,
      rateLimitMs: 0,
      maxRetries: 2,
    });
    const r = await client.fetchPagePost('https://example.test/page', 'a=1');
    expect(r.kind).toBe('changed');
    expect(fakeFetch).toHaveBeenCalledTimes(2);
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run apps/scraper/tests/http-client.test.ts -t "fetchPagePost"`
Expected: FAIL (`fetchPagePost` does not exist).

- [ ] **Step 3: Add `fetchPagePost` to the http-client**

Modify `apps/scraper/src/http-client.ts`. First, update the type export — find the `ScrapeHttpClient` type and replace it with:

```ts
export type ScrapeHttpClient = {
  fetchPage: (url: string, prior?: PriorFetch) => Promise<FetchResult>;
  fetchPagePost: (url: string, body: string, prior?: PriorFetch) => Promise<FetchResult>;
};
```

Inside `createScrapeHttpClient`, find the existing private `requestOnce` function:

```ts
  const requestOnce = async (
    url: string,
    headers: Record<string, string>,
  ): Promise<{ status: number; html: string; headers: Headers }> => {
```

Replace with a method-aware version:

```ts
  const requestOnce = async (
    url: string,
    headers: Record<string, string>,
    method: 'GET' | 'POST' = 'GET',
    body?: string,
  ): Promise<{ status: number; html: string; headers: Headers }> => {
    const controller = new AbortController();
    const timeout = nativeSetTimeout(() => controller.abort(), requestTimeoutMs);
    try {
      const init: RequestInit = { method, headers, redirect: 'follow', signal: controller.signal };
      if (body !== undefined) init.body = body;
      const res = await f(url, init);
      const text = await res.text();
      return { status: res.status, html: text, headers: res.headers };
    } finally {
      nativeClearTimeout(timeout);
    }
  };
```

(Make sure to remove the original `requestOnce` body — only the new version remains.)

Then find the existing `fetchWithRetries` and update its call to `requestOnce` to pass through method + body. Find the line `let attempt = 0;` inside `fetchWithRetries`. Replace the entire `fetchWithRetries` function with:

```ts
  const fetchWithRetries = async (
    url: string,
    headers: Record<string, string>,
    method: 'GET' | 'POST' = 'GET',
    body?: string,
  ) => {
    let attempt = 0;
    let lastErr: unknown;
    while (attempt <= maxRetries) {
      await respectRateLimit();
      try {
        const res = await requestOnce(url, headers, method, body);
        if (res.status === 200 || res.status === 304) return res;
        if (RETRIABLE_STATUSES.has(res.status)) {
          if (attempt < maxRetries) {
            await sleep(BACKOFF_MS[attempt]!);
            attempt++;
            continue;
          }
        }
        throw new Error(`fetchPage: ${res.status} for ${url}`);
      } catch (err) {
        lastErr = err;
        if (attempt >= maxRetries) throw err;
        await sleep(BACKOFF_MS[attempt]!);
        attempt++;
      }
    }
    throw lastErr ?? new Error('fetchWithRetries: exhausted');
  };
```

Find the existing `fetchPage` definition and confirm it still calls `fetchWithRetries(url, headers)` (the new optional `method`/`body` params default to GET). No change needed there.

Append the new `fetchPagePost`:

```ts
  const fetchPagePost = async (url: string, body: string, prior?: PriorFetch): Promise<FetchResult> => {
    const headers: Record<string, string> = {
      'User-Agent': userAgent,
      'Content-Type': 'application/x-www-form-urlencoded',
    };
    const res = await fetchWithRetries(url, headers, 'POST', body);
    const contentHash = sha256(res.html);
    if (prior?.contentHash && prior.contentHash === contentHash) {
      return { kind: 'unchanged', status: res.status, contentHash };
    }
    return { kind: 'changed', status: res.status, html: res.html, contentHash };
  };
```

Finally, update the returned object at the bottom of `createScrapeHttpClient`:

```ts
  return { fetchPage, fetchPagePost };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run apps/scraper/tests/http-client.test.ts`
Expected: all tests pass (existing GET tests + 3 new POST tests).

- [ ] **Step 5: Commit**

```bash
git add apps/scraper/src/http-client.ts apps/scraper/tests/http-client.test.ts
git commit -m "feat(scraper): add fetchPagePost to the http client"
```

---

### Task 4: New `league-table-post` walk step (replaces `league-table`)

**Files:**
- Modify: `apps/scraper/src/walk-plan.ts`
- Modify: `apps/scraper/tests/walk-plan.test.ts`

**Context:** Remove the existing `'league-table'` no-op step from the `WalkStep` union and from `buildDivisionSteps`. Add `'league-table-post'` in its place — it carries the precomputed `postBody` so the http-client doesn't need to know form encoding.

The existing `walk-plan.test.ts` has an assertion that the first step in each division triplet is `'league-table'`. That assertion changes to `'league-table-post'`.

- [ ] **Step 1: Update the existing test**

Modify `apps/scraper/tests/walk-plan.test.ts`. Find the test `'division steps include league-table + fixtures + rankings for each division'`. Replace it with:

```ts
  it('division steps include league-table-post + fixtures + rankings for each division', () => {
    const steps = buildDivisionSteps('Summer 2026', [
      { divisionId: 1, divisionSlug: 'mens-1', upstreamModeId: 8 },
      { divisionId: 2, divisionSlug: 'mens-2', upstreamModeId: 9 },
    ]);
    expect(steps).toHaveLength(6);
    expect(steps[0]?.kind).toBe('league-table-post');
    expect(steps[1]?.kind).toBe('fixtures-and-results');
    expect(steps[2]?.kind).toBe('player-rankings');
    expect(steps[3]?.kind).toBe('league-table-post');
  });

  it('league-table-post step carries the form body for the division modeID', () => {
    const steps = buildDivisionSteps('Summer 2026', [
      { divisionId: 1, divisionSlug: 'mens-1', upstreamModeId: 8 },
    ]);
    const lt = steps[0];
    expect(lt?.kind).toBe('league-table-post');
    if (lt?.kind === 'league-table-post') {
      expect(lt.url).toContain('index.php?navButtonSelect=Summer%202026&tabIndex=0');
      expect(lt.postBody).toBe('season_subNav_mode=league&season_subNav_subMode=division&season_subNav_my_division=8&refreshProtectionCode=0');
      expect(lt.divisionId).toBe(1);
      expect(lt.modeId).toBe(8);
    }
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run apps/scraper/tests/walk-plan.test.ts`
Expected: FAIL — `'league-table'` is the current first kind; the new `'league-table-post'` doesn't exist.

- [ ] **Step 3: Update the WalkStep union and buildDivisionSteps**

Modify `apps/scraper/src/walk-plan.ts`. Replace the `WalkStep` union to remove `'league-table'` and add `'league-table-post'`:

```ts
export type WalkStep =
  | { kind: 'season-nav'; url: string }
  | { kind: 'clubs-directory'; url: string }
  | { kind: 'divisions-discovery'; url: string }
  | { kind: 'locations-directory'; url: string }
  | { kind: 'club-contacts'; url: string; teamId: number }
  | { kind: 'club-location'; url: string; clubId: number }
  | { kind: 'league-table-post'; url: string; divisionId: number; modeId: number; postBody: string }
  | { kind: 'fixtures-and-results'; url: string; divisionId: number; modeId: number }
  | { kind: 'player-rankings'; url: string; divisionSlug: string }
  | { kind: 'match-card'; url: string; fixtureId: number };
```

Replace `buildDivisionSteps` with:

```ts
export const buildDivisionSteps = (seasonName: string, divisions: DivisionDescriptor[]): WalkStep[] => {
  const steps: WalkStep[] = [];
  const seasonParam = encodeURIComponent(seasonName);
  for (const d of divisions) {
    steps.push({
      kind: 'league-table-post',
      url: `${BASE_SHELL}index.php?navButtonSelect=${seasonParam}&tabIndex=0&refreshProtectionCode=0`,
      divisionId: d.divisionId,
      modeId: d.upstreamModeId,
      postBody: `season_subNav_mode=league&season_subNav_subMode=division&season_subNav_my_division=${d.upstreamModeId}&refreshProtectionCode=0`,
    });
    steps.push({
      kind: 'fixtures-and-results',
      // Upstream displayResults.php requires the full JS-equivalent param set —
      // missing any one returns a PHP-notice page that the parser can't read.
      url: `${BASE_FRAGMENT}displayResults.php?WebsiteTimeZone=Europe/London&seasonIdentifierID=2&database=ludus3_tl_calderdale&commonDatabase=ludus3_tennis_common&mode=view-division&modeID=${d.upstreamModeId}&daysResultsRequired=7&resultsSecretaryVerificationRequired=N&refreshProtectionCode=0`,
      divisionId: d.divisionId,
      modeId: d.upstreamModeId,
    });
    steps.push({
      kind: 'player-rankings',
      url: `${BASE_SHELL}?navButtonSelect=${seasonParam}&tabIndex=4&refreshProtectionCode=0`,
      divisionSlug: d.divisionSlug,
    });
  }
  return steps;
};
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run apps/scraper/tests/walk-plan.test.ts`
Expected: all walk-plan tests pass.

- [ ] **Step 5: Commit**

```bash
git add apps/scraper/src/walk-plan.ts apps/scraper/tests/walk-plan.test.ts
git commit -m "feat(scraper): replace league-table walk step with league-table-post"
```

---

### Task 5: Wire `league-table-post` into the orchestrator

**Files:**
- Modify: `apps/scraper/src/orchestrator.ts`

**Context:** Two distinct changes:
1. **`runStep` discriminates GET vs POST** — adds a `runKey` (URL + body-hash discriminator for POST) used everywhere `step.url` was used against `scrape_runs`; calls `fetchPagePost` for POST steps.
2. **New `handleStep` case `'league-table-post'`** — parses both arrays; for each standings row resolves the team, sets `upstream_team_id` (with NULL/equal/diff branches), upserts standings; remove the old `'league-table'` case.

This task does not add new orchestrator-level unit tests — Task 7 covers the end-to-end behaviour. We're verifying that the existing test suite still passes after the change.

- [ ] **Step 1: Add the parser, schema, and crypto imports**

In `apps/scraper/src/orchestrator.ts`, find the existing `@ctl/parser` import block. Replace `parseLeagueTable` with `parseLeagueTableWithTeamIds`:

```ts
import {
  parseClubsDirectory,
  parseDivisionsDropdown,
  parseFixturesAndResults,
  parseMatchCard,
  parseClubContacts,
  parseClubLocation,
  parseLeagueTableWithTeamIds,
  parsePlayerRankings,
} from '@ctl/parser';
```

Add a `node:crypto` import at the top of the file (after the other imports):

```ts
import { createHash } from 'node:crypto';
```

(The existing `schema` import already includes the `standings` table via the schema barrel — no change needed for the schema import.)

- [ ] **Step 2: Add the `runKey` discriminator and POST dispatch in `runStep`**

Find the start of `runStep`:

```ts
  const runStep = async (step: WalkStep): Promise<'executed' | 'skipped' | 'failed'> => {
    const [prior] = await db.select().from(schema.scrapeRuns).where(eq(schema.scrapeRuns.url, step.url));
```

Insert a `runKey` computation just before that `db.select`, then replace every `step.url` reference inside `runStep` (in three places: prior select, executed insert, failed insert) with `runKey`. Concretely, replace the entire `runStep` function with:

```ts
  const runStep = async (step: WalkStep): Promise<'executed' | 'skipped' | 'failed'> => {
    const runKey = 'postBody' in step
      ? `${step.url}#bh:${createHash('sha256').update(step.postBody).digest('hex').slice(0, 8)}`
      : step.url;
    const [prior] = await db.select().from(schema.scrapeRuns).where(eq(schema.scrapeRuns.url, runKey));
    const priorFetch = prior
      ? {
          ...(prior.lastModified != null ? { lastModified: prior.lastModified } : {}),
          ...(prior.contentHash != null ? { contentHash: prior.contentHash } : {}),
        }
      : undefined;
    const result = 'postBody' in step
      ? await http.fetchPagePost(step.url, step.postBody, priorFetch)
      : await http.fetchPage(step.url, priorFetch);

    if (result.kind === 'unchanged') {
      await db
        .insert(schema.scrapeRuns)
        .values({
          url: runKey,
          lastFetchedAt: new Date(),
          lastStatus: result.status,
          lastParseOk: true,
          contentHash: result.contentHash ?? prior?.contentHash ?? null,
          lastModified: prior?.lastModified ?? null,
        })
        .onConflictDoUpdate({
          target: schema.scrapeRuns.url,
          set: { lastFetchedAt: new Date(), lastStatus: result.status },
        });
      return 'skipped';
    }

    try {
      await handleStep(step, result.html);
      await db
        .insert(schema.scrapeRuns)
        .values({
          url: runKey,
          lastFetchedAt: new Date(),
          lastStatus: result.status,
          lastParseOk: true,
          contentHash: result.contentHash,
          lastModified: result.lastModified ?? null,
        })
        .onConflictDoUpdate({
          target: schema.scrapeRuns.url,
          set: {
            lastFetchedAt: new Date(),
            lastStatus: result.status,
            lastParseOk: true,
            contentHash: result.contentHash,
            lastModified: result.lastModified ?? null,
            lastError: null,
          },
        });
      return 'executed';
    } catch (err) {
      console.error(`[orchestrator] parse failed for ${runKey}:`, err);
      await db
        .insert(schema.scrapeRuns)
        .values({
          url: runKey,
          lastFetchedAt: new Date(),
          lastStatus: result.status,
          lastParseOk: false,
          contentHash: result.contentHash,
          lastError: String(err),
        })
        .onConflictDoUpdate({
          target: schema.scrapeRuns.url,
          set: { lastFetchedAt: new Date(), lastParseOk: false, lastError: String(err) },
        });
      return 'failed';
    }
  };
```

(`fetchPage`'s `FetchResult` includes `lastModified?` on the `'changed'` branch; `fetchPagePost` does not — TypeScript narrowing handles both shapes because the `lastModified` access is via optional chaining.)

- [ ] **Step 3: Replace the `league-table` handler with `league-table-post`**

In the `handleStep` switch inside `apps/scraper/src/orchestrator.ts`, find:

```ts
      case 'league-table': {
        parseLeagueTable(html);
        // Upsert team rows into the current division; populate canonical names via aliases.
        return;
      }
```

Replace with:

```ts
      case 'league-table-post': {
        const parsed = parseLeagueTableWithTeamIds(html);
        const idByName = new Map(parsed.teamHandlers.map((h) => [h.teamName, h.upstreamTeamId]));
        const handlerNamesMatchedByStandings = new Set<string>();

        for (const row of parsed.standings) {
          const teamId = await resolveTeam(db, row.teamName, step.divisionId);
          const upstreamId = idByName.get(row.teamName);
          if (upstreamId !== undefined) {
            handlerNamesMatchedByStandings.add(row.teamName);
            const [existing] = await db
              .select({ upstreamTeamId: schema.teams.upstreamTeamId })
              .from(schema.teams)
              .where(eq(schema.teams.id, teamId))
              .limit(1);
            if (existing?.upstreamTeamId == null) {
              await db
                .update(schema.teams)
                .set({ upstreamTeamId: upstreamId })
                .where(eq(schema.teams.id, teamId));
            } else if (existing.upstreamTeamId !== upstreamId) {
              console.warn(
                `[orchestrator] upstream_team_id mismatch for team ${teamId} (${row.teamName}): existing=${existing.upstreamTeamId}, observed=${upstreamId}; keeping existing`,
              );
            }
          } else {
            console.warn(
              `[orchestrator] standings row "${row.teamName}" has no matching contacts handler in division ${step.divisionId}`,
            );
          }

          await db
            .insert(schema.standings)
            .values({
              teamId,
              divisionId: step.divisionId,
              position: row.position,
              resultsReceived: row.resultsReceived,
              resultsTotal: row.resultsTotal,
              pointsWon: String(row.pointsWon),
              pointsLost: String(row.pointsLost),
            })
            .onConflictDoUpdate({
              target: schema.standings.teamId,
              set: {
                divisionId: step.divisionId,
                position: row.position,
                resultsReceived: row.resultsReceived,
                resultsTotal: row.resultsTotal,
                pointsWon: String(row.pointsWon),
                pointsLost: String(row.pointsLost),
              },
            });
        }

        for (const h of parsed.teamHandlers) {
          if (!handlerNamesMatchedByStandings.has(h.teamName)) {
            console.warn(
              `[orchestrator] contacts handler "${h.teamName}" (upstreamId=${h.upstreamTeamId}) has no matching standings row in division ${step.divisionId}`,
            );
          }
        }
        return;
      }
```

- [ ] **Step 4: Update the modes.test.ts mock to include `fetchPagePost`**

The `ScrapeHttpClient` type now requires both `fetchPage` and `fetchPagePost`. The existing `modes.test.ts` mock only provides `fetchPage` — TypeScript will reject it. Add a minimal `fetchPagePost` so the existing test still compiles. The full Task 7 end-to-end test will replace this with a real-fixture-serving mock; for now we just need it to compile and not break.

In `apps/scraper/tests/modes.test.ts`, find the `http` object inside `describe('orchestrator modes', ...)`. Add this property next to `fetchPage`:

```ts
      fetchPagePost: vi.fn(async (url: string) => ({
        kind: 'changed' as const,
        status: 200,
        html: '<html></html>',
        contentHash: `post:${url}`.slice(0, 64),
      })),
```

- [ ] **Step 5: Run the full suite to confirm no regression**

Run: `pnpm test`
Expected: all tests pass. `parseLeagueTableWithTeamIds` against `<html></html>` returns `{ standings: [], teamHandlers: [] }`, so the new handler is a no-op for the placeholder mock — no DB writes, no failures.

- [ ] **Step 6: Commit**

```bash
git add apps/scraper/src/orchestrator.ts apps/scraper/tests/modes.test.ts
git commit -m "feat(scraper): wire league-table-post handler with team-id + standings writes"
```

---

### Task 6: Update the data tier read path (existing `divisions.getDivisionTable`)

**Files:**
- Modify: `packages/data/src/divisions.ts`
- Modify: `packages/data/tests/divisions.test.ts`

**Context:** Confirm whether the existing `getDivisionTable` already reads from a `standings`-shaped source. If it joins the existing pre-standings shape (e.g. computes from results), it should now prefer the new `standings` table. If it was a placeholder that returned an empty array, wire it to the new table.

Without seeing the file, the task here is to **read the current implementation, decide which case applies, and adapt accordingly**. We don't want to rewrite a working query, but we do want the read path to surface the new snapshot data.

- [ ] **Step 1: Read the current `divisions.ts`**

Run: `cat packages/data/src/divisions.ts`
Inspect the `getDivisionTable` implementation.

- [ ] **Step 2: Read the existing test**

Run: `cat packages/data/tests/divisions.test.ts`
Inspect the test for `getDivisionTable` to see what shape it expects.

- [ ] **Step 3: Decide path A or path B**

**Path A — the function already reads from `standings`:** no change needed. Run the existing test (`pnpm vitest run packages/data/tests/divisions.test.ts`); confirm it passes against the new schema. If yes, skip to Step 6 with no code change.

**Path B — the function does not yet read from `standings`:** rewrite it to join `standings` with `teams` for the given division. The expected shape is a positional list with team name + standings columns. Update the test to seed `standings` rows and assert ordering by `position`.

- [ ] **Step 4: Implement path B if applicable**

If path B applies, replace the body of `getDivisionTable(divisionId)` to do:

```ts
return db
  .select({
    position: schema.standings.position,
    teamName: schema.teams.name,
    resultsReceived: schema.standings.resultsReceived,
    resultsTotal: schema.standings.resultsTotal,
    pointsWon: schema.standings.pointsWon,
    pointsLost: schema.standings.pointsLost,
  })
  .from(schema.standings)
  .innerJoin(schema.teams, eq(schema.teams.id, schema.standings.teamId))
  .where(eq(schema.standings.divisionId, divisionId))
  .orderBy(schema.standings.position);
```

Make sure `eq` and `schema` are imported at the top of the file.

- [ ] **Step 5: Update the test if applicable**

If path B applies, update `packages/data/tests/divisions.test.ts` for `getDivisionTable`. The test must seed: a season, a division, a club, two teams, and two standings rows. Assert that the returned list is ordered by `position` ascending and contains the team names.

Example shape (adjust to match your read in Step 1):

```ts
  it('getDivisionTable returns ordered rows for a known division', async () => {
    const db = getDb();
    const [season] = await db.insert(schema.seasons).values({ slug: 's', name: 'S', current: true }).returning();
    const [division] = await db.insert(schema.divisions).values({
      slug: 'mens-1', name: 'Mens Division 1', group: 'Mens', seasonId: season!.id, upstreamModeId: 8,
    }).returning();
    const [club] = await db.insert(schema.clubs).values({ slug: 'c', canonicalName: 'C' }).returning();
    const [a, b] = await db.insert(schema.teams).values([
      { slug: 'a', name: 'Team A', clubId: club!.id, divisionId: division!.id },
      { slug: 'b', name: 'Team B', clubId: club!.id, divisionId: division!.id },
    ]).returning();
    await db.insert(schema.standings).values([
      { teamId: a!.id, divisionId: division!.id, position: 2, resultsReceived: 1, resultsTotal: 5, pointsWon: '3', pointsLost: '2' },
      { teamId: b!.id, divisionId: division!.id, position: 1, resultsReceived: 1, resultsTotal: 5, pointsWon: '4', pointsLost: '1' },
    ]);

    const rows = await getDivisionTable(db, division!.id);
    expect(rows).toHaveLength(2);
    expect(rows[0]?.teamName).toBe('Team B');
    expect(rows[1]?.teamName).toBe('Team A');
  });
```

- [ ] **Step 6: Run the data-tier tests**

Run: `pnpm vitest run packages/data/tests/divisions.test.ts`
Expected: all tests pass.

- [ ] **Step 7: Commit (path B only — skip if path A)**

```bash
git add packages/data/src/divisions.ts packages/data/tests/divisions.test.ts
git commit -m "feat(data): getDivisionTable reads from standings"
```

---

### Task 7: End-to-end test covering standings + `upstream_team_id`

**Files:**
- Modify: `apps/scraper/tests/modes.test.ts`

**Context:** Extend the existing `runCurrent` end-to-end test to mock both `fetchPage` and `fetchPagePost`, route the POST league-table URL to the Mens-Div-1 fixture, and assert the new data.

- [ ] **Step 1: Update the test**

Modify `apps/scraper/tests/modes.test.ts`. Replace the test body inside `describe('orchestrator modes', ...)`:

```ts
  it('runCurrent populates seasons, clubs, divisions, teams, fixtures, standings, upstream_team_id', async () => {
    const seasonNav = await fixtureHtml('season-nav.html');
    const clubsDir = await fixtureHtml('clubs-directory.html');
    const leagueTablePost = await fixtureHtml('league-table-mens-div-1-post.html');
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
          // divisions-discovery uses the same GET URL. Service it with the POST fixture
          // since the fixture also contains the divisions <select> dropdown.
          return { kind: 'changed' as const, status: 200, html: leagueTablePost, contentHash: `disc:${url}`.slice(0, 64) };
        }
        if (url.includes('displayResults.php')) {
          return { kind: 'changed' as const, status: 200, html: fixturesAndResults, contentHash: `fr:${url}`.slice(0, 64) };
        }
        return { kind: 'changed' as const, status: 200, html: '<html></html>', contentHash: `ot:${url}`.slice(0, 64) };
      }),
      fetchPagePost: vi.fn(async (url: string, body: string) => {
        if (url.includes('index.php') && url.includes('tabIndex=0')) {
          return { kind: 'changed' as const, status: 200, html: leagueTablePost, contentHash: `ltp:${body}`.slice(0, 64) };
        }
        return { kind: 'changed' as const, status: 200, html: '<html></html>', contentHash: `pst:${url}`.slice(0, 64) };
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

    const teamsWithUpstream = await db
      .select()
      .from(schema.teams)
      .where(sql`upstream_team_id IS NOT NULL`);
    // The Mens Div 1 fixture has 10 team-handler entries; the same fixture is served for
    // every division's league-table-post, so all matching teams (one per league-table
    // walk) get their upstream_team_id set.
    expect(teamsWithUpstream.length).toBeGreaterThanOrEqual(10);

    const standingsRows = await db.select().from(schema.standings);
    expect(standingsRows.length).toBeGreaterThanOrEqual(10);
    for (const s of standingsRows) {
      expect(s.position).toBeGreaterThanOrEqual(1);
      expect(s.divisionId).toBeGreaterThan(0);
      expect(s.teamId).toBeGreaterThan(0);
    }

    const fixtures = await db.select().from(schema.fixtures);
    expect(fixtures.length).toBeGreaterThan(0);
  });
```

- [ ] **Step 2: Run the test**

Run: `pnpm vitest run apps/scraper/tests/modes.test.ts`
Expected: PASS — Tasks 1-5 should already deliver this end-to-end. If it fails, the failure mode tells us where the integration has a gap.

- [ ] **Step 3: Commit**

```bash
git add apps/scraper/tests/modes.test.ts
git commit -m "test(scraper): orchestrator end-to-end covers standings and upstream_team_id"
```

---

### Task 8: Live verification against the upstream

**Files:**
- None (manual / shell-only)

**Context:** Sanity-check that the whole pipeline persists real data on the dev DB. The container should already be running.

- [ ] **Step 1: Ensure dev DB is up**

Run: `docker ps --filter name=ctl-db-dev --format '{{.Names}} {{.Status}}'`
If empty: `pnpm db:dev` and wait ~2s.

- [ ] **Step 2: Apply the new migration**

Run: `pnpm db:migrate`
Expected: `migrations applied`. The 0005 migration adds the new column + table; no backfill needed because `upstream_team_id` is nullable.

- [ ] **Step 3: Truncate prior data and re-scrape**

Run:

```bash
docker exec ctl-db-dev psql -U ctl -d ctl -c "TRUNCATE seasons, divisions, clubs, club_aliases, teams, scrape_runs, fixtures, results, standings RESTART IDENTITY CASCADE"
DATABASE_URL=postgres://ctl:ctl@localhost:5433/ctl pnpm scrape
```

Expected: report logs `stepsExecuted: 29`, `parseFailures: 0`, runtime ~1 minute.

- [ ] **Step 4: psql verification**

Run each:

```bash
docker exec ctl-db-dev psql -U ctl -d ctl -c 'SELECT COUNT(*) FROM standings;'
docker exec ctl-db-dev psql -U ctl -d ctl -c 'SELECT COUNT(*) FROM teams WHERE upstream_team_id IS NOT NULL;'
docker exec ctl-db-dev psql -U ctl -d ctl -c "SELECT t.name, s.position, s.points_won, s.points_lost FROM standings s JOIN teams t ON t.id=s.team_id WHERE s.division_id = (SELECT id FROM divisions WHERE slug='mens-division-1') ORDER BY s.position;"
docker exec ctl-db-dev psql -U ctl -d ctl -c 'SELECT COUNT(DISTINCT upstream_team_id) FROM teams WHERE upstream_team_id IS NOT NULL;'
```

Expected:
- `standings` count: ≈ 78 (one row per team).
- `teams WHERE upstream_team_id IS NOT NULL` count: ≈ 78 (every team gets its upstream id from the POST walk).
- Mens Div 1 leaderboard: 10 rows, positions 1..10, points_won/lost match the live page.
- Distinct upstream IDs: equal to the WHERE-not-null count above (no collisions on the partial unique index).

- [ ] **Step 5: Push**

```bash
git pull --rebase
git push
git status   # MUST show "up to date with origin"
```

---

## Post-implementation: bd housekeeping

After Task 8 succeeds:

- Close `calderdale-tennis-league-ke3` with a summary of what landed and a link to the live verification numbers.
- The follow-up bd issues `i79` (contacts walk) and `3ix` (location walk) are now unblocked — they depend on `teams.upstream_team_id` being populated, which this work delivers.
- `pi8` (match-card walk) is partially unblocked — still needs players seeding.
