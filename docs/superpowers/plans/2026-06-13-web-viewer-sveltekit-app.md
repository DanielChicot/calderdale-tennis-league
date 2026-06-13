# Web Viewer — SvelteKit App Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `apps/web` — a server-rendered SvelteKit app with six pages (home, division, match-card, team, player, club) reading the `@ctl/data` getters from Plan 1.

**Architecture:** SvelteKit 2 + Svelte 5 + `adapter-node`. Each route has a thin `+page.server.ts` `load` that calls a getter via a server-only DB singleton and `throw error(404)` on null, plus a `+page.svelte` that renders the returned data. Pure display logic (date formatting, division grouping) lives in testable `src/lib/` helpers. Load functions are unit-tested by mocking the getters (their correctness is Plan 1's job — here we test wiring + 404 paths cheaply, no DB).

**Tech Stack:** SvelteKit 2, Svelte 5 (runes), `@sveltejs/adapter-node`, Vite 5, Vitest 2.1, TypeScript 5.6 strict. Workspace dep `@ctl/data` + `@ctl/db`.

**Spec:** `docs/superpowers/specs/2026-06-13-web-viewer-design.md`. This is Plan 2 of 3; Plan 1 (data getters) is done. Plan 3 (deployment) follows.

**Getter return shapes (from Plan 1 — verified, pinned):**
- `getCurrentSeason(db): { id, slug, name, current } | null`; `listSeasons(db): SeasonSummary[]`
- `listDivisions(db, seasonId): { id, slug, name, group: 'Mens'|'Ladies'|'Mixed', seasonId }[]`
- `getDivisionTable(db, slug): { division: {id,slug,name,group,seasonId}, rows: { position, teamId, teamSlug, teamName, pointsWon, pointsLost, resultsReceived, resultsTotal }[] } | null`
- `listFixturesByDivision(db, divisionId): { id, date, homeTeam{slug,name}, awayTeam{slug,name}, status, score?{home,away}, hasCard }[]`
- `getRankingsByDivision(db, divisionId): RankingRow[]` (existing — has `rank, playerId, ...`; see Task 4 note)
- `getMatchCard(db, fixtureId): { fixture{id,date,division{slug,name},homeTeam{slug,name},awayTeam{slug,name},score?{home,away}}, rubbers: { orderInCard, homePlayers[{slug,name}], awayPlayers[{slug,name}], sets[{home,away}] }[] } | null`
- `getTeam(db, slug): { slug, name, club{slug,name}, division{slug,name}, contacts[{name,role,phone,email}], fixtures: FixtureRow[], squad[{slug,name}] } | null`
- `getPlayerProfile(db, slug): { player{slug,name}, club{slug,name}, rankings[{division{slug,name},rank,rankingScore,rubbersWon,rubbersPlayed}], matchHistory[{fixtureId,date,division{slug,name},partners[{slug,name}],opponents[{slug,name}],sets[{home,away}]}] } | null`
- `getClubDetail(db, slug): { slug, name, address, postcode, lat, lng, teams[{slug,name,division{slug,name}}] } | null`

---

### Task 1: Scaffold `apps/web` (config, DB singleton, layout, test harness)

**Files (all new):**
- `apps/web/package.json`
- `apps/web/svelte.config.js`
- `apps/web/vite.config.ts`
- `apps/web/tsconfig.json`
- `apps/web/vitest.config.ts`
- `apps/web/.gitignore`
- `apps/web/src/app.html`
- `apps/web/src/app.css`
- `apps/web/src/app.d.ts`
- `apps/web/src/lib/server/db.ts`
- `apps/web/src/lib/format.ts`
- `apps/web/src/lib/format.test.ts`
- `apps/web/src/routes/+layout.svelte`
- `apps/web/static/.gitkeep`

**Context:** This task stands up the whole project skeleton deterministically (no interactive scaffolder), proves the build and the Vitest harness with one pure-helper test, and establishes the DB singleton + root layout. Every later page task just adds three files.

- [ ] **Step 1: Create the workspace package.json**

Create `apps/web/package.json`:

```json
{
  "name": "@ctl/web",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite dev",
    "build": "vite build",
    "preview": "vite preview",
    "check": "svelte-kit sync && svelte-check --tsconfig ./tsconfig.json",
    "test": "vitest run"
  },
  "dependencies": {
    "@ctl/data": "workspace:*",
    "@ctl/db": "workspace:*"
  },
  "devDependencies": {
    "@sveltejs/adapter-node": "^5.2.0",
    "@sveltejs/kit": "^2.8.0",
    "@sveltejs/vite-plugin-svelte": "^4.0.0",
    "svelte": "^5.1.0",
    "svelte-check": "^4.0.0",
    "typescript": "^5.6.2",
    "vite": "^5.4.0",
    "vitest": "^2.1.0"
  }
}
```

- [ ] **Step 2: Create the SvelteKit + Vite + TS config**

Create `apps/web/svelte.config.js`:

```js
import adapter from '@sveltejs/adapter-node';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** @type {import('@sveltejs/kit').Config} */
const config = {
  preprocess: vitePreprocess(),
  kit: {
    adapter: adapter(),
  },
};

export default config;
```

Create `apps/web/vite.config.ts`:

```ts
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [sveltekit()],
});
```

Create `apps/web/tsconfig.json`:

```json
{
  "extends": "./.svelte-kit/tsconfig.json",
  "compilerOptions": {
    "allowJs": true,
    "checkJs": true,
    "esModuleInterop": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "skipLibCheck": true,
    "sourceMap": true,
    "strict": true,
    "moduleResolution": "bundler"
  }
}
```

Create `apps/web/vitest.config.ts` (a standalone Vitest config that resolves `$lib` without the full SvelteKit plugin — our unit tests never import `$app`/`$env` runtime modules, only `$lib` and real packages):

```ts
import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  test: {
    globals: false,
    environment: 'node',
  },
  resolve: {
    alias: {
      $lib: fileURLToPath(new URL('./src/lib', import.meta.url)),
    },
  },
});
```

Create `apps/web/.gitignore`:

```
.svelte-kit/
build/
node_modules/
```

- [ ] **Step 3: Create app shell files**

Create `apps/web/src/app.html`:

```html
<!doctype html>
<html lang="en-GB">
  <head>
    <meta charset="utf-8" />
    <link rel="icon" href="%sveltekit.assets%/favicon.ico" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    %sveltekit.head%
  </head>
  <body data-sveltekit-preload-data="hover">
    <div style="display: contents">%sveltekit.body%</div>
  </body>
</html>
```

Create `apps/web/src/app.d.ts`:

```ts
// See https://svelte.dev/docs/kit/types#app.d.ts
declare global {
  namespace App {}
}

export {};
```

Create `apps/web/src/app.css`:

```css
:root {
  --green: #0f5132;
  --green-light: #f3f4f6;
  --border: #e5e7eb;
  --muted: #6b7280;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
}
* { box-sizing: border-box; }
body { margin: 0; color: #111; background: #fff; line-height: 1.4; }
a { color: var(--green); text-decoration: none; }
a:hover { text-decoration: underline; }
.wrap { max-width: 720px; margin: 0 auto; padding: 0 12px 48px; }
header.site { background: var(--green); color: #fff; padding: 10px 12px; }
header.site .wrap { padding-bottom: 0; display: flex; align-items: baseline; justify-content: space-between; }
header.site a { color: #fff; font-weight: 700; font-size: 18px; }
header.site form { margin: 0; }
header.site select { font-size: 13px; }
nav.crumbs { font-size: 13px; color: var(--muted); padding: 8px 0; }
nav.crumbs a { color: var(--muted); }
h1 { font-size: 20px; margin: 12px 0 4px; }
h2 { font-size: 15px; text-transform: uppercase; color: var(--green); margin: 20px 0 6px; letter-spacing: 0.03em; }
table { width: 100%; border-collapse: collapse; font-size: 14px; }
th, td { text-align: left; padding: 6px 8px; border-top: 1px solid var(--border); }
th { font-size: 11px; text-transform: uppercase; color: var(--muted); border-top: none; }
td.num, th.num { text-align: right; }
.tabs { display: flex; border-bottom: 2px solid var(--green); margin-top: 12px; }
.tabs button { flex: 1; padding: 8px; background: var(--green-light); border: none; font: inherit; font-weight: 600; color: var(--muted); cursor: pointer; }
.tabs button.active { color: var(--green); border-bottom: 3px solid var(--green); background: #fff; }
.list-row { display: flex; justify-content: space-between; padding: 6px 8px; border-top: 1px solid var(--border); font-size: 14px; }
.cards { display: grid; gap: 8px; margin-top: 8px; }
.card { display: block; padding: 12px; border: 1px solid var(--border); border-radius: 8px; }
.card h3 { margin: 0; font-size: 15px; }
.muted { color: var(--muted); }
.rubber { border: 1px solid var(--border); border-radius: 8px; padding: 10px; margin-top: 8px; font-size: 14px; }
.rubber .vs { color: var(--muted); font-size: 12px; margin: 2px 0; }
.score { font-weight: 700; }
```

- [ ] **Step 4: Create the server-only DB singleton**

Create `apps/web/src/lib/server/db.ts`:

```ts
import { createDb, type Database } from '@ctl/db';

let db: Database | undefined;

// Lazy singleton — the pool is created on first use, not at import, so unit
// tests that mock this module never open a connection.
export const getDb = (): Database => {
  if (!db) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error('DATABASE_URL not set');
    db = createDb(url);
  }
  return db;
};
```

- [ ] **Step 5: Create a pure helper + its test (proves the Vitest harness)**

Create `apps/web/src/lib/format.ts`:

```ts
// Format an ISO date (YYYY-MM-DD) as "Thu 23 Apr 2026". Returns the input
// unchanged if it isn't a parseable date.
export const formatDate = (iso: string): string => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return iso;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-GB', {
    weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC',
  });
};

// Group divisions by their group label, preserving Mens → Ladies → Mixed order.
export type Grouped<T> = { group: 'Mens' | 'Ladies' | 'Mixed'; items: T[] }[];
export const groupByDivisionGroup = <T extends { group: 'Mens' | 'Ladies' | 'Mixed' }>(items: T[]): Grouped<T> => {
  const order: Array<'Mens' | 'Ladies' | 'Mixed'> = ['Mens', 'Ladies', 'Mixed'];
  return order
    .map((group) => ({ group, items: items.filter((i) => i.group === group) }))
    .filter((g) => g.items.length > 0);
};
```

Create `apps/web/src/lib/format.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { formatDate, groupByDivisionGroup } from './format.js';

describe('formatDate', () => {
  it('formats an ISO date as a UK day-month-year string', () => {
    expect(formatDate('2026-04-23')).toBe('Thu 23 Apr 2026');
  });
  it('returns the input unchanged when not a date', () => {
    expect(formatDate('not-a-date')).toBe('not-a-date');
  });
});

describe('groupByDivisionGroup', () => {
  it('groups in Mens, Ladies, Mixed order and drops empty groups', () => {
    const result = groupByDivisionGroup([
      { group: 'Mixed', slug: 'mx1' },
      { group: 'Mens', slug: 'm1' },
      { group: 'Mens', slug: 'm2' },
    ]);
    expect(result.map((g) => g.group)).toEqual(['Mens', 'Mixed']);
    expect(result[0]?.items.map((i) => i.slug)).toEqual(['m1', 'm2']);
  });
});
```

- [ ] **Step 6: Create the root layout (header + breadcrumb slot)**

Create `apps/web/src/routes/+layout.svelte`:

```svelte
<script lang="ts">
  import '../app.css';
  let { children } = $props();
</script>

<header class="site">
  <div class="wrap">
    <a href="/">Calderdale Tennis League</a>
  </div>
</header>
<main class="wrap">
  {@render children()}
</main>
```

- [ ] **Step 7: Create the static dir placeholder**

Create `apps/web/static/.gitkeep` (empty file).

- [ ] **Step 8: Install, sync, build, test**

Run from the repo root:

```bash
pnpm install
pnpm --filter @ctl/web exec svelte-kit sync
pnpm --filter @ctl/web run test
pnpm --filter @ctl/web run build
```

Expected: `pnpm install` resolves the new workspace; `svelte-kit sync` generates `.svelte-kit/`; the format test passes (4 assertions); the build produces `apps/web/build/`. If `pnpm install` reports a peer-dependency conflict, report it as DONE_WITH_CONCERNS with the exact versions rather than forcing — the controller will pin compatible versions.

- [ ] **Step 9: Commit**

```bash
git add apps/web pnpm-lock.yaml
git commit -m "feat(web): scaffold SvelteKit app with db singleton, layout, helpers"
```

---

### Task 2: Home page

**Files:**
- Create: `apps/web/src/routes/+page.server.ts`
- Create: `apps/web/src/routes/+page.svelte`
- Create: `apps/web/src/routes/page.server.test.ts`

**Context:** Entry point — current season + its divisions grouped Mens/Ladies/Mixed as tappable cards. If there's no current season the page renders an empty-state message (not a 404 — the site can be freshly migrated).

- [ ] **Step 1: Write the failing load test**

Create `apps/web/src/routes/page.server.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('$lib/server/db', () => ({ getDb: () => ({}) }));
vi.mock('@ctl/data', () => ({
  getCurrentSeason: vi.fn(),
  listSeasons: vi.fn(),
  listDivisions: vi.fn(),
}));

import { load } from './+page.server.js';
import { getCurrentSeason, listSeasons, listDivisions } from '@ctl/data';

describe('home load', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('returns null season + empty groups when no current season', async () => {
    vi.mocked(getCurrentSeason).mockResolvedValue(null);
    vi.mocked(listSeasons).mockResolvedValue([]);
    const result = await load({} as never);
    expect(result.currentSeason).toBeNull();
    expect(result.groups).toEqual([]);
  });

  it('groups the current season divisions Mens/Ladies/Mixed', async () => {
    vi.mocked(getCurrentSeason).mockResolvedValue({ id: 1, slug: 'summer-2026', name: 'Summer 2026', current: true });
    vi.mocked(listSeasons).mockResolvedValue([{ id: 1, slug: 'summer-2026', name: 'Summer 2026', current: true }]);
    vi.mocked(listDivisions).mockResolvedValue([
      { id: 10, slug: 'mens-1', name: 'Mens Division 1', group: 'Mens', seasonId: 1 },
      { id: 11, slug: 'ladies-1', name: 'Ladies Division 1', group: 'Ladies', seasonId: 1 },
    ]);
    const result = await load({} as never);
    expect(result.currentSeason?.slug).toBe('summer-2026');
    expect(result.groups.map((g) => g.group)).toEqual(['Mens', 'Ladies']);
    expect(vi.mocked(listDivisions)).toHaveBeenCalledWith({}, 1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @ctl/web exec vitest run src/routes/page.server.test.ts`
Expected: FAIL (module `./+page.server.js` not found).

- [ ] **Step 3: Implement the load**

Create `apps/web/src/routes/+page.server.ts`:

```ts
import { getCurrentSeason, listSeasons, listDivisions } from '@ctl/data';
import { getDb } from '$lib/server/db';
import { groupByDivisionGroup } from '$lib/format';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
  const db = getDb();
  const currentSeason = await getCurrentSeason(db);
  const seasons = await listSeasons(db);
  const divisions = currentSeason ? await listDivisions(db, currentSeason.id) : [];
  return { currentSeason, seasons, groups: groupByDivisionGroup(divisions) };
};
```

- [ ] **Step 4: Implement the page**

Create `apps/web/src/routes/+page.svelte`:

```svelte
<script lang="ts">
  let { data } = $props();
</script>

{#if data.currentSeason}
  <h1>{data.currentSeason.name}</h1>
  {#each data.groups as group (group.group)}
    <h2>{group.group}</h2>
    <div class="cards">
      {#each group.items as division (division.slug)}
        <a class="card" href="/divisions/{division.slug}">
          <h3>{division.name}</h3>
        </a>
      {/each}
    </div>
  {/each}
{:else}
  <h1>No current season</h1>
  <p class="muted">The database has no season marked current. Run a scrape to populate it.</p>
{/if}
```

- [ ] **Step 5: Run test + check**

Run: `pnpm --filter @ctl/web exec vitest run src/routes/page.server.test.ts`
Expected: 2 passed.

Run: `pnpm --filter @ctl/web run check`
Expected: 0 errors.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/routes/+page.server.ts apps/web/src/routes/+page.svelte apps/web/src/routes/page.server.test.ts
git commit -m "feat(web): home page with current season divisions"
```

---

### Task 3: Division page (tabbed)

**Files:**
- Create: `apps/web/src/routes/divisions/[slug]/+page.server.ts`
- Create: `apps/web/src/routes/divisions/[slug]/+page.svelte`
- Create: `apps/web/src/routes/divisions/[slug]/page.server.test.ts`

**Context:** The core screen. Tabs (Standings / Fixtures & Results / Rankings) via Svelte 5 `$state` — all three data sets are server-rendered into the HTML; the tab state just toggles visibility. 404 when the slug is unknown.

- [ ] **Step 1: Write the failing load test**

Create `apps/web/src/routes/divisions/[slug]/page.server.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('$lib/server/db', () => ({ getDb: () => ({}) }));
vi.mock('@ctl/data', () => ({
  getDivisionTable: vi.fn(),
  listFixturesByDivision: vi.fn(),
  getRankingsByDivision: vi.fn(),
}));

import { load } from './+page.server.js';
import { getDivisionTable, listFixturesByDivision, getRankingsByDivision } from '@ctl/data';

const ev = (slug: string) => ({ params: { slug } }) as never;

describe('division load', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('throws 404 when the division is unknown', async () => {
    vi.mocked(getDivisionTable).mockResolvedValue(null);
    await expect(load(ev('nope'))).rejects.toMatchObject({ status: 404 });
  });

  it('returns table, fixtures and rankings for a known division', async () => {
    vi.mocked(getDivisionTable).mockResolvedValue({
      division: { id: 8, slug: 'mens-1', name: 'Mens Division 1', group: 'Mens', seasonId: 1 },
      rows: [],
    });
    vi.mocked(listFixturesByDivision).mockResolvedValue([]);
    vi.mocked(getRankingsByDivision).mockResolvedValue([]);
    const result = await load(ev('mens-1'));
    expect(result.table.division.slug).toBe('mens-1');
    expect(vi.mocked(listFixturesByDivision)).toHaveBeenCalledWith({}, 8);
    expect(vi.mocked(getRankingsByDivision)).toHaveBeenCalledWith({}, 8);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @ctl/web exec vitest run src/routes/divisions/[slug]/page.server.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement the load**

Create `apps/web/src/routes/divisions/[slug]/+page.server.ts`:

```ts
import { error } from '@sveltejs/kit';
import { getDivisionTable, listFixturesByDivision, getRankingsByDivision } from '@ctl/data';
import { getDb } from '$lib/server/db';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params }) => {
  const db = getDb();
  const table = await getDivisionTable(db, params.slug);
  if (!table) throw error(404, 'Division not found');
  const [fixtures, rankings] = await Promise.all([
    listFixturesByDivision(db, table.division.id),
    getRankingsByDivision(db, table.division.id),
  ]);
  return { table, fixtures, rankings };
};
```

- [ ] **Step 4: Implement the page**

Create `apps/web/src/routes/divisions/[slug]/+page.svelte`:

```svelte
<script lang="ts">
  import { formatDate } from '$lib/format';
  let { data } = $props();
  let tab = $state<'standings' | 'fixtures' | 'rankings'>('standings');
</script>

<nav class="crumbs"><a href="/">Home</a> › {data.table.division.name}</nav>
<h1>{data.table.division.name}</h1>

<div class="tabs">
  <button class:active={tab === 'standings'} onclick={() => (tab = 'standings')}>Standings</button>
  <button class:active={tab === 'fixtures'} onclick={() => (tab = 'fixtures')}>Fixtures</button>
  <button class:active={tab === 'rankings'} onclick={() => (tab = 'rankings')}>Rankings</button>
</div>

{#if tab === 'standings'}
  <table>
    <thead>
      <tr><th>#</th><th>Team</th><th class="num">Recd</th><th class="num">Won</th><th class="num">Lost</th></tr>
    </thead>
    <tbody>
      {#each data.table.rows as row (row.teamId)}
        <tr>
          <td>{row.position}</td>
          <td><a href="/teams/{row.teamSlug}">{row.teamName}</a></td>
          <td class="num">{row.resultsReceived}/{row.resultsTotal}</td>
          <td class="num">{row.pointsWon}</td>
          <td class="num">{row.pointsLost}</td>
        </tr>
      {/each}
    </tbody>
  </table>
{:else if tab === 'fixtures'}
  {#each data.fixtures as f (f.id)}
    <div class="list-row">
      <span>
        <span class="muted">{formatDate(f.date)}</span>
        <a href="/teams/{f.homeTeam.slug}">{f.homeTeam.name}</a>
        {#if f.score}<span class="score"> {f.score.home}–{f.score.away} </span>{:else}<span class="muted"> v </span>{/if}
        <a href="/teams/{f.awayTeam.slug}">{f.awayTeam.name}</a>
      </span>
      {#if f.hasCard}<a href="/matches/{f.id}">card →</a>{/if}
    </div>
  {/each}
{:else}
  <table>
    <thead><tr><th>#</th><th>Player</th><th class="num">Score</th></tr></thead>
    <tbody>
      {#each data.rankings as r (r.playerId)}
        <tr><td>{r.rank}</td><td>{r.playerName}</td><td class="num">{r.rankingScore}</td></tr>
      {/each}
    </tbody>
  </table>
{/if}
```

(Pinned against the real `getRankingsByDivision` shape: `RankingRow = { rank, playerId, playerName, rubbersWon, rubbersPlayed, gamesWon, gamesPlayed, rankingScore, movement }` — there is **no** `playerSlug`. So the rankings tab renders `r.playerName` as plain text, keyed by `r.playerId`, exactly as the component above does. Player names are NOT links on this tab — a known v1 limitation; player pages are reachable from the match-card and team pages, which do carry slugs. Do not invent a `playerSlug` field.)

- [ ] **Step 5: Run test + check**

Run: `pnpm --filter @ctl/web exec vitest run src/routes/divisions/[slug]/page.server.test.ts`
Expected: 2 passed.

Run: `pnpm --filter @ctl/web run check`
Expected: 0 errors.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/routes/divisions
git commit -m "feat(web): tabbed division page (standings, fixtures, rankings)"
```

---

### Task 4: Match-card page

**Files:**
- Create: `apps/web/src/routes/matches/[id]/+page.server.ts`
- Create: `apps/web/src/routes/matches/[id]/+page.svelte`
- Create: `apps/web/src/routes/matches/[id]/page.server.test.ts`

**Context:** One fixture's full card. `[id]` is the DB `fixtures.id` (numeric). 404 when no card. Each rubber shows the two pairs and their set scores.

- [ ] **Step 1: Write the failing load test**

Create `apps/web/src/routes/matches/[id]/page.server.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('$lib/server/db', () => ({ getDb: () => ({}) }));
vi.mock('@ctl/data', () => ({ getMatchCard: vi.fn() }));

import { load } from './+page.server.js';
import { getMatchCard } from '@ctl/data';

const ev = (id: string) => ({ params: { id } }) as never;

describe('match-card load', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('throws 404 for a non-numeric id', async () => {
    await expect(load(ev('abc'))).rejects.toMatchObject({ status: 404 });
    expect(vi.mocked(getMatchCard)).not.toHaveBeenCalled();
  });

  it('throws 404 when no card exists', async () => {
    vi.mocked(getMatchCard).mockResolvedValue(null);
    await expect(load(ev('123'))).rejects.toMatchObject({ status: 404 });
    expect(vi.mocked(getMatchCard)).toHaveBeenCalledWith({}, 123);
  });

  it('returns the card for a valid id', async () => {
    vi.mocked(getMatchCard).mockResolvedValue({
      fixture: { id: 123, date: '2026-04-23', division: { slug: 'mens-1', name: 'Mens Division 1' },
        homeTeam: { slug: 'h', name: 'H' }, awayTeam: { slug: 'a', name: 'A' }, score: { home: '6', away: '3' } },
      rubbers: [],
    });
    const result = await load(ev('123'));
    expect(result.card.fixture.id).toBe(123);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @ctl/web exec vitest run src/routes/matches/[id]/page.server.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement the load**

Create `apps/web/src/routes/matches/[id]/+page.server.ts`:

```ts
import { error } from '@sveltejs/kit';
import { getMatchCard } from '@ctl/data';
import { getDb } from '$lib/server/db';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params }) => {
  const id = Number(params.id);
  if (!Number.isInteger(id) || id <= 0) throw error(404, 'Match not found');
  const card = await getMatchCard(getDb(), id);
  if (!card) throw error(404, 'Match card not found');
  return { card };
};
```

- [ ] **Step 4: Implement the page**

Create `apps/web/src/routes/matches/[id]/+page.svelte`:

```svelte
<script lang="ts">
  import { formatDate } from '$lib/format';
  let { data } = $props();
  const fx = data.card.fixture;
</script>

<nav class="crumbs">
  <a href="/">Home</a> › <a href="/divisions/{fx.division.slug}">{fx.division.name}</a> › Match
</nav>
<h1>
  <a href="/teams/{fx.homeTeam.slug}">{fx.homeTeam.name}</a>
  {#if fx.score}<span class="score">{fx.score.home}–{fx.score.away}</span>{:else}v{/if}
  <a href="/teams/{fx.awayTeam.slug}">{fx.awayTeam.name}</a>
</h1>
<p class="muted">{formatDate(fx.date)}</p>

{#each data.card.rubbers as rubber (rubber.orderInCard)}
  <div class="rubber">
    <div>{#each rubber.homePlayers as p, i (p.slug)}{i > 0 ? ' & ' : ''}<a href="/players/{p.slug}">{p.name}</a>{/each}</div>
    <div class="vs">vs</div>
    <div>{#each rubber.awayPlayers as p, i (p.slug)}{i > 0 ? ' & ' : ''}<a href="/players/{p.slug}">{p.name}</a>{/each}</div>
    <div class="score">{#each rubber.sets as s, i (i)}{i > 0 ? ', ' : ''}{s.home}-{s.away}{/each}</div>
  </div>
{/each}
```

- [ ] **Step 5: Run test + check**

Run: `pnpm --filter @ctl/web exec vitest run src/routes/matches/[id]/page.server.test.ts`
Expected: 3 passed.

Run: `pnpm --filter @ctl/web run check`
Expected: 0 errors.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/routes/matches
git commit -m "feat(web): match-card detail page"
```

---

### Task 5: Club page

**Files:**
- Create: `apps/web/src/routes/clubs/[slug]/+page.server.ts`
- Create: `apps/web/src/routes/clubs/[slug]/+page.svelte`
- Create: `apps/web/src/routes/clubs/[slug]/page.server.test.ts`

**Context:** Club + address/postcode (text + external maps link) + its teams. 404 on unknown slug.

- [ ] **Step 1: Write the failing load test**

Create `apps/web/src/routes/clubs/[slug]/page.server.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('$lib/server/db', () => ({ getDb: () => ({}) }));
vi.mock('@ctl/data', () => ({ getClubDetail: vi.fn() }));

import { load } from './+page.server.js';
import { getClubDetail } from '@ctl/data';

const ev = (slug: string) => ({ params: { slug } }) as never;

describe('club load', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('throws 404 when the club is unknown', async () => {
    vi.mocked(getClubDetail).mockResolvedValue(null);
    await expect(load(ev('nope'))).rejects.toMatchObject({ status: 404 });
  });

  it('returns the club for a known slug', async () => {
    vi.mocked(getClubDetail).mockResolvedValue({
      slug: 'cragg-vale', name: 'Cragg Vale', address: 'Hinchcliffe Arms', postcode: 'HX7 5TA',
      lat: '53.7', lng: '-2.0', teams: [],
    });
    const result = await load(ev('cragg-vale'));
    expect(result.club.postcode).toBe('HX7 5TA');
    expect(vi.mocked(getClubDetail)).toHaveBeenCalledWith({}, 'cragg-vale');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @ctl/web exec vitest run src/routes/clubs/[slug]/page.server.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement the load**

Create `apps/web/src/routes/clubs/[slug]/+page.server.ts`:

```ts
import { error } from '@sveltejs/kit';
import { getClubDetail } from '@ctl/data';
import { getDb } from '$lib/server/db';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params }) => {
  const club = await getClubDetail(getDb(), params.slug);
  if (!club) throw error(404, 'Club not found');
  return { club };
};
```

- [ ] **Step 4: Implement the page**

Create `apps/web/src/routes/clubs/[slug]/+page.svelte`:

```svelte
<script lang="ts">
  let { data } = $props();
  const c = data.club;
  const mapsQuery = encodeURIComponent([c.address, c.postcode].filter(Boolean).join(', '));
</script>

<nav class="crumbs"><a href="/">Home</a> › {c.name}</nav>
<h1>{c.name}</h1>

{#if c.address || c.postcode}
  <p>
    {#if c.address}{c.address}{/if}{#if c.postcode}{c.address ? ', ' : ''}{c.postcode}{/if}
    {#if mapsQuery}<br /><a href="https://www.google.com/maps/search/?api=1&query={mapsQuery}" target="_blank" rel="noopener">Open in Maps</a>{/if}
  </p>
{/if}

<h2>Teams</h2>
<div class="cards">
  {#each c.teams as team (team.slug)}
    <a class="card" href="/teams/{team.slug}">
      <h3>{team.name}</h3>
      <span class="muted">{team.division.name}</span>
    </a>
  {/each}
</div>
```

- [ ] **Step 5: Run test + check**

Run: `pnpm --filter @ctl/web exec vitest run src/routes/clubs/[slug]/page.server.test.ts`
Expected: 2 passed.

Run: `pnpm --filter @ctl/web run check`
Expected: 0 errors.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/routes/clubs
git commit -m "feat(web): club page with location and teams"
```

---

### Task 6: Team page

**Files:**
- Create: `apps/web/src/routes/teams/[slug]/+page.server.ts`
- Create: `apps/web/src/routes/teams/[slug]/+page.svelte`
- Create: `apps/web/src/routes/teams/[slug]/page.server.test.ts`

**Context:** Team + club + division, contacts, fixtures, best-effort squad (labelled "players seen this season"). 404 on unknown slug.

- [ ] **Step 1: Write the failing load test**

Create `apps/web/src/routes/teams/[slug]/page.server.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('$lib/server/db', () => ({ getDb: () => ({}) }));
vi.mock('@ctl/data', () => ({ getTeam: vi.fn() }));

import { load } from './+page.server.js';
import { getTeam } from '@ctl/data';

const ev = (slug: string) => ({ params: { slug } }) as never;

describe('team load', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('throws 404 when the team is unknown', async () => {
    vi.mocked(getTeam).mockResolvedValue(null);
    await expect(load(ev('nope'))).rejects.toMatchObject({ status: 404 });
  });

  it('returns the team for a known slug', async () => {
    vi.mocked(getTeam).mockResolvedValue({
      slug: 'cragg-vale-a', name: 'Cragg Vale A',
      club: { slug: 'cragg-vale', name: 'Cragg Vale' }, division: { slug: 'mens-1', name: 'Mens Division 1' },
      contacts: [], fixtures: [], squad: [],
    });
    const result = await load(ev('cragg-vale-a'));
    expect(result.team.name).toBe('Cragg Vale A');
    expect(vi.mocked(getTeam)).toHaveBeenCalledWith({}, 'cragg-vale-a');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @ctl/web exec vitest run src/routes/teams/[slug]/page.server.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement the load**

Create `apps/web/src/routes/teams/[slug]/+page.server.ts`:

```ts
import { error } from '@sveltejs/kit';
import { getTeam } from '@ctl/data';
import { getDb } from '$lib/server/db';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params }) => {
  const team = await getTeam(getDb(), params.slug);
  if (!team) throw error(404, 'Team not found');
  return { team };
};
```

- [ ] **Step 4: Implement the page**

Create `apps/web/src/routes/teams/[slug]/+page.svelte`:

```svelte
<script lang="ts">
  import { formatDate } from '$lib/format';
  let { data } = $props();
  const t = data.team;
</script>

<nav class="crumbs">
  <a href="/">Home</a> › <a href="/divisions/{t.division.slug}">{t.division.name}</a> › {t.name}
</nav>
<h1>{t.name}</h1>
<p class="muted"><a href="/clubs/{t.club.slug}">{t.club.name}</a> · {t.division.name}</p>

{#if t.contacts.length}
  <h2>Contacts</h2>
  {#each t.contacts as contact (contact.name)}
    <div class="list-row">
      <span>{contact.name}{#if contact.role} <span class="muted">· {contact.role}</span>{/if}</span>
      <span class="muted">{contact.phone ?? ''}{contact.phone && contact.email ? ' · ' : ''}{contact.email ?? ''}</span>
    </div>
  {/each}
{/if}

<h2>Fixtures & Results</h2>
{#each t.fixtures as f (f.id)}
  <div class="list-row">
    <span>
      <span class="muted">{formatDate(f.date)}</span>
      <a href="/teams/{f.homeTeam.slug}">{f.homeTeam.name}</a>
      {#if f.score}<span class="score"> {f.score.home}–{f.score.away} </span>{:else}<span class="muted"> v </span>{/if}
      <a href="/teams/{f.awayTeam.slug}">{f.awayTeam.name}</a>
    </span>
    {#if f.hasCard}<a href="/matches/{f.id}">card →</a>{/if}
  </div>
{/each}

{#if t.squad.length}
  <h2>Players seen this season</h2>
  <div class="cards">
    {#each t.squad as p (p.slug)}<a class="card" href="/players/{p.slug}"><h3>{p.name}</h3></a>{/each}
  </div>
{/if}
```

- [ ] **Step 5: Run test + check**

Run: `pnpm --filter @ctl/web exec vitest run src/routes/teams/[slug]/page.server.test.ts`
Expected: 2 passed.

Run: `pnpm --filter @ctl/web run check`
Expected: 0 errors.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/routes/teams
git commit -m "feat(web): team page with contacts, fixtures, squad"
```

---

### Task 7: Player page

**Files:**
- Create: `apps/web/src/routes/players/[slug]/+page.server.ts`
- Create: `apps/web/src/routes/players/[slug]/+page.svelte`
- Create: `apps/web/src/routes/players/[slug]/page.server.test.ts`

**Context:** Player + club, rankings across divisions, match history (linking to match cards). 404 on unknown slug.

- [ ] **Step 1: Write the failing load test**

Create `apps/web/src/routes/players/[slug]/page.server.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('$lib/server/db', () => ({ getDb: () => ({}) }));
vi.mock('@ctl/data', () => ({ getPlayerProfile: vi.fn() }));

import { load } from './+page.server.js';
import { getPlayerProfile } from '@ctl/data';

const ev = (slug: string) => ({ params: { slug } }) as never;

describe('player load', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('throws 404 when the player is unknown', async () => {
    vi.mocked(getPlayerProfile).mockResolvedValue(null);
    await expect(load(ev('nope'))).rejects.toMatchObject({ status: 404 });
  });

  it('returns the profile for a known slug', async () => {
    vi.mocked(getPlayerProfile).mockResolvedValue({
      player: { slug: 'me', name: 'Me Player' }, club: { slug: 'c', name: 'C' },
      rankings: [], matchHistory: [],
    });
    const result = await load(ev('me'));
    expect(result.profile.player.name).toBe('Me Player');
    expect(vi.mocked(getPlayerProfile)).toHaveBeenCalledWith({}, 'me');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @ctl/web exec vitest run src/routes/players/[slug]/page.server.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement the load**

Create `apps/web/src/routes/players/[slug]/+page.server.ts`:

```ts
import { error } from '@sveltejs/kit';
import { getPlayerProfile } from '@ctl/data';
import { getDb } from '$lib/server/db';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params }) => {
  const profile = await getPlayerProfile(getDb(), params.slug);
  if (!profile) throw error(404, 'Player not found');
  return { profile };
};
```

- [ ] **Step 4: Implement the page**

Create `apps/web/src/routes/players/[slug]/+page.svelte`:

```svelte
<script lang="ts">
  import { formatDate } from '$lib/format';
  let { data } = $props();
  const p = data.profile;
</script>

<nav class="crumbs"><a href="/">Home</a> › {p.player.name}</nav>
<h1>{p.player.name}</h1>
<p class="muted"><a href="/clubs/{p.club.slug}">{p.club.name}</a></p>

{#if p.rankings.length}
  <h2>Rankings</h2>
  <table>
    <thead><tr><th>Division</th><th class="num">Rank</th><th class="num">Score</th></tr></thead>
    <tbody>
      {#each p.rankings as r (r.division.slug)}
        <tr>
          <td><a href="/divisions/{r.division.slug}">{r.division.name}</a></td>
          <td class="num">{r.rank}</td>
          <td class="num">{r.rankingScore}</td>
        </tr>
      {/each}
    </tbody>
  </table>
{/if}

{#if p.matchHistory.length}
  <h2>Match history</h2>
  {#each p.matchHistory as m (m.fixtureId)}
    <div class="rubber">
      <div>
        <span class="muted">{formatDate(m.date)} · {m.division.name}</span>
        {#if m.sets.length}<span class="score"> {#each m.sets as s, i (i)}{i > 0 ? ', ' : ''}{s.home}-{s.away}{/each}</span>{/if}
        <a href="/matches/{m.fixtureId}">card →</a>
      </div>
      <div class="vs">
        with {#each m.partners as pp, i (pp.slug)}{i > 0 ? ', ' : ''}<a href="/players/{pp.slug}">{pp.name}</a>{:else}—{/each}
        · v {#each m.opponents as op, i (op.slug)}{i > 0 ? ', ' : ''}<a href="/players/{op.slug}">{op.name}</a>{/each}
      </div>
    </div>
  {/each}
{/if}
```

- [ ] **Step 5: Run test + check**

Run: `pnpm --filter @ctl/web exec vitest run src/routes/players/[slug]/page.server.test.ts`
Expected: 2 passed.

Run: `pnpm --filter @ctl/web run check`
Expected: 0 errors.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/routes/players
git commit -m "feat(web): player page with rankings and match history"
```

---

### Task 8: Full verification + push

**Files:** none (build/check/git/bd)

- [ ] **Step 1: Full check + build + web tests**

Run:

```bash
pnpm --filter @ctl/web run check
pnpm --filter @ctl/web run test
pnpm --filter @ctl/web run build
```

Expected: `check` 0 errors; `test` all web unit tests pass (format + 6 load test files); `build` produces `apps/web/build/`.

- [ ] **Step 2: Repo-wide test suite**

Run: `pnpm test`
Expected: all pass — the new `apps/web` tests are picked up by the root vitest workspace alongside the 191 data/scraper tests. If the root vitest tries to run the SvelteKit `$lib`-aliased tests and can't resolve `$lib`, exclude `apps/web` from the root vitest config (it has its own `test` script) — add `exclude: ['**/node_modules/**', 'apps/web/**']` to the root `vitest.config.ts`'s `test` block, and note that `pnpm --filter @ctl/web run test` is the web suite's entry point. Commit that change with the others.

- [ ] **Step 3: Manual smoke against the live dev DB (optional but recommended)**

```bash
docker ps --filter name=ctl-db-dev --format '{{.Names}}'   # ensure dev DB is up; if not: pnpm db:dev && pnpm db:migrate
DATABASE_URL=postgres://ctl:ctl@localhost:5433/ctl pnpm --filter @ctl/web run dev
```

Open `http://localhost:5173`, click through: home → a division → its tabs → a match card → a team → a player → a club. Confirm real data renders. Ctrl-C when done.

- [ ] **Step 4: Push**

```bash
git pull --rebase
git push
git status   # MUST show "up to date with origin"
```

- [ ] **Step 5: bd housekeeping**

```bash
bd dolt start   # if needed
bd create --type=feature --priority=2 \
  --title="Web viewer — SvelteKit app (Plan 2/3) complete" \
  --description="apps/web SvelteKit app: home, division (tabbed), match-card, team, player, club pages, all server-rendered over @ctl/data. Load functions unit-tested (mocked getters + 404 paths). Spec: docs/superpowers/specs/2026-06-13-web-viewer-design.md. Next: Plan 3 (docker/compose/GHCR/Tailscale)."
```

---

## Post-implementation

After this plan: a working, type-checked, server-rendered viewer runnable with `pnpm --filter @ctl/web run dev` against the live DB. Plan 3 packages it as a container in the compose stack and wires `tailscale serve`.
