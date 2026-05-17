# Phase 2: Scraper, Data Layer, Docker-on-SAN — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A working twice-weekly scrape pipeline that walks the upstream Calderdale Tennis League site, parses every public page type, validates with Phase 1's domain schemas, and persists into a PostgreSQL database on the user's SAN. Companion `packages/data` middle tier exposes typed read functions for the Phase 4 web app.

**Architecture:** Three new packages (`packages/db` with Drizzle schemas, `packages/data` with typed read functions, `apps/scraper` orchestrator), extended `packages/parser` (five new fragment parsers + cleanups), and a docker-compose stack (postgres + ofelia + scraper) deployed on a self-hosted SAN. Scraper is a short-lived container fired twice a week by ofelia; reads always go through Postgres via `packages/data`.

**Tech Stack:** TypeScript 5.6, pnpm 9, Vitest, Zod 3, cheerio (refactored imports), Node 24 built-in fetch (undici removed), Drizzle ORM 0.36 + drizzle-kit, postgres-js client, Testcontainers, ofelia, Docker Compose, GitHub Container Registry.

**Spec:** `docs/superpowers/specs/2026-05-17-phase-2-scraper-and-data-layer.md`

---

### Task 1: CSRF spike for fragment endpoints

**Goal:** Empirically verify whether `refreshProtectionCode=0` works for `displayContacts.php`, `displayLocations.php`, and `result_card_*.php` — the three endpoints Phase 1's spike did not cover. The answer dictates whether `http-client.ts` (Task 20) needs session warm-up logic.

**Files:**
- Create: `spike/csrf-fragment-investigation.ts`
- Create: `spike/findings-phase-2.md`

- [ ] **Step 1: Create `spike/csrf-fragment-investigation.ts`**

```typescript
const BASE = 'https://www.calderdale.tennis-league.org/';
const UA = 'CalderdaleLeagueMirror-spike/0.2 (contact: dan.chicot@gmail.com)';

type Probe = { label: string; url: string };

const probes: Probe[] = [
  // displayResults.php — confirmed in Phase 1, sanity baseline
  {
    label: 'displayResults-baseline',
    url: 'https://www.ludus-online.com/displayResults.php?modeID=1&seasonID=1&refreshProtectionCode=0',
  },
  // displayContacts.php — unverified
  {
    label: 'displayContacts-token-zero',
    url: 'https://www.ludus-online.com/displayContacts.php?team_id=1&refreshProtectionCode=0',
  },
  // displayLocations.php — unverified
  {
    label: 'displayLocations-token-zero',
    url: 'https://www.ludus-online.com/displayLocations.php?Mode=html&club_id=1&refreshProtectionCode=0',
  },
  // result_card_*.php — unverified
  {
    label: 'result_card-token-zero',
    url: 'https://www.ludus-online.com/result_card_1.php?fixture_id=1&refreshProtectionCode=0',
  },
];

const probe = async ({ label, url }: Probe) => {
  const res = await fetch(url, {
    headers: { 'User-Agent': UA },
    redirect: 'manual',
  });
  const body = await res.text();
  const hasContent = body.length > 500 && !/login|sign in/i.test(body.slice(0, 1000));
  console.log(`[${label}] status=${res.status} length=${body.length} hasContent=${hasContent}`);
  return { label, status: res.status, length: body.length, hasContent };
};

const main = async () => {
  const results = [];
  for (const p of probes) {
    results.push(await probe(p));
    await new Promise((r) => setTimeout(r, 1000));
  }
  console.log('\nSummary:');
  console.table(results);
};

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

Replace the URL parameters above (`modeID=1`, `team_id=1`, `club_id=1`, `result_card_1.php?fixture_id=1`) with real values discovered from `spike/fragment-urls.md` before running.

- [ ] **Step 2: Run the spike**

Run: `pnpm exec tsx spike/csrf-fragment-investigation.ts`

Look for: every probe returns `status=200` AND `hasContent=true`.

- [ ] **Step 3: Document findings in `spike/findings-phase-2.md`**

```markdown
# Phase 2 CSRF spike — findings (YYYY-MM-DD)

## Probes

| Endpoint | Status | hasContent | Notes |
|---|---|---|---|
| displayResults.php | … | … | baseline (already confirmed in Phase 1) |
| displayContacts.php | … | … | … |
| displayLocations.php | … | … | … |
| result_card_*.php | … | … | … |

## Decision

[ ] Best case: refreshProtectionCode=0 works for all fragments → http-client unchanged from Phase 1's strategy.

[ ] Middle case: one or more fragments require cookie warm-up → http-client.ts (Task 20) adds a one-time GET of the home page at scraper start, captures the cookie, attaches it to all subsequent requests.

[ ] Worst case: fragments require extracting a fresh `refreshProtectionCode` from the home page HTML and injecting it per-URL → http-client.ts adds a token cache + per-URL injection.
```

Fill in the table from your probe output. Tick the one box that matches reality.

- [ ] **Step 4: Commit**

```bash
git add spike/csrf-fragment-investigation.ts spike/findings-phase-2.md
git commit -m "spike: verify CSRF strategy for displayContacts, displayLocations, result_card"
```

> The remaining tasks assume the **best case**. If the spike finds middle or worst case, expand Task 20 (http-client) with the corresponding warm-up / token-injection logic; no other tasks change.

---

### Task 2: Parser cleanups — cheerio import style + undici removal

**Goal:** Address two Phase 1 carry-overs before adding new parsers: migrate `import * as cheerio` → `import { load } from 'cheerio'` (tree-shake friendly), drop `undici` (Node 24 has built-in fetch).

**Files:**
- Modify: `packages/parser/src/parse-clubs-directory.ts`
- Modify: `packages/parser/src/parse-league-table.ts`
- Modify: `packages/parser/src/parse-player-rankings.ts`
- Modify: `packages/parser/src/http.ts`
- Modify: `packages/parser/package.json`
- Modify: `package.json` (root)

- [ ] **Step 1: Migrate cheerio imports**

In each of the three parsers, change:
```typescript
import * as cheerio from 'cheerio';
// …
const $ = cheerio.load(html);
```
to:
```typescript
import { load } from 'cheerio';
// …
const $ = load(html);
```

- [ ] **Step 2: Replace undici with built-in fetch in `packages/parser/src/http.ts`**

```typescript
const USER_AGENT =
  'CalderdaleLeagueMirror/0.2 (contact: dan.chicot@gmail.com; non-affiliated personal mirror)';

type FetchLike = typeof fetch;

export type FetchHtmlOptions = {
  fetch?: FetchLike;
  headers?: Record<string, string>;
};

export const fetchHtml = async (url: string, options: FetchHtmlOptions = {}): Promise<string> => {
  const f = options.fetch ?? fetch;
  const res = await f(url, {
    headers: { 'User-Agent': USER_AGENT, ...(options.headers ?? {}) },
    redirect: 'follow',
  });
  if (res.status !== 200) {
    throw new Error(`fetchHtml: ${res.status} for ${url}`);
  }
  return res.text();
};
```

- [ ] **Step 3: Remove undici from `packages/parser/package.json` dependencies**

Delete the `"undici": "^6.20.0"` line. The dependencies block should leave `cheerio` and `@ctl/domain`.

- [ ] **Step 4: Remove undici from root `package.json` devDependencies**

Delete the `"undici": "^8.x.x"` line if present. The spike script in Task 1 uses built-in fetch, so undici is no longer needed anywhere.

- [ ] **Step 5: Re-install and verify**

Run: `pnpm install`
Expected: lockfile updates, no errors.

Run: `pnpm exec tsc --noEmit`
Expected: clean.

Run: `pnpm test`
Expected: all 26 Phase 1 tests still pass.

- [ ] **Step 6: Commit**

```bash
git add packages/parser/ package.json pnpm-lock.yaml
git commit -m "refactor(parser): migrate to named cheerio import, drop undici for built-in fetch"
```

---

### Task 3: Refactor `parseClubsDirectory` + split page-type detection

**Goal:** Address two more Phase 1 carry-overs:
1. `parseClubsDirectory` currently returns domain `Club[]` (premature canonicalisation); align with the other parsers by returning row types. The scraper (Task 23) will canonicalise.
2. `detectPageType` currently knows only shell URLs; split into `detectShellPageType` + new `detectFragmentType`, with `detectPageType` as the dispatcher.

**Files:**
- Modify: `packages/parser/src/parse-clubs-directory.ts`
- Modify: `packages/parser/tests/parse-clubs-directory.test.ts`
- Modify: `packages/parser/src/page-type.ts`
- Modify: `packages/parser/tests/page-type.test.ts`

- [ ] **Step 1: Update `parseClubsDirectory` tests to expect row types**

Replace the body of `packages/parser/tests/parse-clubs-directory.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseClubsDirectory } from '../src/parse-clubs-directory.js';

const loadFixture = async (name: string) =>
  readFile(resolve(__dirname, '../../../fixtures', name), 'utf8');

describe('parseClubsDirectory', () => {
  it('extracts every club listed in the fixture as raw row types', async () => {
    const html = await loadFixture('clubs-directory.html');
    const rows = parseClubsDirectory(html);

    expect(rows.length).toBeGreaterThan(10);
    for (const row of rows) {
      expect(row.observedName).toBeTypeOf('string');
      expect(row.observedName.length).toBeGreaterThan(0);
      expect(row.slug).toMatch(/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/);
    }
  });

  it('includes the Queens club with a kebab-case slug', async () => {
    const html = await loadFixture('clubs-directory.html');
    const rows = parseClubsDirectory(html);
    const queens = rows.find((r) => /queens/i.test(r.observedName));
    expect(queens).toBeDefined();
    expect(queens?.slug).toBeTypeOf('string');
  });

  it('deduplicates by slug', async () => {
    const html = await loadFixture('clubs-directory.html');
    const rows = parseClubsDirectory(html);
    const slugs = rows.map((r) => r.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });
});
```

- [ ] **Step 2: Run — confirm failure**

Run: `pnpm test packages/parser/tests/parse-clubs-directory.test.ts`
Expected: FAIL — `observedName` property does not exist on the current return type.

- [ ] **Step 3: Refactor `parseClubsDirectory`**

Replace `packages/parser/src/parse-clubs-directory.ts`:

```typescript
import { load } from 'cheerio';
import { slugify } from './helpers.js';

export type ClubsDirectoryRow = {
  observedName: string;
  slug: string;
};

export const parseClubsDirectory = (html: string): ClubsDirectoryRow[] => {
  const $ = load(html);
  const seen = new Map<string, ClubsDirectoryRow>();

  $('a[href*="club_id="], li.club-row, table.clubs tr').each((_, el) => {
    const observedName = $(el).text().trim();
    if (!observedName) return;
    const slug = slugify(observedName);
    if (seen.has(slug)) return;
    seen.set(slug, { observedName, slug });
  });

  return Array.from(seen.values());
};
```

(Adjust the selector to match whatever Phase 1 settled on — preserve the working selector, only change the return shape.)

- [ ] **Step 4: Run — confirm pass**

Run: `pnpm test packages/parser/tests/parse-clubs-directory.test.ts`
Expected: 3 passed.

- [ ] **Step 5: Update `detectPageType` tests for the split**

Replace `packages/parser/tests/page-type.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import {
  detectPageType,
  detectShellPageType,
  detectFragmentType,
} from '../src/page-type.js';

describe('detectShellPageType', () => {
  it('detects clubs directory', () => {
    const url = 'https://www.calderdale.tennis-league.org/?navButtonSelect=Directory&directory_mode=Clubs/Teams&directory_stage=:View%20List';
    expect(detectShellPageType(url)).toBe('clubs-directory');
  });

  it('detects league table from tabIndex=0', () => {
    expect(detectShellPageType('https://www.calderdale.tennis-league.org/?navButtonSelect=Summer%202026&tabIndex=0')).toBe('league-table');
  });

  it('detects player rankings from tabIndex=4', () => {
    expect(detectShellPageType('https://www.calderdale.tennis-league.org/?navButtonSelect=Summer%202026&tabIndex=4')).toBe('player-rankings');
  });

  it('detects season nav from a bare home URL', () => {
    expect(detectShellPageType('https://www.calderdale.tennis-league.org/')).toBe('season-nav');
  });

  it('throws for unknown shell URLs', () => {
    expect(() => detectShellPageType('https://www.calderdale.tennis-league.org/?random=true')).toThrow();
  });
});

describe('detectFragmentType', () => {
  it('detects displayResults', () => {
    expect(detectFragmentType('https://www.ludus-online.com/displayResults.php?modeID=3&seasonID=20')).toBe('fixtures-and-results');
  });

  it('detects displayContacts', () => {
    expect(detectFragmentType('https://www.ludus-online.com/displayContacts.php?team_id=42')).toBe('club-contacts');
  });

  it('detects displayLocations', () => {
    expect(detectFragmentType('https://www.ludus-online.com/displayLocations.php?Mode=html&club_id=42')).toBe('club-location');
  });

  it('detects result_card', () => {
    expect(detectFragmentType('https://www.ludus-online.com/result_card_3.php?fixture_id=999')).toBe('match-card');
  });

  it('throws for unknown fragment URLs', () => {
    expect(() => detectFragmentType('https://www.ludus-online.com/random.php')).toThrow();
  });
});

describe('detectPageType (dispatcher)', () => {
  it('routes shell URLs to detectShellPageType', () => {
    expect(detectPageType('https://www.calderdale.tennis-league.org/?navButtonSelect=Summer%202026&tabIndex=0')).toBe('league-table');
  });

  it('routes ludus-online URLs to detectFragmentType', () => {
    expect(detectPageType('https://www.ludus-online.com/displayResults.php?modeID=3&seasonID=20')).toBe('fixtures-and-results');
  });
});
```

- [ ] **Step 6: Run — confirm failure**

Run: `pnpm test packages/parser/tests/page-type.test.ts`
Expected: FAIL — `detectShellPageType` / `detectFragmentType` not exported.

- [ ] **Step 7: Implement the split**

Replace `packages/parser/src/page-type.ts`:

```typescript
export type ShellPageType = 'clubs-directory' | 'league-table' | 'player-rankings' | 'season-nav';
export type FragmentType = 'fixtures-and-results' | 'club-contacts' | 'club-location' | 'match-card';
export type PageType = ShellPageType | FragmentType;

const SHELL_HOST = 'www.calderdale.tennis-league.org';
const FRAGMENT_HOST = 'www.ludus-online.com';

export const detectShellPageType = (url: string): ShellPageType => {
  const u = new URL(url);
  if (u.host !== SHELL_HOST) {
    throw new Error(`detectShellPageType: not a shell URL: ${url}`);
  }
  const params = u.searchParams;
  const nav = params.get('navButtonSelect');
  const dirMode = params.get('directory_mode');
  const tabIndex = params.get('tabIndex');

  if (!nav && !dirMode && !tabIndex) return 'season-nav';
  if (nav === 'Directory' && dirMode?.startsWith('Clubs/Teams')) return 'clubs-directory';
  if (nav?.startsWith('Summer') || nav?.startsWith('Winter')) {
    if (tabIndex === '0') return 'league-table';
    if (tabIndex === '4') return 'player-rankings';
  }
  throw new Error(`detectShellPageType: cannot classify ${url}`);
};

export const detectFragmentType = (url: string): FragmentType => {
  const u = new URL(url);
  if (u.host !== FRAGMENT_HOST) {
    throw new Error(`detectFragmentType: not a fragment URL: ${url}`);
  }
  const path = u.pathname;
  if (path === '/displayResults.php') return 'fixtures-and-results';
  if (path === '/displayContacts.php') return 'club-contacts';
  if (path === '/displayLocations.php') return 'club-location';
  if (/^\/result_card_\d+\.php$/.test(path)) return 'match-card';
  throw new Error(`detectFragmentType: cannot classify ${url}`);
};

export const detectPageType = (url: string): PageType => {
  const host = new URL(url).host;
  if (host === SHELL_HOST) return detectShellPageType(url);
  if (host === FRAGMENT_HOST) return detectFragmentType(url);
  throw new Error(`detectPageType: unknown host: ${host}`);
};
```

- [ ] **Step 8: Run — confirm pass**

Run: `pnpm test packages/parser/tests/page-type.test.ts`
Expected: all describe blocks pass.

- [ ] **Step 9: Commit**

```bash
git add packages/parser/src/parse-clubs-directory.ts packages/parser/tests/parse-clubs-directory.test.ts packages/parser/src/page-type.ts packages/parser/tests/page-type.test.ts
git commit -m "refactor(parser): return row types from parseClubsDirectory; split page-type detection"
```

---

### Task 4: Capture fixtures for new page types

**Goal:** Save real upstream HTML for every new parser to test against. These are the ground truth for Tasks 5-9.

**Files:**
- Create: `fixtures/season-nav.html`
- Create: `fixtures/fixtures-and-results-mens-div-1.html`
- Create: `fixtures/club-contacts-sample.html`
- Create: `fixtures/club-location-sample.html`
- Create: `fixtures/match-card-sample.html`

- [ ] **Step 1: Capture the season-nav fixture**

```bash
pnpm capture "https://www.calderdale.tennis-league.org/" season-nav
```

Expected: `fixtures/season-nav.html` written, several KB. Open it — confirm it contains the season dropdown (look for the `Summer 2026` / `Winter 2025` / etc. options).

- [ ] **Step 2: Identify real values for fragment URLs**

Open `fixtures/season-nav.html` and `fixtures/league-table-mens-div-1.html` to extract:
- A real `modeID` and `seasonID` for Mens Div 1 (for displayResults.php)
- A real `team_id` (for displayContacts.php) — pick any team
- A real `club_id` (for displayLocations.php) — pick any club
- A real `fixture_id` and `result_card_N` (for match-card.php) — pick any played fixture

Note these values for the next steps.

- [ ] **Step 3: Capture the fixtures-and-results fragment**

```bash
pnpm capture "https://www.ludus-online.com/displayResults.php?modeID=<MENS_DIV_1_MODE_ID>&seasonID=<CURRENT_SEASON_ID>&refreshProtectionCode=0" fixtures-and-results-mens-div-1
```

Expected: fixture written. Open it — confirm it has a list of fixtures with dates and team names.

> If Task 1's spike found the middle/worst case, replace `refreshProtectionCode=0` with the working strategy.

- [ ] **Step 4: Capture the club-contacts fragment**

```bash
pnpm capture "https://www.ludus-online.com/displayContacts.php?team_id=<TEAM_ID>&refreshProtectionCode=0" club-contacts-sample
```

Expected: fixture contains contact name(s), maybe phone/email.

- [ ] **Step 5: Capture the club-location fragment**

```bash
pnpm capture "https://www.ludus-online.com/displayLocations.php?Mode=html&club_id=<CLUB_ID>&refreshProtectionCode=0" club-location-sample
```

Expected: fixture contains a postcode and/or coordinates.

- [ ] **Step 6: Capture the match-card fragment**

```bash
pnpm capture "https://www.ludus-online.com/result_card_<N>.php?fixture_id=<FIXTURE_ID>&refreshProtectionCode=0" match-card-sample
```

Expected: fixture contains player names, set scores, rubber-by-rubber breakdown.

- [ ] **Step 7: Sanity-check every fixture**

For each file, confirm:
- It is not a login wall (no "Please sign in")
- It is not empty / redirected (>500 bytes)
- It contains the kind of content the parser will look for

If any fixture is unusable, refine the URL parameters or revisit the spike.

- [ ] **Step 8: Commit**

```bash
git add fixtures/season-nav.html fixtures/fixtures-and-results-mens-div-1.html fixtures/club-contacts-sample.html fixtures/club-location-sample.html fixtures/match-card-sample.html
git commit -m "chore(fixtures): capture HTML for season-nav and four fragment endpoints"
```

---

### Task 5: Parser — season nav

**Goal:** Discover the list of seasons (current + archive) from the home page so the scraper knows what to walk.

**Files:**
- Create: `packages/parser/src/parse-season-nav.ts`
- Create: `packages/parser/tests/parse-season-nav.test.ts`

- [ ] **Step 1: Inspect `fixtures/season-nav.html`**

Find the season selector — typically a `<select>` with `<option>` children, or a list of anchor links. Identify:
- Which option/anchor is marked as currently selected
- How season names look (e.g. `Summer 2026`, `Winter 2025/26`)
- The URL parameter or value that distinguishes seasons (likely the season text itself, used as `navButtonSelect=Summer%202026`)

- [ ] **Step 2: Write the failing test**

```typescript
import { describe, it, expect } from 'vitest';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseSeasonNav } from '../src/parse-season-nav.js';

const loadFixture = async (name: string) =>
  readFile(resolve(__dirname, '../../../fixtures', name), 'utf8');

describe('parseSeasonNav', () => {
  it('returns at least one season', async () => {
    const html = await loadFixture('season-nav.html');
    const result = parseSeasonNav(html);
    expect(result.seasons.length).toBeGreaterThan(0);
  });

  it('marks exactly one season as current', async () => {
    const html = await loadFixture('season-nav.html');
    const result = parseSeasonNav(html);
    const currents = result.seasons.filter((s) => s.current);
    expect(currents).toHaveLength(1);
    expect(result.current).toEqual(currents[0]);
  });

  it('produces kebab-case slugs for each season', async () => {
    const html = await loadFixture('season-nav.html');
    const result = parseSeasonNav(html);
    for (const s of result.seasons) {
      expect(s.slug).toMatch(/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/);
      expect(s.observedName.length).toBeGreaterThan(0);
    }
  });

  it('includes "Summer" or "Winter" seasons that look real', async () => {
    const html = await loadFixture('season-nav.html');
    const result = parseSeasonNav(html);
    expect(result.seasons.some((s) => /^(Summer|Winter)/.test(s.observedName))).toBe(true);
  });
});
```

- [ ] **Step 3: Run — confirm failure**

Run: `pnpm test packages/parser/tests/parse-season-nav.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement `parseSeasonNav`**

```typescript
import { load } from 'cheerio';
import { slugify } from './helpers.js';

export type SeasonNavRow = {
  observedName: string;
  slug: string;
  current: boolean;
};

export type SeasonNavResult = {
  seasons: SeasonNavRow[];
  current: SeasonNavRow;
};

export const parseSeasonNav = (html: string): SeasonNavResult => {
  const $ = load(html);
  const seen = new Map<string, SeasonNavRow>();

  // Adjust selectors based on Step 1 inspection.
  // Common shape: <select name="navButtonSelect"><option selected>Summer 2026</option>...</select>
  $('select[name="navButtonSelect"] option').each((_, el) => {
    const observedName = $(el).text().trim();
    if (!observedName) return;
    if (!/^(Summer|Winter)\s/.test(observedName)) return;
    const slug = slugify(observedName);
    const current = $(el).attr('selected') !== undefined;
    if (!seen.has(slug)) {
      seen.set(slug, { observedName, slug, current });
    }
  });

  const seasons = Array.from(seen.values());
  const current = seasons.find((s) => s.current);
  if (!current) {
    throw new Error('parseSeasonNav: no season marked as current');
  }
  return { seasons, current };
};
```

- [ ] **Step 5: Iterate until tests pass**

Run: `pnpm test packages/parser/tests/parse-season-nav.test.ts`

Adjust selector / current-detection logic if the real markup uses anchors or a different attribute. The fixture is the source of truth.

- [ ] **Step 6: Commit**

```bash
git add packages/parser/src/parse-season-nav.ts packages/parser/tests/parse-season-nav.test.ts
git commit -m "feat(parser): parse season nav (discovers available seasons + current)"
```

---

### Task 6: Parser — fixtures and results

**Goal:** Parse `displayResults.php` into a list of fixtures with optional results.

**Files:**
- Create: `packages/parser/src/parse-fixtures-and-results.ts`
- Create: `packages/parser/tests/parse-fixtures-and-results.test.ts`

- [ ] **Step 1: Inspect `fixtures/fixtures-and-results-mens-div-1.html`**

Identify:
- The container element for the fixture list (table, list, etc.)
- How a row marks "played" vs "scheduled" (presence of score, "P", "C" markers, link to result card, etc.)
- How dates are formatted (e.g. `Tue 14 May 2026`, `14/05/2026`)
- Where the `fixture_id` lives (likely an attribute on a link, e.g. `<a href="result_card_3.php?fixture_id=999">`)
- How "rearranged", "postponed", "conceded" statuses are displayed (text labels, colour, attribute)

- [ ] **Step 2: Write the failing test**

```typescript
import { describe, it, expect } from 'vitest';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseFixturesAndResults } from '../src/parse-fixtures-and-results.js';

const loadFixture = async (name: string) =>
  readFile(resolve(__dirname, '../../../fixtures', name), 'utf8');

describe('parseFixturesAndResults', () => {
  it('extracts at least one fixture', async () => {
    const html = await loadFixture('fixtures-and-results-mens-div-1.html');
    const rows = parseFixturesAndResults(html);
    expect(rows.length).toBeGreaterThan(0);
  });

  it('every row has ISO date and both team names', async () => {
    const html = await loadFixture('fixtures-and-results-mens-div-1.html');
    const rows = parseFixturesAndResults(html);
    for (const r of rows) {
      expect(r.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(r.homeTeamName.length).toBeGreaterThan(0);
      expect(r.awayTeamName.length).toBeGreaterThan(0);
    }
  });

  it('classifies status using known FixtureStatus values', async () => {
    const html = await loadFixture('fixtures-and-results-mens-div-1.html');
    const rows = parseFixturesAndResults(html);
    const allowed = new Set([
      'scheduled', 'completed', 'postponed', 'unfinished',
      'rearranged-postponed', 'rearranged-unfinished',
      'rubbers-conceded', 'match-conceded',
    ]);
    for (const r of rows) {
      expect(allowed.has(r.status)).toBe(true);
    }
  });

  it('played fixtures expose a fixtureRef (id + result card path)', async () => {
    const html = await loadFixture('fixtures-and-results-mens-div-1.html');
    const rows = parseFixturesAndResults(html);
    const played = rows.filter((r) => r.status === 'completed');
    for (const r of played) {
      expect(r.fixtureRef).toBeDefined();
      expect(typeof r.fixtureRef?.id).toBe('number');
      expect(r.fixtureRef?.id).toBeGreaterThan(0);
      expect(r.fixtureRef?.resultCardUrl).toMatch(/^https:\/\/www\.ludus-online\.com\/result_card_\d+\.php\?fixture_id=\d+/);
    }
  });

  it('played fixtures expose score', async () => {
    const html = await loadFixture('fixtures-and-results-mens-div-1.html');
    const rows = parseFixturesAndResults(html);
    const played = rows.filter((r) => r.status === 'completed');
    for (const r of played) {
      expect(r.score?.home).toBeTypeOf('number');
      expect(r.score?.away).toBeTypeOf('number');
    }
  });
});
```

- [ ] **Step 3: Run — confirm failure**

Run: `pnpm test packages/parser/tests/parse-fixtures-and-results.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement `parseFixturesAndResults`**

```typescript
import { load } from 'cheerio';
import { parseDecimalStrict } from './helpers.js';
import type { FixtureStatus } from '@ctl/domain';

export type FixtureRow = {
  observedDate: string;            // raw upstream text, kept for debugging
  date: string;                    // ISO YYYY-MM-DD
  homeTeamName: string;
  awayTeamName: string;
  status: FixtureStatus;
  score?: { home: number; away: number };
  fixtureRef?: {
    id: number;
    resultCardUrl: string;
  };
};

const MONTHS: Record<string, string> = {
  jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
  jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12',
};

const toIsoDate = (raw: string): string => {
  // Accept "Tue 14 May 2026", "14/05/2026", "14-05-2026"
  const trimmed = raw.trim();
  const dmy = /^(?:\w+\s+)?(\d{1,2})[\s\/\-]+(\w{3,9})[\s\/\-]+(\d{4})$/i.exec(trimmed);
  if (dmy) {
    const day = dmy[1]!.padStart(2, '0');
    const monthRaw = dmy[2]!.toLowerCase().slice(0, 3);
    const month = MONTHS[monthRaw];
    const year = dmy[3]!;
    if (month) return `${year}-${month}-${day}`;
  }
  const numeric = /^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/.exec(trimmed);
  if (numeric) {
    return `${numeric[3]}-${numeric[2]!.padStart(2, '0')}-${numeric[1]!.padStart(2, '0')}`;
  }
  throw new Error(`toIsoDate: cannot parse ${JSON.stringify(raw)}`);
};

const classifyStatus = (statusText: string, hasScore: boolean): FixtureStatus => {
  const t = statusText.toLowerCase();
  if (/match\s*conceded/.test(t)) return 'match-conceded';
  if (/rubbers?\s*conceded/.test(t)) return 'rubbers-conceded';
  if (/rearr.*postponed/.test(t)) return 'rearranged-postponed';
  if (/rearr.*unfinished/.test(t)) return 'rearranged-unfinished';
  if (/postponed/.test(t)) return 'postponed';
  if (/unfinished/.test(t)) return 'unfinished';
  if (hasScore) return 'completed';
  return 'scheduled';
};

export const parseFixturesAndResults = (html: string): FixtureRow[] => {
  const $ = load(html);
  const rows: FixtureRow[] = [];

  // Adjust selector to match the real markup.
  $('table.fixtures tr, table.results tr').each((_, el) => {
    const $row = $(el);
    const cells = $row.find('td');
    if (cells.length < 4) return;

    const observedDate = $(cells[0]!).text().trim();
    if (!observedDate) return;
    const homeTeamName = $(cells[1]!).text().trim();
    const awayTeamName = $(cells[2]!).text().trim();
    if (!homeTeamName || !awayTeamName) return;

    const scoreCell = $(cells[3]!).text().trim();
    const scoreMatch = /^(\d+(?:\.\d+)?)\s*-\s*(\d+(?:\.\d+)?)$/.exec(scoreCell);
    const score = scoreMatch
      ? { home: parseDecimalStrict(scoreMatch[1]!), away: parseDecimalStrict(scoreMatch[2]!) }
      : undefined;

    const statusText = cells.length > 4 ? $(cells[4]!).text().trim() : '';
    const status = classifyStatus(statusText, !!score);

    const resultLink = $row.find('a[href*="result_card_"]').attr('href');
    const fixtureRef = resultLink
      ? (() => {
          const m = /fixture_id=(\d+)/.exec(resultLink);
          if (!m) return undefined;
          const url = resultLink.startsWith('http')
            ? resultLink
            : `https://www.ludus-online.com/${resultLink.replace(/^\//, '')}`;
          return { id: Number(m[1]), resultCardUrl: url };
        })()
      : undefined;

    rows.push({
      observedDate,
      date: toIsoDate(observedDate),
      homeTeamName,
      awayTeamName,
      status,
      ...(score ? { score } : {}),
      ...(fixtureRef ? { fixtureRef } : {}),
    });
  });

  return rows;
};
```

- [ ] **Step 5: Iterate against the fixture**

Run: `pnpm test packages/parser/tests/parse-fixtures-and-results.test.ts`

Tighten the selector, date format handler, and status classification against the real fixture. Edge cases to watch:
- Half-point scores like `6.5-5.5` (already covered by `parseDecimalStrict`)
- Missing scores for scheduled fixtures
- Multi-line cells (use `.text().replace(/\s+/g, ' ').trim()`)

- [ ] **Step 6: Commit**

```bash
git add packages/parser/src/parse-fixtures-and-results.ts packages/parser/tests/parse-fixtures-and-results.test.ts
git commit -m "feat(parser): parse displayResults.php fixtures and results"
```

---

### Task 7: Parser — match card

**Goal:** Parse `result_card_*.php` into a structured set of rubbers with player names, set scores, and ordering.

**Files:**
- Create: `packages/parser/src/parse-match-card.ts`
- Create: `packages/parser/tests/parse-match-card.test.ts`

- [ ] **Step 1: Inspect `fixtures/match-card-sample.html`**

Identify:
- The container for the rubbers list (table, sections, etc.)
- How home/away players are distinguished (column position, label, colour)
- How doubles rubbers (two players each side) are marked vs singles
- How sets are encoded (e.g. `6-3, 4-6, 7-5` or `6-3 | 4-6 | 7-5` or one cell per set)
- The order of rubbers within the card (always 1..N? Numbered explicitly?)

- [ ] **Step 2: Write the failing test**

```typescript
import { describe, it, expect } from 'vitest';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseMatchCard } from '../src/parse-match-card.js';

const loadFixture = async (name: string) =>
  readFile(resolve(__dirname, '../../../fixtures', name), 'utf8');

describe('parseMatchCard', () => {
  it('extracts at least one rubber', async () => {
    const html = await loadFixture('match-card-sample.html');
    const card = parseMatchCard(html);
    expect(card.rubbers.length).toBeGreaterThan(0);
  });

  it('every rubber has 1-2 players on each side', async () => {
    const html = await loadFixture('match-card-sample.html');
    const card = parseMatchCard(html);
    for (const r of card.rubbers) {
      expect(r.homePlayerNames.length).toBeGreaterThanOrEqual(1);
      expect(r.homePlayerNames.length).toBeLessThanOrEqual(2);
      expect(r.awayPlayerNames.length).toBeGreaterThanOrEqual(1);
      expect(r.awayPlayerNames.length).toBeLessThanOrEqual(2);
    }
  });

  it('rubbers preserve their order_in_card starting at 1', async () => {
    const html = await loadFixture('match-card-sample.html');
    const card = parseMatchCard(html);
    expect(card.rubbers[0]?.orderInCard).toBe(1);
    for (let i = 0; i < card.rubbers.length; i++) {
      expect(card.rubbers[i]?.orderInCard).toBe(i + 1);
    }
  });

  it('sets are non-negative integers (no half-points in set scores)', async () => {
    const html = await loadFixture('match-card-sample.html');
    const card = parseMatchCard(html);
    for (const r of card.rubbers) {
      for (const s of r.sets) {
        expect(Number.isInteger(s.home)).toBe(true);
        expect(Number.isInteger(s.away)).toBe(true);
        expect(s.home).toBeGreaterThanOrEqual(0);
        expect(s.away).toBeGreaterThanOrEqual(0);
      }
    }
  });
});
```

- [ ] **Step 3: Run — confirm failure**

Run: `pnpm test packages/parser/tests/parse-match-card.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement `parseMatchCard`**

```typescript
import { load } from 'cheerio';
import { parseIntStrict } from './helpers.js';

export type MatchCardRubberRow = {
  orderInCard: number;
  homePlayerNames: string[];
  awayPlayerNames: string[];
  sets: { home: number; away: number }[];
};

export type MatchCardResult = {
  rubbers: MatchCardRubberRow[];
};

const parseSets = (text: string): { home: number; away: number }[] => {
  // Accept "6-3, 4-6, 7-5" / "6-3 | 4-6" / "6-3 4-6"
  const pieces = text.split(/[,|]/).map((p) => p.trim()).filter(Boolean);
  return pieces.map((piece) => {
    const m = /^(\d+)\s*-\s*(\d+)$/.exec(piece);
    if (!m) throw new Error(`parseSets: not a set: ${JSON.stringify(piece)}`);
    return { home: parseIntStrict(m[1]!), away: parseIntStrict(m[2]!) };
  });
};

const splitPlayers = (cellText: string): string[] => {
  // Doubles often shown as "A. Smith & B. Jones" or "A. Smith / B. Jones" or two anchors
  return cellText
    .split(/\s*(?:&|\/| and )\s*/i)
    .map((s) => s.trim())
    .filter(Boolean);
};

export const parseMatchCard = (html: string): MatchCardResult => {
  const $ = load(html);
  const rubbers: MatchCardRubberRow[] = [];

  // Adjust selector to match the real markup.
  $('table.match-card tbody tr, table.rubbers tr').each((index, el) => {
    const cells = $(el).find('td');
    if (cells.length < 3) return;
    const homeText = $(cells[0]!).text().replace(/\s+/g, ' ').trim();
    const awayText = $(cells[1]!).text().replace(/\s+/g, ' ').trim();
    const scoresText = $(cells[2]!).text().replace(/\s+/g, ' ').trim();
    if (!homeText || !awayText || !scoresText) return;

    rubbers.push({
      orderInCard: rubbers.length + 1,
      homePlayerNames: splitPlayers(homeText),
      awayPlayerNames: splitPlayers(awayText),
      sets: parseSets(scoresText),
    });
  });

  return { rubbers };
};
```

- [ ] **Step 5: Iterate against the fixture**

Run: `pnpm test packages/parser/tests/parse-match-card.test.ts`

- [ ] **Step 6: Commit**

```bash
git add packages/parser/src/parse-match-card.ts packages/parser/tests/parse-match-card.test.ts
git commit -m "feat(parser): parse result_card match-card pages"
```

---

### Task 8: Parser — club contacts

**Goal:** Parse `displayContacts.php` into a list of contact records for a team.

**Files:**
- Create: `packages/parser/src/parse-club-contacts.ts`
- Create: `packages/parser/tests/parse-club-contacts.test.ts`

- [ ] **Step 1: Inspect `fixtures/club-contacts-sample.html`**

Identify how contacts are laid out — likely a small table or a list of "Role: Name (phone, email)" rows. Note which fields are always present vs optional.

- [ ] **Step 2: Write the failing test**

```typescript
import { describe, it, expect } from 'vitest';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseClubContacts } from '../src/parse-club-contacts.js';

const loadFixture = async (name: string) =>
  readFile(resolve(__dirname, '../../../fixtures', name), 'utf8');

describe('parseClubContacts', () => {
  it('extracts at least one contact row', async () => {
    const html = await loadFixture('club-contacts-sample.html');
    const rows = parseClubContacts(html);
    expect(rows.length).toBeGreaterThan(0);
  });

  it('every contact has a name', async () => {
    const html = await loadFixture('club-contacts-sample.html');
    const rows = parseClubContacts(html);
    for (const r of rows) {
      expect(r.name.length).toBeGreaterThan(0);
    }
  });

  it('optional fields are typed correctly when present', async () => {
    const html = await loadFixture('club-contacts-sample.html');
    const rows = parseClubContacts(html);
    for (const r of rows) {
      if (r.email !== undefined) expect(r.email).toMatch(/@/);
      if (r.phone !== undefined) expect(r.phone.length).toBeGreaterThan(0);
      if (r.role !== undefined) expect(r.role.length).toBeGreaterThan(0);
    }
  });
});
```

- [ ] **Step 3: Run — confirm failure**

Run: `pnpm test packages/parser/tests/parse-club-contacts.test.ts`
Expected: FAIL.

- [ ] **Step 4: Implement `parseClubContacts`**

```typescript
import { load } from 'cheerio';

export type ClubContactRow = {
  name: string;
  role?: string;
  phone?: string;
  email?: string;
};

export const parseClubContacts = (html: string): ClubContactRow[] => {
  const $ = load(html);
  const rows: ClubContactRow[] = [];

  // Adjust selector to match the real markup.
  $('table.contacts tr, .contact-row').each((_, el) => {
    const cells = $(el).find('td');
    const name = cells.length > 0 ? $(cells[0]!).text().trim() : $(el).find('.name').text().trim();
    if (!name) return;
    const role = cells.length > 1 ? $(cells[1]!).text().trim() : $(el).find('.role').text().trim();
    const phone = $(el).find('a[href^="tel:"]').text().trim() || $(el).find('.phone').text().trim();
    const email = $(el).find('a[href^="mailto:"]').text().trim() || $(el).find('.email').text().trim();

    rows.push({
      name,
      ...(role ? { role } : {}),
      ...(phone ? { phone } : {}),
      ...(email ? { email } : {}),
    });
  });

  return rows;
};
```

- [ ] **Step 5: Iterate against the fixture**

Run: `pnpm test packages/parser/tests/parse-club-contacts.test.ts`

- [ ] **Step 6: Commit**

```bash
git add packages/parser/src/parse-club-contacts.ts packages/parser/tests/parse-club-contacts.test.ts
git commit -m "feat(parser): parse displayContacts.php club contacts"
```

---

### Task 9: Parser — club location

**Goal:** Parse `displayLocations.php?Mode=html` into a single location record (address, postcode, optional lat/lng).

**Files:**
- Create: `packages/parser/src/parse-club-location.ts`
- Create: `packages/parser/tests/parse-club-location.test.ts`

- [ ] **Step 1: Inspect `fixtures/club-location-sample.html`**

Identify whether the page contains:
- A postal address (multiline)
- A UK postcode (regex `[A-Z]{1,2}\d{1,2}[A-Z]? \d[A-Z]{2}`)
- Latitude/longitude (text, in a map embed URL, or in a `data-*` attribute)

- [ ] **Step 2: Write the failing test**

```typescript
import { describe, it, expect } from 'vitest';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseClubLocation } from '../src/parse-club-location.js';

const loadFixture = async (name: string) =>
  readFile(resolve(__dirname, '../../../fixtures', name), 'utf8');

describe('parseClubLocation', () => {
  it('returns a single location record', async () => {
    const html = await loadFixture('club-location-sample.html');
    const loc = parseClubLocation(html);
    expect(loc).toBeDefined();
  });

  it('postcode if present matches UK format', async () => {
    const html = await loadFixture('club-location-sample.html');
    const loc = parseClubLocation(html);
    if (loc.postcode !== undefined) {
      expect(loc.postcode).toMatch(/^[A-Z]{1,2}\d{1,2}[A-Z]?\s*\d[A-Z]{2}$/i);
    }
  });

  it('coordinates if present are within valid ranges', async () => {
    const html = await loadFixture('club-location-sample.html');
    const loc = parseClubLocation(html);
    if (loc.lat !== undefined && loc.lng !== undefined) {
      expect(loc.lat).toBeGreaterThanOrEqual(-90);
      expect(loc.lat).toBeLessThanOrEqual(90);
      expect(loc.lng).toBeGreaterThanOrEqual(-180);
      expect(loc.lng).toBeLessThanOrEqual(180);
    }
  });
});
```

- [ ] **Step 3: Run — confirm failure**

Run: `pnpm test packages/parser/tests/parse-club-location.test.ts`
Expected: FAIL.

- [ ] **Step 4: Implement `parseClubLocation`**

```typescript
import { load } from 'cheerio';

export type ClubLocationRow = {
  address?: string;
  postcode?: string;
  lat?: number;
  lng?: number;
};

const POSTCODE_RE = /\b([A-Z]{1,2}\d{1,2}[A-Z]?\s*\d[A-Z]{2})\b/i;
const COORDS_RE = /(-?\d+\.\d+)\s*,\s*(-?\d+\.\d+)/;

export const parseClubLocation = (html: string): ClubLocationRow => {
  const $ = load(html);
  const text = $('body').text().replace(/\s+/g, ' ').trim();

  const postcodeMatch = POSTCODE_RE.exec(text);
  const postcode = postcodeMatch ? postcodeMatch[1]!.toUpperCase() : undefined;

  // Look for lat,lng in any map embed src or in the page text.
  const mapHref = $('iframe[src*="google.com/maps"], a[href*="google.com/maps"]').attr('src')
    ?? $('a[href*="google.com/maps"]').attr('href')
    ?? '';
  const coordsMatch = COORDS_RE.exec(mapHref) ?? COORDS_RE.exec(text);
  const lat = coordsMatch ? Number(coordsMatch[1]) : undefined;
  const lng = coordsMatch ? Number(coordsMatch[2]) : undefined;

  // Address: lines other than headings — heuristic, refined against fixture.
  const address = $('.address').text().trim() || undefined;

  return {
    ...(address ? { address } : {}),
    ...(postcode ? { postcode } : {}),
    ...(lat !== undefined && lng !== undefined ? { lat, lng } : {}),
  };
};
```

- [ ] **Step 5: Iterate against the fixture**

Run: `pnpm test packages/parser/tests/parse-club-location.test.ts`

If the fixture has neither postcode nor coordinates (some clubs may lack them), keep the parser tolerant — it should return an empty object rather than throwing.

- [ ] **Step 6: Commit**

```bash
git add packages/parser/src/parse-club-location.ts packages/parser/tests/parse-club-location.test.ts
git commit -m "feat(parser): parse displayLocations.php club locations"
```

---

### Task 10: Update parser public API

**Goal:** Re-export the new parsers and types from `@ctl/parser`. Smoke-test by running the existing `parse-cli` against new URL types (will require a small dispatch update).

**Files:**
- Modify: `packages/parser/src/index.ts`
- Modify: `apps/parse-cli/src/index.ts`

- [ ] **Step 1: Update `packages/parser/src/index.ts`**

```typescript
export { fetchHtml } from './http.js';
export type { FetchHtmlOptions } from './http.js';

export { slugify, parseIntStrict, parseDecimalStrict, parseScore } from './helpers.js';

export {
  detectPageType,
  detectShellPageType,
  detectFragmentType,
} from './page-type.js';
export type { PageType, ShellPageType, FragmentType } from './page-type.js';

export { parseClubsDirectory } from './parse-clubs-directory.js';
export type { ClubsDirectoryRow } from './parse-clubs-directory.js';
export { parseLeagueTable } from './parse-league-table.js';
export type { LeagueTableRow } from './parse-league-table.js';
export { parsePlayerRankings } from './parse-player-rankings.js';
export type { PlayerRankingRow } from './parse-player-rankings.js';

export { parseSeasonNav } from './parse-season-nav.js';
export type { SeasonNavRow, SeasonNavResult } from './parse-season-nav.js';
export { parseFixturesAndResults } from './parse-fixtures-and-results.js';
export type { FixtureRow } from './parse-fixtures-and-results.js';
export { parseMatchCard } from './parse-match-card.js';
export type { MatchCardRubberRow, MatchCardResult } from './parse-match-card.js';
export { parseClubContacts } from './parse-club-contacts.js';
export type { ClubContactRow } from './parse-club-contacts.js';
export { parseClubLocation } from './parse-club-location.js';
export type { ClubLocationRow } from './parse-club-location.js';
```

- [ ] **Step 2: Extend `apps/parse-cli/src/index.ts` dispatch**

Replace the file body:

```typescript
import {
  detectPageType,
  fetchHtml,
  parseClubsDirectory,
  parseLeagueTable,
  parsePlayerRankings,
  parseSeasonNav,
  parseFixturesAndResults,
  parseMatchCard,
  parseClubContacts,
  parseClubLocation,
  type PageType,
} from '@ctl/parser';

const dispatch = (pageType: PageType, html: string): unknown => {
  switch (pageType) {
    case 'clubs-directory': return parseClubsDirectory(html);
    case 'league-table': return parseLeagueTable(html);
    case 'player-rankings': return parsePlayerRankings(html);
    case 'season-nav': return parseSeasonNav(html);
    case 'fixtures-and-results': return parseFixturesAndResults(html);
    case 'match-card': return parseMatchCard(html);
    case 'club-contacts': return parseClubContacts(html);
    case 'club-location': return parseClubLocation(html);
  }
};

const main = async () => {
  const url = process.argv[2];
  if (!url) {
    console.error('Usage: pnpm parse <url>');
    process.exit(1);
  }
  const pageType = detectPageType(url);
  const html = await fetchHtml(url);
  process.stdout.write(JSON.stringify(dispatch(pageType, html), null, 2) + '\n');
};

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 3: Run full test suite**

Run: `pnpm test`
Expected: all previous tests + all new parser tests pass.

Run: `pnpm exec tsc --noEmit`
Expected: clean.

- [ ] **Step 4: Smoke test each new page type against the live upstream**

```bash
pnpm parse "https://www.calderdale.tennis-league.org/" | head -40
pnpm parse "https://www.ludus-online.com/displayResults.php?modeID=<X>&seasonID=<Y>&refreshProtectionCode=0" | head -40
pnpm parse "https://www.ludus-online.com/displayContacts.php?team_id=<X>&refreshProtectionCode=0" | head -40
pnpm parse "https://www.ludus-online.com/displayLocations.php?Mode=html&club_id=<X>&refreshProtectionCode=0" | head -40
pnpm parse "https://www.ludus-online.com/result_card_<N>.php?fixture_id=<X>&refreshProtectionCode=0" | head -40
```

Each should emit JSON. Any that emit `[]` or fail → selector drift, refresh the corresponding fixture and update the parser.

- [ ] **Step 5: Commit**

```bash
git add packages/parser/src/index.ts apps/parse-cli/src/index.ts
git commit -m "feat(parser): expose Phase 2 public API; parse-cli dispatches all eight page types"
```

---

### Task 11: DB package skeleton

**Goal:** Bring up `packages/db` with Drizzle + postgres-js, an empty schema, and a Testcontainers-backed test harness. Validates the toolchain before any schema is written.

**Files:**
- Create: `packages/db/package.json`
- Create: `packages/db/tsconfig.json`
- Create: `packages/db/drizzle.config.ts`
- Create: `packages/db/src/client.ts`
- Create: `packages/db/src/schema/index.ts`
- Create: `packages/db/src/index.ts`
- Create: `packages/db/tests/setup.ts`
- Create: `packages/db/tests/connection.test.ts`
- Modify: `vitest.config.ts`

- [ ] **Step 1: Create `packages/db/package.json`**

```json
{
  "name": "@ctl/db",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "exports": {
    ".": "./src/index.ts",
    "./schema": "./src/schema/index.ts",
    "./client": "./src/client.ts"
  },
  "scripts": {
    "db:generate": "drizzle-kit generate",
    "db:migrate": "tsx src/migrate.ts",
    "db:studio": "drizzle-kit studio"
  },
  "dependencies": {
    "@ctl/domain": "workspace:*",
    "drizzle-orm": "^0.36.0",
    "postgres": "^3.4.4"
  },
  "devDependencies": {
    "drizzle-kit": "^0.28.0",
    "testcontainers": "^10.13.0"
  }
}
```

- [ ] **Step 2: Create `packages/db/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "include": ["src/**/*", "tests/**/*", "drizzle.config.ts"]
}
```

- [ ] **Step 3: Create `packages/db/drizzle.config.ts`**

```typescript
import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema/index.ts',
  out: './src/migrations',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? 'postgres://ctl:ctl@localhost:5432/ctl',
  },
  strict: true,
  verbose: true,
});
```

- [ ] **Step 4: Create `packages/db/src/client.ts`**

```typescript
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import * as schema from './schema/index.js';

export type Database = ReturnType<typeof createDb>;

export const createDb = (databaseUrl: string) => {
  const sql = postgres(databaseUrl, { max: 5 });
  return drizzle(sql, { schema });
};
```

- [ ] **Step 5: Create `packages/db/src/schema/index.ts`** (empty placeholder)

```typescript
// Schema modules are added one per entity in subsequent tasks.
export {};
```

- [ ] **Step 6: Create `packages/db/src/index.ts`**

```typescript
export { createDb } from './client.js';
export type { Database } from './client.js';
export * as schema from './schema/index.js';
```

- [ ] **Step 7: Create `packages/db/tests/setup.ts`**

```typescript
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from 'testcontainers';
import { createDb, type Database } from '../src/client.js';

let container: StartedPostgreSqlContainer | undefined;
let db: Database | undefined;

export const startDb = async (): Promise<{ db: Database; url: string }> => {
  container = await new PostgreSqlContainer('postgres:16-alpine')
    .withDatabase('ctl')
    .withUsername('ctl')
    .withPassword('ctl')
    .start();
  const url = container.getConnectionUri();
  db = createDb(url);
  return { db, url };
};

export const stopDb = async (): Promise<void> => {
  await container?.stop();
};

export const getDb = (): Database => {
  if (!db) throw new Error('startDb() not called');
  return db;
};
```

- [ ] **Step 8: Create `packages/db/tests/connection.test.ts`**

```typescript
import { afterAll, beforeAll, describe, it, expect } from 'vitest';
import { startDb, stopDb, getDb } from './setup.js';
import { sql } from 'drizzle-orm';

describe('db connection', () => {
  beforeAll(async () => {
    await startDb();
  }, 60_000);

  afterAll(async () => {
    await stopDb();
  });

  it('can run SELECT 1', async () => {
    const db = getDb();
    const result = await db.execute(sql`SELECT 1 AS one`);
    expect(result[0]).toEqual({ one: 1 });
  });
});
```

- [ ] **Step 9: Update `vitest.config.ts`** to allow per-test container startup

Replace the file:

```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: false,
    testTimeout: 120_000,        // Testcontainers may need ~30 s on first run
    hookTimeout: 120_000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      exclude: ['**/dist/**', '**/*.config.*', 'fixtures/**', '**/migrations/**'],
    },
  },
});
```

- [ ] **Step 10: Install + verify**

Run: `pnpm install`
Expected: drizzle-orm, drizzle-kit, postgres, testcontainers all installed; `@ctl/db` linked.

Run: `pnpm test packages/db/`
Expected: 1 passed (the connection test). First run pulls `postgres:16-alpine` (~80 MB).

> If Docker isn't running on the dev machine, this test will fail. That's expected — Testcontainers needs Docker.

- [ ] **Step 11: Commit**

```bash
git add packages/db/ vitest.config.ts pnpm-lock.yaml
git commit -m "feat(db): bring up @ctl/db skeleton with Drizzle, postgres-js, Testcontainers harness"
```

---

### Task 12: DB schemas — core entities (seasons, divisions, clubs+aliases, teams, players+aliases)

**Goal:** Define the relational backbone: seasons, divisions, clubs with their alias mapping, teams, players with their alias mapping. Round-trip test inserts a domain object and queries it back to prove the schema is sound.

**Files:**
- Create: `packages/db/src/schema/seasons.ts`
- Create: `packages/db/src/schema/divisions.ts`
- Create: `packages/db/src/schema/clubs.ts`
- Create: `packages/db/src/schema/teams.ts`
- Create: `packages/db/src/schema/players.ts`
- Modify: `packages/db/src/schema/index.ts`
- Create: `packages/db/tests/core-entities.test.ts`

- [ ] **Step 1: Create `packages/db/src/schema/seasons.ts`**

```typescript
import { pgTable, serial, varchar, boolean, uniqueIndex } from 'drizzle-orm/pg-core';

export const seasons = pgTable(
  'seasons',
  {
    id: serial('id').primaryKey(),
    slug: varchar('slug', { length: 64 }).notNull(),
    name: varchar('name', { length: 128 }).notNull(),
    current: boolean('current').notNull().default(false),
  },
  (t) => ({
    slugIdx: uniqueIndex('seasons_slug_idx').on(t.slug),
  }),
);
```

- [ ] **Step 2: Create `packages/db/src/schema/divisions.ts`**

```typescript
import { pgTable, serial, varchar, integer, pgEnum, uniqueIndex } from 'drizzle-orm/pg-core';
import { seasons } from './seasons.js';

export const divisionGroup = pgEnum('division_group', ['Mens', 'Ladies', 'Mixed']);

export const divisions = pgTable(
  'divisions',
  {
    id: serial('id').primaryKey(),
    slug: varchar('slug', { length: 64 }).notNull(),
    name: varchar('name', { length: 128 }).notNull(),
    group: divisionGroup('group').notNull(),
    seasonId: integer('season_id').notNull().references(() => seasons.id),
  },
  (t) => ({
    slugIdx: uniqueIndex('divisions_slug_season_idx').on(t.slug, t.seasonId),
  }),
);
```

- [ ] **Step 3: Create `packages/db/src/schema/clubs.ts`**

```typescript
import { pgTable, serial, varchar, boolean, integer, uniqueIndex } from 'drizzle-orm/pg-core';

export const clubs = pgTable(
  'clubs',
  {
    id: serial('id').primaryKey(),
    slug: varchar('slug', { length: 64 }).notNull(),
    canonicalName: varchar('canonical_name', { length: 128 }).notNull(),
    needsReview: boolean('needs_review').notNull().default(false),
  },
  (t) => ({
    slugIdx: uniqueIndex('clubs_slug_idx').on(t.slug),
  }),
);

export const clubAliases = pgTable(
  'club_aliases',
  {
    id: serial('id').primaryKey(),
    clubId: integer('club_id').notNull().references(() => clubs.id, { onDelete: 'cascade' }),
    observedName: varchar('observed_name', { length: 128 }).notNull(),
  },
  (t) => ({
    nameIdx: uniqueIndex('club_aliases_name_idx').on(t.observedName),
  }),
);
```

- [ ] **Step 4: Create `packages/db/src/schema/teams.ts`**

```typescript
import { pgTable, serial, varchar, integer, uniqueIndex } from 'drizzle-orm/pg-core';
import { clubs } from './clubs.js';
import { divisions } from './divisions.js';

export const teams = pgTable(
  'teams',
  {
    id: serial('id').primaryKey(),
    slug: varchar('slug', { length: 96 }).notNull(),
    name: varchar('name', { length: 128 }).notNull(),
    clubId: integer('club_id').notNull().references(() => clubs.id),
    divisionId: integer('division_id').notNull().references(() => divisions.id),
  },
  (t) => ({
    slugDivisionIdx: uniqueIndex('teams_slug_division_idx').on(t.slug, t.divisionId),
  }),
);
```

- [ ] **Step 5: Create `packages/db/src/schema/players.ts`**

```typescript
import { pgTable, serial, varchar, integer, boolean, uniqueIndex } from 'drizzle-orm/pg-core';
import { clubs } from './clubs.js';

export const players = pgTable(
  'players',
  {
    id: serial('id').primaryKey(),
    slug: varchar('slug', { length: 96 }).notNull(),
    name: varchar('name', { length: 128 }).notNull(),
    btmNumber: varchar('btm_number', { length: 16 }),
    clubId: integer('club_id').notNull().references(() => clubs.id),
    needsReview: boolean('needs_review').notNull().default(false),
  },
  (t) => ({
    slugIdx: uniqueIndex('players_slug_idx').on(t.slug),
  }),
);

export const playerAliases = pgTable(
  'player_aliases',
  {
    id: serial('id').primaryKey(),
    playerId: integer('player_id').notNull().references(() => players.id, { onDelete: 'cascade' }),
    observedName: varchar('observed_name', { length: 128 }).notNull(),
  },
  (t) => ({
    nameIdx: uniqueIndex('player_aliases_name_idx').on(t.observedName),
  }),
);
```

- [ ] **Step 6: Update `packages/db/src/schema/index.ts`**

```typescript
export * from './seasons.js';
export * from './divisions.js';
export * from './clubs.js';
export * from './teams.js';
export * from './players.js';
```

- [ ] **Step 7: Generate the migration**

Run: `pnpm --filter @ctl/db db:generate`
Expected: a new SQL file appears at `packages/db/src/migrations/0000_*.sql` containing CREATE TABLE statements for all six tables.

Inspect the SQL — verify FK constraints, unique indexes, and enum type look right.

- [ ] **Step 8: Create `packages/db/src/migrate.ts`** (used by tests + scraper startup)

```typescript
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { createDb } from './client.js';

const main = async () => {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL not set');
  const db = createDb(url);
  await migrate(db, { migrationsFolder: './src/migrations' });
  console.log('migrations applied');
  process.exit(0);
};

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 9: Write the round-trip test**

Create `packages/db/tests/core-entities.test.ts`:

```typescript
import { afterAll, beforeAll, beforeEach, describe, it, expect } from 'vitest';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { eq, sql } from 'drizzle-orm';
import { startDb, stopDb, getDb } from './setup.js';
import { seasons, divisions, clubs, clubAliases, teams, players, playerAliases } from '../src/schema/index.js';

describe('core entities round-trip', () => {
  beforeAll(async () => {
    const { db } = await startDb();
    await migrate(db, { migrationsFolder: 'packages/db/src/migrations' });
  }, 120_000);

  afterAll(async () => {
    await stopDb();
  });

  beforeEach(async () => {
    const db = getDb();
    await db.execute(sql`TRUNCATE seasons, divisions, clubs, club_aliases, teams, players, player_aliases RESTART IDENTITY CASCADE`);
  });

  it('inserts and retrieves a season', async () => {
    const db = getDb();
    const [inserted] = await db.insert(seasons).values({
      slug: 'summer-2026',
      name: 'Summer 2026',
      current: true,
    }).returning();
    const [found] = await db.select().from(seasons).where(eq(seasons.id, inserted!.id));
    expect(found).toEqual(inserted);
  });

  it('club + alias links correctly', async () => {
    const db = getDb();
    const [club] = await db.insert(clubs).values({
      slug: 'halifax-queens',
      canonicalName: 'Queens Sports Club',
    }).returning();
    await db.insert(clubAliases).values([
      { clubId: club!.id, observedName: 'Queens Sports Club' },
      { clubId: club!.id, observedName: 'Halifax Queens' },
    ]);
    const aliases = await db.select().from(clubAliases).where(eq(clubAliases.clubId, club!.id));
    expect(aliases).toHaveLength(2);
  });

  it('division enforces group enum', async () => {
    const db = getDb();
    const [season] = await db.insert(seasons).values({ slug: 's', name: 'S', current: true }).returning();
    await expect(
      db.execute(sql`INSERT INTO divisions (slug, name, "group", season_id) VALUES ('d', 'D', 'Junior', ${season!.id})`),
    ).rejects.toThrow();
  });

  it('player alias prevents duplicate observed names', async () => {
    const db = getDb();
    const [club] = await db.insert(clubs).values({ slug: 'c', canonicalName: 'C' }).returning();
    const [player] = await db.insert(players).values({
      slug: 'p',
      name: 'P',
      clubId: club!.id,
    }).returning();
    await db.insert(playerAliases).values({ playerId: player!.id, observedName: 'Dan Chicot' });
    await expect(
      db.insert(playerAliases).values({ playerId: player!.id, observedName: 'Dan Chicot' }),
    ).rejects.toThrow();
  });
});
```

- [ ] **Step 10: Run the test**

Run: `pnpm test packages/db/tests/core-entities.test.ts`
Expected: 4 passed.

- [ ] **Step 11: Commit**

```bash
git add packages/db/
git commit -m "feat(db): schemas for seasons, divisions, clubs+aliases, teams, players+aliases"
```

---

### Task 13: DB schemas — match data (fixtures, results, match cards, rubbers, set scores)

**Goal:** Add the match-result entities and their FK chain. Round-trip test confirms a fixture → result → match card → rubber → set scores all link correctly.

**Files:**
- Create: `packages/db/src/schema/fixtures.ts`
- Create: `packages/db/src/schema/match-cards.ts`
- Modify: `packages/db/src/schema/index.ts`
- Create: `packages/db/tests/match-data.test.ts`

- [ ] **Step 1: Create `packages/db/src/schema/fixtures.ts`**

```typescript
import { pgTable, serial, integer, date, pgEnum, numeric, uniqueIndex } from 'drizzle-orm/pg-core';
import { teams } from './teams.js';
import { divisions } from './divisions.js';

export const fixtureStatus = pgEnum('fixture_status', [
  'scheduled',
  'completed',
  'postponed',
  'unfinished',
  'rearranged-postponed',
  'rearranged-unfinished',
  'rubbers-conceded',
  'match-conceded',
]);

export const fixtures = pgTable(
  'fixtures',
  {
    id: serial('id').primaryKey(),
    upstreamId: integer('upstream_id'),       // fixture_id from upstream, when known
    date: date('date').notNull(),
    homeTeamId: integer('home_team_id').notNull().references(() => teams.id),
    awayTeamId: integer('away_team_id').notNull().references(() => teams.id),
    divisionId: integer('division_id').notNull().references(() => divisions.id),
    status: fixtureStatus('status').notNull(),
  },
  (t) => ({
    upstreamIdx: uniqueIndex('fixtures_upstream_idx').on(t.upstreamId),
  }),
);

export const results = pgTable('results', {
  fixtureId: integer('fixture_id').primaryKey().references(() => fixtures.id, { onDelete: 'cascade' }),
  homeScore: numeric('home_score').notNull(),     // numeric — half-points possible
  awayScore: numeric('away_score').notNull(),
});
```

- [ ] **Step 2: Create `packages/db/src/schema/match-cards.ts`**

```typescript
import { pgTable, serial, integer, uniqueIndex } from 'drizzle-orm/pg-core';
import { fixtures } from './fixtures.js';

export const matchCards = pgTable(
  'match_cards',
  {
    id: serial('id').primaryKey(),
    fixtureId: integer('fixture_id').notNull().references(() => fixtures.id, { onDelete: 'cascade' }),
  },
  (t) => ({
    fixtureIdx: uniqueIndex('match_cards_fixture_idx').on(t.fixtureId),
  }),
);

export const rubbers = pgTable('rubbers', {
  id: serial('id').primaryKey(),
  matchCardId: integer('match_card_id').notNull().references(() => matchCards.id, { onDelete: 'cascade' }),
  orderInCard: integer('order_in_card').notNull(),
  homePlayerIds: integer('home_player_ids').array().notNull(),
  awayPlayerIds: integer('away_player_ids').array().notNull(),
});

export const setScores = pgTable('set_scores', {
  id: serial('id').primaryKey(),
  rubberId: integer('rubber_id').notNull().references(() => rubbers.id, { onDelete: 'cascade' }),
  orderInRubber: integer('order_in_rubber').notNull(),
  homeScore: integer('home_score').notNull(),     // integer — set scores are whole numbers
  awayScore: integer('away_score').notNull(),
});
```

- [ ] **Step 3: Update `packages/db/src/schema/index.ts`**

Add the exports:

```typescript
export * from './fixtures.js';
export * from './match-cards.js';
```

- [ ] **Step 4: Generate the migration**

Run: `pnpm --filter @ctl/db db:generate`
Expected: a new SQL file `0001_*.sql` containing CREATE TABLE for fixtures, results, match_cards, rubbers, set_scores.

- [ ] **Step 5: Write the round-trip test**

Create `packages/db/tests/match-data.test.ts`:

```typescript
import { afterAll, beforeAll, beforeEach, describe, it, expect } from 'vitest';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { eq, sql } from 'drizzle-orm';
import { startDb, stopDb, getDb } from './setup.js';
import {
  seasons, divisions, clubs, teams,
  fixtures, results, matchCards, rubbers, setScores,
} from '../src/schema/index.js';

describe('match data round-trip', () => {
  beforeAll(async () => {
    const { db } = await startDb();
    await migrate(db, { migrationsFolder: 'packages/db/src/migrations' });
  }, 120_000);

  afterAll(async () => {
    await stopDb();
  });

  let homeTeamId: number;
  let awayTeamId: number;
  let divisionId: number;

  beforeEach(async () => {
    const db = getDb();
    await db.execute(sql`TRUNCATE seasons, divisions, clubs, club_aliases, teams, players, player_aliases, fixtures, results, match_cards, rubbers, set_scores RESTART IDENTITY CASCADE`);
    const [season] = await db.insert(seasons).values({ slug: 's', name: 'S', current: true }).returning();
    const [division] = await db.insert(divisions).values({ slug: 'd', name: 'D', group: 'Mens', seasonId: season!.id }).returning();
    divisionId = division!.id;
    const [club] = await db.insert(clubs).values({ slug: 'c', canonicalName: 'C' }).returning();
    const [home, away] = await db.insert(teams).values([
      { slug: 'home', name: 'Home', clubId: club!.id, divisionId },
      { slug: 'away', name: 'Away', clubId: club!.id, divisionId },
    ]).returning();
    homeTeamId = home!.id;
    awayTeamId = away!.id;
  });

  it('persists a played fixture with half-point score', async () => {
    const db = getDb();
    const [fixture] = await db.insert(fixtures).values({
      date: '2026-05-12',
      homeTeamId,
      awayTeamId,
      divisionId,
      status: 'completed',
    }).returning();
    await db.insert(results).values({
      fixtureId: fixture!.id,
      homeScore: '6.5',
      awayScore: '5.5',
    });
    const [result] = await db.select().from(results).where(eq(results.fixtureId, fixture!.id));
    expect(result?.homeScore).toBe('6.5');
    expect(result?.awayScore).toBe('5.5');
  });

  it('match card with rubbers and set scores cascades cleanly', async () => {
    const db = getDb();
    const [fixture] = await db.insert(fixtures).values({
      date: '2026-05-12', homeTeamId, awayTeamId, divisionId, status: 'completed',
    }).returning();
    const [card] = await db.insert(matchCards).values({ fixtureId: fixture!.id }).returning();
    const [rubber] = await db.insert(rubbers).values({
      matchCardId: card!.id,
      orderInCard: 1,
      homePlayerIds: [1, 2],
      awayPlayerIds: [3, 4],
    }).returning();
    await db.insert(setScores).values([
      { rubberId: rubber!.id, orderInRubber: 1, homeScore: 6, awayScore: 3 },
      { rubberId: rubber!.id, orderInRubber: 2, homeScore: 4, awayScore: 6 },
      { rubberId: rubber!.id, orderInRubber: 3, homeScore: 7, awayScore: 5 },
    ]);

    const sets = await db.select().from(setScores).where(eq(setScores.rubberId, rubber!.id));
    expect(sets).toHaveLength(3);

    // Cascade delete: dropping the match card should clear rubbers + set scores.
    await db.delete(matchCards).where(eq(matchCards.id, card!.id));
    const remaining = await db.select().from(setScores);
    expect(remaining).toHaveLength(0);
  });
});
```

- [ ] **Step 6: Run the test**

Run: `pnpm test packages/db/tests/match-data.test.ts`
Expected: 2 passed.

- [ ] **Step 7: Commit**

```bash
git add packages/db/
git commit -m "feat(db): schemas for fixtures, results, match cards, rubbers, set scores"
```

---

### Task 14: DB schemas — rankings + scrape_runs, seed migration

**Goal:** Add the remaining tables (player rankings + the scraper's observability table). Add a seed migration with the known club alias mapping (Halifax Queens ↔ Queens Sports Club).

**Files:**
- Create: `packages/db/src/schema/rankings.ts`
- Create: `packages/db/src/schema/scrape-runs.ts`
- Modify: `packages/db/src/schema/index.ts`
- Create: `packages/db/src/migrations/seed/0001_known_aliases.sql` (manual)
- Create: `packages/db/tests/rankings-and-runs.test.ts`

- [ ] **Step 1: Create `packages/db/src/schema/rankings.ts`**

```typescript
import { pgTable, serial, integer, numeric, pgEnum, uniqueIndex } from 'drizzle-orm/pg-core';
import { players } from './players.js';
import { divisions } from './divisions.js';

export const rankingMovement = pgEnum('ranking_movement', ['up', 'down', 'same', 'new']);

export const rankings = pgTable(
  'rankings',
  {
    id: serial('id').primaryKey(),
    playerId: integer('player_id').notNull().references(() => players.id),
    divisionId: integer('division_id').notNull().references(() => divisions.id),
    rank: integer('rank').notNull(),
    rubbersWon: numeric('rubbers_won').notNull(),         // numeric — half-points
    rubbersPlayed: numeric('rubbers_played').notNull(),
    gamesWon: integer('games_won').notNull(),
    gamesPlayed: integer('games_played').notNull(),
    rankingScore: numeric('ranking_score').notNull(),
    movement: rankingMovement('movement').notNull(),
  },
  (t) => ({
    playerDivisionIdx: uniqueIndex('rankings_player_division_idx').on(t.playerId, t.divisionId),
  }),
);
```

- [ ] **Step 2: Create `packages/db/src/schema/scrape-runs.ts`**

```typescript
import { pgTable, varchar, timestamp, boolean, integer, text } from 'drizzle-orm/pg-core';

export const scrapeRuns = pgTable('scrape_runs', {
  url: varchar('url', { length: 512 }).primaryKey(),
  lastFetchedAt: timestamp('last_fetched_at', { withTimezone: true }).notNull(),
  lastModified: varchar('last_modified', { length: 64 }),       // HTTP Last-Modified header verbatim
  contentHash: varchar('content_hash', { length: 64 }),         // SHA-256 hex
  lastStatus: integer('last_status').notNull(),
  lastParseOk: boolean('last_parse_ok').notNull(),
  lastError: text('last_error'),
});
```

- [ ] **Step 3: Update `packages/db/src/schema/index.ts`**

Add:

```typescript
export * from './rankings.js';
export * from './scrape-runs.js';
```

- [ ] **Step 4: Generate the migration**

Run: `pnpm --filter @ctl/db db:generate`
Expected: `0002_*.sql` with rankings + scrape_runs tables.

- [ ] **Step 5: Create the seed migration**

Drizzle migrations are SQL files. Create `packages/db/src/migrations/0003_seed_known_aliases.sql` by hand:

```sql
-- Known alias from Phase 1 discovery (memory note: upstream-uses-two-names-for-the-same-club)
INSERT INTO clubs (slug, canonical_name, needs_review)
VALUES ('halifax-queens', 'Queens Sports Club', false)
ON CONFLICT (slug) DO NOTHING;

INSERT INTO club_aliases (club_id, observed_name)
SELECT id, 'Queens Sports Club' FROM clubs WHERE slug = 'halifax-queens'
ON CONFLICT (observed_name) DO NOTHING;

INSERT INTO club_aliases (club_id, observed_name)
SELECT id, 'Halifax Queens' FROM clubs WHERE slug = 'halifax-queens'
ON CONFLICT (observed_name) DO NOTHING;
```

Add the file to `packages/db/src/migrations/meta/_journal.json` if drizzle-kit's journal exists — easiest is to run `pnpm --filter @ctl/db db:generate --custom` and paste the SQL into the generated file (drizzle-kit supports custom migrations via the `--custom` flag).

- [ ] **Step 6: Write the test for rankings + scrape_runs + seed**

Create `packages/db/tests/rankings-and-runs.test.ts`:

```typescript
import { afterAll, beforeAll, beforeEach, describe, it, expect } from 'vitest';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { eq, sql } from 'drizzle-orm';
import { startDb, stopDb, getDb } from './setup.js';
import {
  clubs, clubAliases, seasons, divisions, players, rankings, scrapeRuns,
} from '../src/schema/index.js';

describe('rankings + scrape_runs + seed', () => {
  beforeAll(async () => {
    const { db } = await startDb();
    await migrate(db, { migrationsFolder: 'packages/db/src/migrations' });
  }, 120_000);

  afterAll(async () => {
    await stopDb();
  });

  it('seed migration created the Queens club + both aliases', async () => {
    const db = getDb();
    const [queens] = await db.select().from(clubs).where(eq(clubs.slug, 'halifax-queens'));
    expect(queens).toBeDefined();
    expect(queens?.canonicalName).toBe('Queens Sports Club');
    const aliases = await db.select().from(clubAliases).where(eq(clubAliases.clubId, queens!.id));
    const names = new Set(aliases.map((a) => a.observedName));
    expect(names.has('Queens Sports Club')).toBe(true);
    expect(names.has('Halifax Queens')).toBe(true);
  });

  it('ranking accepts half-points', async () => {
    const db = getDb();
    await db.execute(sql`TRUNCATE seasons, divisions, clubs, club_aliases, teams, players, player_aliases, rankings RESTART IDENTITY CASCADE`);
    const [season] = await db.insert(seasons).values({ slug: 's', name: 'S', current: true }).returning();
    const [division] = await db.insert(divisions).values({ slug: 'd', name: 'D', group: 'Mens', seasonId: season!.id }).returning();
    const [club] = await db.insert(clubs).values({ slug: 'c', canonicalName: 'C' }).returning();
    const [player] = await db.insert(players).values({ slug: 'p', name: 'P', clubId: club!.id }).returning();
    await db.insert(rankings).values({
      playerId: player!.id,
      divisionId: division!.id,
      rank: 1,
      rubbersWon: '12.5',
      rubbersPlayed: '20.5',
      gamesWon: 100,
      gamesPlayed: 120,
      rankingScore: '0.625',
      movement: 'up',
    });
    const [r] = await db.select().from(rankings);
    expect(r?.rubbersWon).toBe('12.5');
    expect(r?.movement).toBe('up');
  });

  it('scrape_runs upserts on URL', async () => {
    const db = getDb();
    await db.execute(sql`TRUNCATE scrape_runs`);
    await db.insert(scrapeRuns).values({
      url: 'https://example.test/page',
      lastFetchedAt: new Date(),
      lastStatus: 200,
      lastParseOk: true,
      contentHash: 'abc123',
    });
    await db.insert(scrapeRuns).values({
      url: 'https://example.test/page',
      lastFetchedAt: new Date(),
      lastStatus: 304,
      lastParseOk: true,
      contentHash: 'abc123',
    }).onConflictDoUpdate({
      target: scrapeRuns.url,
      set: { lastStatus: 304 },
    });
    const [row] = await db.select().from(scrapeRuns);
    expect(row?.lastStatus).toBe(304);
  });
});
```

- [ ] **Step 7: Run the test**

Run: `pnpm test packages/db/tests/rankings-and-runs.test.ts`
Expected: 3 passed.

- [ ] **Step 8: Commit**

```bash
git add packages/db/
git commit -m "feat(db): schemas for rankings, scrape_runs; seed migration for known club aliases"
```

---

### Task 15: Verify full schema migration pipeline

**Goal:** End-to-end sanity check — run the migration set against a clean DB outside the tests, confirm the resulting schema matches expectations, and that `drizzle-kit studio` can open it.

**Files:**
- Modify: `package.json` (root) — add a helper script

- [ ] **Step 1: Add a root-level convenience script**

In root `package.json` `"scripts"`:

```json
"db:dev": "docker run --rm -d --name ctl-db-dev -p 5433:5432 -e POSTGRES_USER=ctl -e POSTGRES_PASSWORD=ctl -e POSTGRES_DB=ctl postgres:16-alpine",
"db:dev:stop": "docker rm -f ctl-db-dev",
"db:migrate": "DATABASE_URL=postgres://ctl:ctl@localhost:5433/ctl pnpm --filter @ctl/db db:migrate"
```

- [ ] **Step 2: Bring up a dev DB**

Run: `pnpm db:dev`
Expected: container starts in the background.

Run: `sleep 3 && pnpm db:migrate`
Expected: "migrations applied" output.

- [ ] **Step 3: Inspect the schema**

Run: `docker exec -it ctl-db-dev psql -U ctl -d ctl -c "\dt"`
Expected: list of tables: clubs, club_aliases, divisions, fixtures, match_cards, players, player_aliases, rankings, results, rubbers, scrape_runs, seasons, set_scores, teams, plus drizzle's `__drizzle_migrations`.

Run: `docker exec -it ctl-db-dev psql -U ctl -d ctl -c "SELECT slug, canonical_name FROM clubs"`
Expected: shows the seeded `halifax-queens` row.

- [ ] **Step 4: Tear down**

Run: `pnpm db:dev:stop`

- [ ] **Step 5: Commit**

```bash
git add package.json
git commit -m "chore(db): add root-level dev DB helpers (db:dev, db:migrate)"
```

---

### Task 16: Data tier — package skeleton + seasons + clubs getters

**Goal:** Bring up `packages/data` with typed read functions for the two simplest entities, validating the layering pattern that the rest of the data tier will follow.

**Files:**
- Create: `packages/data/package.json`
- Create: `packages/data/tsconfig.json`
- Create: `packages/data/src/index.ts`
- Create: `packages/data/src/seasons.ts`
- Create: `packages/data/src/clubs.ts`
- Create: `packages/data/tests/setup.ts`
- Create: `packages/data/tests/seasons.test.ts`
- Create: `packages/data/tests/clubs.test.ts`

- [ ] **Step 1: Create `packages/data/package.json`**

```json
{
  "name": "@ctl/data",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "exports": { ".": "./src/index.ts" },
  "dependencies": {
    "@ctl/db": "workspace:*",
    "@ctl/domain": "workspace:*",
    "drizzle-orm": "^0.36.0"
  },
  "devDependencies": {
    "testcontainers": "^10.13.0"
  }
}
```

- [ ] **Step 2: Create `packages/data/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "include": ["src/**/*", "tests/**/*"]
}
```

- [ ] **Step 3: Create `packages/data/src/seasons.ts`**

```typescript
import { eq } from 'drizzle-orm';
import type { Database } from '@ctl/db';
import { schema } from '@ctl/db';

export type SeasonSummary = {
  id: number;
  slug: string;
  name: string;
  current: boolean;
};

export const getCurrentSeason = async (db: Database): Promise<SeasonSummary | null> => {
  const [row] = await db.select().from(schema.seasons).where(eq(schema.seasons.current, true)).limit(1);
  return row ?? null;
};

export const listSeasons = async (db: Database): Promise<SeasonSummary[]> => {
  return db.select().from(schema.seasons).orderBy(schema.seasons.id);
};
```

- [ ] **Step 4: Create `packages/data/src/clubs.ts`**

```typescript
import { eq } from 'drizzle-orm';
import type { Database } from '@ctl/db';
import { schema } from '@ctl/db';

export type ClubSummary = {
  id: number;
  slug: string;
  name: string;
};

export const getClub = async (db: Database, slug: string): Promise<ClubSummary | null> => {
  const [row] = await db.select({
    id: schema.clubs.id,
    slug: schema.clubs.slug,
    name: schema.clubs.canonicalName,
  }).from(schema.clubs).where(eq(schema.clubs.slug, slug)).limit(1);
  return row ?? null;
};

export const listClubs = async (db: Database): Promise<ClubSummary[]> => {
  return db.select({
    id: schema.clubs.id,
    slug: schema.clubs.slug,
    name: schema.clubs.canonicalName,
  }).from(schema.clubs).orderBy(schema.clubs.canonicalName);
};
```

- [ ] **Step 5: Create `packages/data/src/index.ts`**

```typescript
export * from './seasons.js';
export * from './clubs.js';
```

- [ ] **Step 6: Create `packages/data/tests/setup.ts`**

```typescript
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from 'testcontainers';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { createDb, type Database } from '@ctl/db';

let container: StartedPostgreSqlContainer | undefined;
let db: Database | undefined;

export const startDb = async (): Promise<Database> => {
  container = await new PostgreSqlContainer('postgres:16-alpine')
    .withDatabase('ctl')
    .withUsername('ctl')
    .withPassword('ctl')
    .start();
  db = createDb(container.getConnectionUri());
  await migrate(db, { migrationsFolder: 'packages/db/src/migrations' });
  return db;
};

export const stopDb = async (): Promise<void> => {
  await container?.stop();
};

export const getDb = (): Database => {
  if (!db) throw new Error('startDb() not called');
  return db;
};
```

- [ ] **Step 7: Write tests for seasons getters**

Create `packages/data/tests/seasons.test.ts`:

```typescript
import { afterAll, beforeAll, beforeEach, describe, it, expect } from 'vitest';
import { sql } from 'drizzle-orm';
import { startDb, stopDb, getDb } from './setup.js';
import { schema } from '@ctl/db';
import { getCurrentSeason, listSeasons } from '../src/seasons.js';

describe('seasons getters', () => {
  beforeAll(async () => { await startDb(); }, 120_000);
  afterAll(async () => { await stopDb(); });

  beforeEach(async () => {
    const db = getDb();
    await db.execute(sql`TRUNCATE seasons RESTART IDENTITY CASCADE`);
  });

  it('getCurrentSeason returns null when no current season exists', async () => {
    expect(await getCurrentSeason(getDb())).toBeNull();
  });

  it('getCurrentSeason returns the one row marked current', async () => {
    const db = getDb();
    await db.insert(schema.seasons).values([
      { slug: 'summer-2025', name: 'Summer 2025', current: false },
      { slug: 'summer-2026', name: 'Summer 2026', current: true },
    ]);
    const s = await getCurrentSeason(db);
    expect(s?.slug).toBe('summer-2026');
  });

  it('listSeasons returns all rows', async () => {
    const db = getDb();
    await db.insert(schema.seasons).values([
      { slug: 'summer-2025', name: 'Summer 2025', current: false },
      { slug: 'summer-2026', name: 'Summer 2026', current: true },
    ]);
    expect(await listSeasons(db)).toHaveLength(2);
  });
});
```

- [ ] **Step 8: Write tests for clubs getters**

Create `packages/data/tests/clubs.test.ts`:

```typescript
import { afterAll, beforeAll, beforeEach, describe, it, expect } from 'vitest';
import { sql } from 'drizzle-orm';
import { startDb, stopDb, getDb } from './setup.js';
import { schema } from '@ctl/db';
import { getClub, listClubs } from '../src/clubs.js';

describe('clubs getters', () => {
  beforeAll(async () => { await startDb(); }, 120_000);
  afterAll(async () => { await stopDb(); });

  beforeEach(async () => {
    const db = getDb();
    await db.execute(sql`TRUNCATE clubs RESTART IDENTITY CASCADE`);
  });

  it('getClub returns null for unknown slug', async () => {
    expect(await getClub(getDb(), 'nope')).toBeNull();
  });

  it('getClub returns the club with canonicalName mapped to name', async () => {
    const db = getDb();
    await db.insert(schema.clubs).values({ slug: 'halifax-queens', canonicalName: 'Queens Sports Club' });
    const c = await getClub(db, 'halifax-queens');
    expect(c).toEqual({ id: expect.any(Number), slug: 'halifax-queens', name: 'Queens Sports Club' });
  });

  it('listClubs returns all rows sorted by canonical name', async () => {
    const db = getDb();
    await db.insert(schema.clubs).values([
      { slug: 'z-club', canonicalName: 'Zenith Tennis' },
      { slug: 'a-club', canonicalName: 'Anchor Tennis' },
    ]);
    const list = await listClubs(db);
    expect(list.map((c) => c.name)).toEqual(['Anchor Tennis', 'Zenith Tennis']);
  });
});
```

- [ ] **Step 9: Install + run tests**

Run: `pnpm install`
Run: `pnpm test packages/data/`
Expected: 6 passed.

- [ ] **Step 10: Commit**

```bash
git add packages/data/ pnpm-lock.yaml
git commit -m "feat(data): bring up @ctl/data middle tier; seasons + clubs getters"
```

---

### Task 17: Data tier — divisions (the joined league table query)

**Goal:** Add the canonical "show me the league table for division X" getter. This is the most complex query in `packages/data` — joins divisions, teams, and aggregates from fixtures/results — so it earns its own task.

**Files:**
- Create: `packages/data/src/divisions.ts`
- Create: `packages/data/tests/divisions.test.ts`
- Modify: `packages/data/src/index.ts`

- [ ] **Step 1: Define the contract**

```typescript
// packages/data/src/divisions.ts
import { eq, and } from 'drizzle-orm';
import type { Database } from '@ctl/db';
import { schema } from '@ctl/db';

export type DivisionSummary = {
  id: number;
  slug: string;
  name: string;
  group: 'Mens' | 'Ladies' | 'Mixed';
  seasonId: number;
};

export type DivisionTableRow = {
  position: number;
  teamId: number;
  teamSlug: string;
  teamName: string;
  pointsWon: string;       // numeric, formatted by Postgres
  pointsLost: string;
  resultsReceived: number;
  resultsTotal: number;
};

export type DivisionTable = {
  division: DivisionSummary;
  rows: DivisionTableRow[];
};
```

- [ ] **Step 2: Write the failing test**

Create `packages/data/tests/divisions.test.ts`:

```typescript
import { afterAll, beforeAll, beforeEach, describe, it, expect } from 'vitest';
import { sql } from 'drizzle-orm';
import { startDb, stopDb, getDb } from './setup.js';
import { schema } from '@ctl/db';
import { getDivisionTable, listDivisions } from '../src/divisions.js';

describe('divisions getters', () => {
  beforeAll(async () => { await startDb(); }, 120_000);
  afterAll(async () => { await stopDb(); });

  beforeEach(async () => {
    const db = getDb();
    await db.execute(sql`TRUNCATE seasons, divisions, clubs, teams RESTART IDENTITY CASCADE`);
  });

  it('listDivisions returns divisions for the current season ordered by name', async () => {
    const db = getDb();
    const [season] = await db.insert(schema.seasons).values({ slug: 's', name: 'S', current: true }).returning();
    await db.insert(schema.divisions).values([
      { slug: 'mens-1', name: 'Mens Division 1', group: 'Mens', seasonId: season!.id },
      { slug: 'mens-2', name: 'Mens Division 2', group: 'Mens', seasonId: season!.id },
    ]);
    const list = await listDivisions(db, season!.id);
    expect(list.map((d) => d.slug)).toEqual(['mens-1', 'mens-2']);
  });

  it('getDivisionTable returns null for unknown slug', async () => {
    expect(await getDivisionTable(getDb(), 'nope')).toBeNull();
  });

  it('getDivisionTable returns ordered rows for a known division', async () => {
    const db = getDb();
    const [season] = await db.insert(schema.seasons).values({ slug: 's', name: 'S', current: true }).returning();
    const [division] = await db.insert(schema.divisions).values({
      slug: 'mens-1', name: 'Mens Division 1', group: 'Mens', seasonId: season!.id,
    }).returning();
    const [club] = await db.insert(schema.clubs).values({ slug: 'c', canonicalName: 'C' }).returning();
    await db.insert(schema.teams).values([
      { slug: 'a-team', name: 'A Team', clubId: club!.id, divisionId: division!.id },
      { slug: 'b-team', name: 'B Team', clubId: club!.id, divisionId: division!.id },
    ]);
    const result = await getDivisionTable(db, 'mens-1');
    expect(result?.division.slug).toBe('mens-1');
    expect(result?.rows).toHaveLength(2);
    expect(result?.rows[0]?.position).toBe(1);
    expect(result?.rows[1]?.position).toBe(2);
  });
});
```

- [ ] **Step 3: Run — confirm failure**

Run: `pnpm test packages/data/tests/divisions.test.ts`
Expected: FAIL.

- [ ] **Step 4: Implement `divisions.ts`**

```typescript
import { eq, and } from 'drizzle-orm';
import type { Database } from '@ctl/db';
import { schema } from '@ctl/db';

export type DivisionSummary = {
  id: number;
  slug: string;
  name: string;
  group: 'Mens' | 'Ladies' | 'Mixed';
  seasonId: number;
};

export type DivisionTableRow = {
  position: number;
  teamId: number;
  teamSlug: string;
  teamName: string;
  pointsWon: string;
  pointsLost: string;
  resultsReceived: number;
  resultsTotal: number;
};

export type DivisionTable = {
  division: DivisionSummary;
  rows: DivisionTableRow[];
};

export const listDivisions = async (db: Database, seasonId: number): Promise<DivisionSummary[]> => {
  const rows = await db
    .select({
      id: schema.divisions.id,
      slug: schema.divisions.slug,
      name: schema.divisions.name,
      group: schema.divisions.group,
      seasonId: schema.divisions.seasonId,
    })
    .from(schema.divisions)
    .where(eq(schema.divisions.seasonId, seasonId))
    .orderBy(schema.divisions.name);
  return rows;
};

export const getDivisionTable = async (db: Database, slug: string): Promise<DivisionTable | null> => {
  const [division] = await db
    .select()
    .from(schema.divisions)
    .where(eq(schema.divisions.slug, slug))
    .limit(1);
  if (!division) return null;

  // For Phase 2: rows seeded by team registration; aggregated points come from
  // the upstream-rendered league table parser (parseLeagueTable). The scraper
  // upserts these rows into a league_table_rows projection table OR we recompute
  // from results — Phase 2 ships with the upstream-rendered values stored as-is
  // on the team row to avoid duplicating the league's own ranking algorithm.
  //
  // Phase 2 minimal version: return all teams in the division, position=index+1,
  // with placeholder zeros. Phase 4 (or a follow-up Phase 2 task) joins to a
  // populated stats source.

  const teams = await db
    .select({
      id: schema.teams.id,
      slug: schema.teams.slug,
      name: schema.teams.name,
    })
    .from(schema.teams)
    .where(eq(schema.teams.divisionId, division.id))
    .orderBy(schema.teams.name);

  const rows: DivisionTableRow[] = teams.map((t, i) => ({
    position: i + 1,
    teamId: t.id,
    teamSlug: t.slug,
    teamName: t.name,
    pointsWon: '0',
    pointsLost: '0',
    resultsReceived: 0,
    resultsTotal: 0,
  }));

  return {
    division: {
      id: division.id,
      slug: division.slug,
      name: division.name,
      group: division.group,
      seasonId: division.seasonId,
    },
    rows,
  };
};
```

> Note: the test asserts the *shape* of the response, not real ranking values. Phase 2 deliberately defers the "league table row stats" question — the upstream renders rank ordering server-side and the scraper stores it positionally. A follow-up task within Phase 2 (or Phase 4) wires populated stats; that's tracked as a known gap, not a blocker.

- [ ] **Step 5: Update `packages/data/src/index.ts`**

```typescript
export * from './seasons.js';
export * from './clubs.js';
export * from './divisions.js';
```

- [ ] **Step 6: Run — confirm pass**

Run: `pnpm test packages/data/tests/divisions.test.ts`
Expected: 3 passed.

- [ ] **Step 7: Commit**

```bash
git add packages/data/
git commit -m "feat(data): listDivisions + getDivisionTable (shape only; stats wiring in follow-up)"
```

---

### Task 18: Data tier — fixtures, players, rankings

**Goal:** Round out the minimal getter surface so the scraper integration test (Task 25) and Phase 4 can build against a complete contract.

**Files:**
- Create: `packages/data/src/fixtures.ts`
- Create: `packages/data/src/players.ts`
- Create: `packages/data/src/rankings.ts`
- Create: `packages/data/tests/fixtures.test.ts`
- Create: `packages/data/tests/players.test.ts`
- Create: `packages/data/tests/rankings.test.ts`
- Modify: `packages/data/src/index.ts`

- [ ] **Step 1: Write `packages/data/src/fixtures.ts`**

```typescript
import { and, eq, gte } from 'drizzle-orm';
import type { Database } from '@ctl/db';
import { schema } from '@ctl/db';

export type FixtureSummary = {
  id: number;
  date: string;
  homeTeamId: number;
  awayTeamId: number;
  divisionId: number;
  status: string;
};

export const getFixture = async (db: Database, id: number): Promise<FixtureSummary | null> => {
  const [row] = await db.select().from(schema.fixtures).where(eq(schema.fixtures.id, id)).limit(1);
  return row ?? null;
};

export const listUpcomingFixtures = async (
  db: Database,
  divisionId: number,
  fromDate: string,
): Promise<FixtureSummary[]> => {
  return db
    .select()
    .from(schema.fixtures)
    .where(
      and(
        eq(schema.fixtures.divisionId, divisionId),
        eq(schema.fixtures.status, 'scheduled'),
        gte(schema.fixtures.date, fromDate),
      ),
    )
    .orderBy(schema.fixtures.date);
};
```

- [ ] **Step 2: Write `packages/data/src/players.ts`**

```typescript
import { eq } from 'drizzle-orm';
import type { Database } from '@ctl/db';
import { schema } from '@ctl/db';

export type PlayerSummary = {
  id: number;
  slug: string;
  name: string;
  clubId: number;
};

export const getPlayer = async (db: Database, slug: string): Promise<PlayerSummary | null> => {
  const [row] = await db
    .select({ id: schema.players.id, slug: schema.players.slug, name: schema.players.name, clubId: schema.players.clubId })
    .from(schema.players)
    .where(eq(schema.players.slug, slug))
    .limit(1);
  return row ?? null;
};

export const listPlayersByClub = async (db: Database, clubId: number): Promise<PlayerSummary[]> => {
  return db
    .select({ id: schema.players.id, slug: schema.players.slug, name: schema.players.name, clubId: schema.players.clubId })
    .from(schema.players)
    .where(eq(schema.players.clubId, clubId))
    .orderBy(schema.players.name);
};
```

- [ ] **Step 3: Write `packages/data/src/rankings.ts`**

```typescript
import { eq } from 'drizzle-orm';
import type { Database } from '@ctl/db';
import { schema } from '@ctl/db';

export type RankingRow = {
  rank: number;
  playerId: number;
  playerName: string;
  rubbersWon: string;
  rubbersPlayed: string;
  gamesWon: number;
  gamesPlayed: number;
  rankingScore: string;
  movement: 'up' | 'down' | 'same' | 'new';
};

export const getRankingsByDivision = async (db: Database, divisionId: number): Promise<RankingRow[]> => {
  return db
    .select({
      rank: schema.rankings.rank,
      playerId: schema.rankings.playerId,
      playerName: schema.players.name,
      rubbersWon: schema.rankings.rubbersWon,
      rubbersPlayed: schema.rankings.rubbersPlayed,
      gamesWon: schema.rankings.gamesWon,
      gamesPlayed: schema.rankings.gamesPlayed,
      rankingScore: schema.rankings.rankingScore,
      movement: schema.rankings.movement,
    })
    .from(schema.rankings)
    .innerJoin(schema.players, eq(schema.players.id, schema.rankings.playerId))
    .where(eq(schema.rankings.divisionId, divisionId))
    .orderBy(schema.rankings.rank);
};
```

- [ ] **Step 4: Write the three test files**

Each follows the same pattern as `seasons.test.ts` / `clubs.test.ts` — three cases minimum: null/empty, single-row, multi-row. Truncate the relevant tables in `beforeEach`. Seed via `db.insert(...)`.

```typescript
// packages/data/tests/fixtures.test.ts
import { afterAll, beforeAll, beforeEach, describe, it, expect } from 'vitest';
import { sql } from 'drizzle-orm';
import { startDb, stopDb, getDb } from './setup.js';
import { schema } from '@ctl/db';
import { getFixture, listUpcomingFixtures } from '../src/fixtures.js';

describe('fixtures getters', () => {
  beforeAll(async () => { await startDb(); }, 120_000);
  afterAll(async () => { await stopDb(); });
  beforeEach(async () => {
    await getDb().execute(sql`TRUNCATE seasons, divisions, clubs, teams, fixtures RESTART IDENTITY CASCADE`);
  });

  it('getFixture returns null for unknown id', async () => {
    expect(await getFixture(getDb(), 999)).toBeNull();
  });

  it('listUpcomingFixtures filters by date and status', async () => {
    const db = getDb();
    const [season] = await db.insert(schema.seasons).values({ slug: 's', name: 'S', current: true }).returning();
    const [division] = await db.insert(schema.divisions).values({ slug: 'd', name: 'D', group: 'Mens', seasonId: season!.id }).returning();
    const [club] = await db.insert(schema.clubs).values({ slug: 'c', canonicalName: 'C' }).returning();
    const [home, away] = await db.insert(schema.teams).values([
      { slug: 'home', name: 'Home', clubId: club!.id, divisionId: division!.id },
      { slug: 'away', name: 'Away', clubId: club!.id, divisionId: division!.id },
    ]).returning();
    await db.insert(schema.fixtures).values([
      { date: '2026-01-01', homeTeamId: home!.id, awayTeamId: away!.id, divisionId: division!.id, status: 'scheduled' },
      { date: '2026-12-01', homeTeamId: home!.id, awayTeamId: away!.id, divisionId: division!.id, status: 'scheduled' },
      { date: '2026-12-01', homeTeamId: home!.id, awayTeamId: away!.id, divisionId: division!.id, status: 'completed' },
    ]);
    const upcoming = await listUpcomingFixtures(db, division!.id, '2026-06-01');
    expect(upcoming).toHaveLength(1);
    expect(upcoming[0]?.date).toBe('2026-12-01');
  });
});
```

(Mirror this shape for `players.test.ts` and `rankings.test.ts`.)

- [ ] **Step 5: Update `packages/data/src/index.ts`**

```typescript
export * from './seasons.js';
export * from './clubs.js';
export * from './divisions.js';
export * from './fixtures.js';
export * from './players.js';
export * from './rankings.js';
```

- [ ] **Step 6: Run all data tier tests**

Run: `pnpm test packages/data/`
Expected: all tests pass.

- [ ] **Step 7: Commit**

```bash
git add packages/data/
git commit -m "feat(data): fixtures, players, rankings getters complete the Phase 2 surface"
```

---

### Task 19: Scraper app — skeleton + CLI dispatch

**Goal:** Stand up `apps/scraper` with a CLI that parses `--season=<slug>` / `--backfill` flags and dispatches to stub mode handlers. No actual scraping yet — this validates the entry point and argument parsing.

**Files:**
- Create: `apps/scraper/package.json`
- Create: `apps/scraper/tsconfig.json`
- Create: `apps/scraper/src/index.ts`
- Create: `apps/scraper/src/modes/current.ts`
- Create: `apps/scraper/src/modes/season.ts`
- Create: `apps/scraper/src/modes/backfill.ts`
- Create: `apps/scraper/tests/cli.test.ts`

- [ ] **Step 1: Create `apps/scraper/package.json`**

```json
{
  "name": "@ctl/scraper",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "bin": { "scrape": "./src/index.ts" },
  "scripts": {
    "scrape": "tsx src/index.ts"
  },
  "dependencies": {
    "@ctl/db": "workspace:*",
    "@ctl/domain": "workspace:*",
    "@ctl/parser": "workspace:*",
    "drizzle-orm": "^0.36.0"
  },
  "devDependencies": {
    "testcontainers": "^10.13.0"
  }
}
```

- [ ] **Step 2: Create `apps/scraper/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "include": ["src/**/*", "tests/**/*"]
}
```

- [ ] **Step 3: Add top-level scrape script in root `package.json`**

```json
"scrape": "pnpm --filter @ctl/scraper exec tsx src/index.ts"
```

- [ ] **Step 4: Write the failing test**

Create `apps/scraper/tests/cli.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { parseArgs } from '../src/index.js';

describe('CLI argument parsing', () => {
  it('defaults to current mode with no args', () => {
    expect(parseArgs([])).toEqual({ mode: 'current' });
  });

  it('--season=summer-2024 selects season mode', () => {
    expect(parseArgs(['--season=summer-2024'])).toEqual({ mode: 'season', seasonSlug: 'summer-2024' });
  });

  it('--backfill selects backfill mode', () => {
    expect(parseArgs(['--backfill'])).toEqual({ mode: 'backfill' });
  });

  it('rejects --season without value', () => {
    expect(() => parseArgs(['--season'])).toThrow();
  });

  it('rejects unknown flags', () => {
    expect(() => parseArgs(['--frobnicate'])).toThrow();
  });
});
```

- [ ] **Step 5: Run — confirm failure**

Run: `pnpm test apps/scraper/tests/cli.test.ts`
Expected: FAIL — `parseArgs` not exported.

- [ ] **Step 6: Implement `apps/scraper/src/index.ts`**

```typescript
type ScraperArgs =
  | { mode: 'current' }
  | { mode: 'season'; seasonSlug: string }
  | { mode: 'backfill' };

export const parseArgs = (argv: string[]): ScraperArgs => {
  if (argv.length === 0) return { mode: 'current' };
  for (const arg of argv) {
    if (arg === '--backfill') return { mode: 'backfill' };
    const seasonMatch = /^--season=(.+)$/.exec(arg);
    if (seasonMatch) return { mode: 'season', seasonSlug: seasonMatch[1]! };
    if (arg === '--season') throw new Error('--season requires a value, e.g. --season=summer-2024');
    throw new Error(`Unknown argument: ${arg}`);
  }
  return { mode: 'current' };
};

const main = async () => {
  const args = parseArgs(process.argv.slice(2));
  const { runCurrent } = await import('./modes/current.js');
  const { runSeason } = await import('./modes/season.js');
  const { runBackfill } = await import('./modes/backfill.js');

  switch (args.mode) {
    case 'current':
      await runCurrent();
      break;
    case 'season':
      await runSeason(args.seasonSlug);
      break;
    case 'backfill':
      await runBackfill();
      break;
  }
};

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
```

- [ ] **Step 7: Create stub mode handlers**

```typescript
// apps/scraper/src/modes/current.ts
export const runCurrent = async (): Promise<void> => {
  console.log('[scraper] mode=current — not implemented yet');
};
```

```typescript
// apps/scraper/src/modes/season.ts
export const runSeason = async (slug: string): Promise<void> => {
  console.log(`[scraper] mode=season slug=${slug} — not implemented yet`);
};
```

```typescript
// apps/scraper/src/modes/backfill.ts
export const runBackfill = async (): Promise<void> => {
  console.log('[scraper] mode=backfill — not implemented yet');
};
```

- [ ] **Step 8: Run — confirm pass**

Run: `pnpm install`
Run: `pnpm test apps/scraper/tests/cli.test.ts`
Expected: 5 passed.

Run: `pnpm scrape`
Expected: prints `[scraper] mode=current — not implemented yet`.

Run: `pnpm scrape --season=summer-2024`
Expected: prints `[scraper] mode=season slug=summer-2024 — not implemented yet`.

- [ ] **Step 9: Commit**

```bash
git add apps/scraper/ package.json pnpm-lock.yaml
git commit -m "feat(scraper): CLI skeleton with --season / --backfill mode dispatch"
```

---

### Task 20: Scraper — HTTP client (rate limit, retries, conditional GET, content hash)

**Goal:** Implement the polite-scraping HTTP layer that all scraper code goes through. The function takes a URL and the `scrape_runs` row (if any) and returns either parsed-content + new hash + new last-modified, or a "skip" signal.

**Files:**
- Create: `apps/scraper/src/http-client.ts`
- Create: `apps/scraper/tests/http-client.test.ts`

- [ ] **Step 1: Define the contract**

```typescript
// apps/scraper/src/http-client.ts (top of file)
import { createHash } from 'node:crypto';

const USER_AGENT_DEFAULT =
  'CalderdaleLeagueMirror/0.2 (contact: dan.chicot@gmail.com; non-affiliated personal mirror)';

type FetchLike = typeof fetch;

export type PriorFetch = {
  lastModified?: string;
  contentHash?: string;
};

export type FetchResult =
  | {
      kind: 'changed';
      status: number;
      html: string;
      lastModified?: string;
      contentHash: string;
    }
  | {
      kind: 'unchanged';
      status: number;       // 304 or 200-with-matching-hash
      contentHash?: string;
    };

export type ScrapeHttpOptions = {
  userAgent?: string;
  rateLimitMs?: number;
  requestTimeoutMs?: number;
  maxRetries?: number;
  fetch?: FetchLike;
  now?: () => number;
};

export type ScrapeHttpClient = {
  fetchPage: (url: string, prior?: PriorFetch) => Promise<FetchResult>;
};
```

- [ ] **Step 2: Write the failing tests**

Create `apps/scraper/tests/http-client.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { createScrapeHttpClient } from '../src/http-client.js';

const makeResponse = (init: { status: number; body?: string; lastModified?: string }) => ({
  status: init.status,
  text: async () => init.body ?? '',
  headers: new Headers(init.lastModified ? { 'last-modified': init.lastModified } : undefined),
});

describe('createScrapeHttpClient', () => {
  it('returns changed on first fetch', async () => {
    const fakeFetch = vi.fn(async () => makeResponse({ status: 200, body: '<html/>', lastModified: 'Mon' }));
    const client = createScrapeHttpClient({ fetch: fakeFetch as any, rateLimitMs: 0 });
    const r = await client.fetchPage('https://example.test/page');
    expect(r.kind).toBe('changed');
    if (r.kind === 'changed') {
      expect(r.html).toBe('<html/>');
      expect(r.lastModified).toBe('Mon');
      expect(r.contentHash).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it('sends If-Modified-Since when prior.lastModified provided', async () => {
    const fakeFetch = vi.fn(async () => makeResponse({ status: 304 }));
    const client = createScrapeHttpClient({ fetch: fakeFetch as any, rateLimitMs: 0 });
    await client.fetchPage('https://example.test/page', { lastModified: 'Mon, 01 Jan 2026 00:00:00 GMT' });
    const init = fakeFetch.mock.calls[0]?.[1] as RequestInit;
    expect(new Headers(init.headers).get('If-Modified-Since')).toBe('Mon, 01 Jan 2026 00:00:00 GMT');
  });

  it('reports unchanged on 304', async () => {
    const fakeFetch = vi.fn(async () => makeResponse({ status: 304 }));
    const client = createScrapeHttpClient({ fetch: fakeFetch as any, rateLimitMs: 0 });
    const r = await client.fetchPage('https://example.test/page', { lastModified: 'Mon' });
    expect(r.kind).toBe('unchanged');
    expect(r.status).toBe(304);
  });

  it('reports unchanged on 200 with matching content hash', async () => {
    const fakeFetch = vi.fn(async () => makeResponse({ status: 200, body: '<same/>' }));
    const client = createScrapeHttpClient({ fetch: fakeFetch as any, rateLimitMs: 0 });
    const first = await client.fetchPage('https://example.test/page');
    expect(first.kind).toBe('changed');
    const hash = first.kind === 'changed' ? first.contentHash : '';
    const second = await client.fetchPage('https://example.test/page', { contentHash: hash });
    expect(second.kind).toBe('unchanged');
  });

  it('retries on 503 then succeeds', async () => {
    const fakeFetch = vi
      .fn()
      .mockResolvedValueOnce(makeResponse({ status: 503 }))
      .mockResolvedValueOnce(makeResponse({ status: 200, body: '<ok/>' }));
    const client = createScrapeHttpClient({
      fetch: fakeFetch as any,
      rateLimitMs: 0,
      maxRetries: 2,
    });
    const r = await client.fetchPage('https://example.test/page');
    expect(r.kind).toBe('changed');
    expect(fakeFetch).toHaveBeenCalledTimes(2);
  });

  it('throws after max retries exhausted', async () => {
    const fakeFetch = vi.fn(async () => makeResponse({ status: 503 }));
    const client = createScrapeHttpClient({
      fetch: fakeFetch as any,
      rateLimitMs: 0,
      maxRetries: 2,
    });
    await expect(client.fetchPage('https://example.test/page')).rejects.toThrow(/503/);
  });

  it('rate-limits subsequent calls', async () => {
    const fakeFetch = vi.fn(async () => makeResponse({ status: 200, body: '<a/>' }));
    let nowVal = 0;
    const now = () => nowVal;
    const client = createScrapeHttpClient({
      fetch: fakeFetch as any,
      rateLimitMs: 1000,
      now,
    });
    const sleeps: number[] = [];
    vi.spyOn(global, 'setTimeout').mockImplementation((cb: any, ms: number) => {
      sleeps.push(ms);
      nowVal += ms;
      cb();
      return 0 as any;
    });
    await client.fetchPage('https://example.test/a');
    await client.fetchPage('https://example.test/b');
    expect(sleeps[sleeps.length - 1]).toBe(1000);
    vi.restoreAllMocks();
  });

  it('sends a polite User-Agent', async () => {
    const fakeFetch = vi.fn(async () => makeResponse({ status: 200, body: '<a/>' }));
    const client = createScrapeHttpClient({ fetch: fakeFetch as any, rateLimitMs: 0 });
    await client.fetchPage('https://example.test/a');
    const init = fakeFetch.mock.calls[0]?.[1] as RequestInit;
    expect(new Headers(init.headers).get('User-Agent')).toMatch(/CalderdaleLeagueMirror/);
  });
});
```

- [ ] **Step 3: Run — confirm failure**

Run: `pnpm test apps/scraper/tests/http-client.test.ts`
Expected: FAIL.

- [ ] **Step 4: Implement `apps/scraper/src/http-client.ts`**

```typescript
import { createHash } from 'node:crypto';

const USER_AGENT_DEFAULT =
  'CalderdaleLeagueMirror/0.2 (contact: dan.chicot@gmail.com; non-affiliated personal mirror)';

type FetchLike = typeof fetch;

export type PriorFetch = {
  lastModified?: string;
  contentHash?: string;
};

export type FetchResult =
  | { kind: 'changed'; status: number; html: string; lastModified?: string; contentHash: string }
  | { kind: 'unchanged'; status: number; contentHash?: string };

export type ScrapeHttpOptions = {
  userAgent?: string;
  rateLimitMs?: number;
  requestTimeoutMs?: number;
  maxRetries?: number;
  fetch?: FetchLike;
  now?: () => number;
};

export type ScrapeHttpClient = {
  fetchPage: (url: string, prior?: PriorFetch) => Promise<FetchResult>;
};

const sha256 = (s: string): string => createHash('sha256').update(s).digest('hex');

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

const RETRIABLE_STATUSES = new Set([502, 503, 504]);
const BACKOFF_MS = [2_000, 4_000, 8_000];

export const createScrapeHttpClient = (options: ScrapeHttpOptions = {}): ScrapeHttpClient => {
  const userAgent = options.userAgent ?? USER_AGENT_DEFAULT;
  const rateLimitMs = options.rateLimitMs ?? 1_000;
  const requestTimeoutMs = options.requestTimeoutMs ?? 30_000;
  const maxRetries = options.maxRetries ?? 3;
  const f = options.fetch ?? fetch;
  const now = options.now ?? (() => Date.now());

  let lastFetchAt = 0;

  const respectRateLimit = async () => {
    const elapsed = now() - lastFetchAt;
    if (elapsed < rateLimitMs) {
      await sleep(rateLimitMs - elapsed);
    }
    lastFetchAt = now();
  };

  const requestOnce = async (url: string, headers: Record<string, string>): Promise<{ status: number; html: string; headers: Headers }> => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), requestTimeoutMs);
    try {
      const res = await f(url, { headers, redirect: 'follow', signal: controller.signal });
      const text = await res.text();
      return { status: res.status, html: text, headers: res.headers };
    } finally {
      clearTimeout(timeout);
    }
  };

  const fetchWithRetries = async (url: string, headers: Record<string, string>) => {
    let attempt = 0;
    let lastErr: unknown;
    while (attempt <= maxRetries) {
      await respectRateLimit();
      try {
        const result = await requestOnce(url, headers);
        if (RETRIABLE_STATUSES.has(result.status) && attempt < maxRetries) {
          await sleep(BACKOFF_MS[attempt] ?? BACKOFF_MS[BACKOFF_MS.length - 1]!);
          attempt++;
          continue;
        }
        if (result.status >= 400 && result.status !== 304) {
          throw new Error(`fetchPage: ${result.status} for ${url}`);
        }
        return result;
      } catch (err) {
        lastErr = err;
        if (attempt >= maxRetries) throw err;
        await sleep(BACKOFF_MS[attempt] ?? BACKOFF_MS[BACKOFF_MS.length - 1]!);
        attempt++;
      }
    }
    throw lastErr ?? new Error('fetchWithRetries: unreachable');
  };

  const fetchPage = async (url: string, prior?: PriorFetch): Promise<FetchResult> => {
    const headers: Record<string, string> = { 'User-Agent': userAgent };
    if (prior?.lastModified) headers['If-Modified-Since'] = prior.lastModified;

    const { status, html, headers: responseHeaders } = await fetchWithRetries(url, headers);

    if (status === 304) {
      return { kind: 'unchanged', status };
    }

    const contentHash = sha256(html);
    if (prior?.contentHash && prior.contentHash === contentHash) {
      return { kind: 'unchanged', status, contentHash };
    }

    return {
      kind: 'changed',
      status,
      html,
      lastModified: responseHeaders.get('last-modified') ?? undefined,
      contentHash,
    };
  };

  return { fetchPage };
};
```

- [ ] **Step 5: Run — confirm pass**

Run: `pnpm test apps/scraper/tests/http-client.test.ts`
Expected: 8 passed.

- [ ] **Step 6: Commit**

```bash
git add apps/scraper/
git commit -m "feat(scraper): polite HTTP client with rate limit, retries, conditional GET, content hash"
```

> If Task 1's spike found a session-warmup requirement, add a `warmUp()` method to `ScrapeHttpClient` that fetches the home page once and stores a cookie, attached to subsequent requests. Add tests asserting the cookie is sent.

---

### Task 21: Scraper — entity resolver

**Goal:** Resolve observed names (clubs, players) to canonical IDs via the alias tables. Creates tentative rows for unknown names with `needs_review = true`.

**Files:**
- Create: `apps/scraper/src/entity-resolver.ts`
- Create: `apps/scraper/tests/entity-resolver.test.ts`
- Create: `apps/scraper/tests/setup.ts` (shared Testcontainers harness)

- [ ] **Step 1: Create the test setup**

Reuse the same pattern from `packages/data/tests/setup.ts`. Create `apps/scraper/tests/setup.ts` with `startDb` / `stopDb` / `getDb`.

- [ ] **Step 2: Write the failing tests**

```typescript
// apps/scraper/tests/entity-resolver.test.ts
import { afterAll, beforeAll, beforeEach, describe, it, expect } from 'vitest';
import { sql, eq } from 'drizzle-orm';
import { startDb, stopDb, getDb } from './setup.js';
import { schema } from '@ctl/db';
import { resolveClub, resolvePlayer } from '../src/entity-resolver.js';
import { slugify } from '@ctl/parser';

describe('resolveClub', () => {
  beforeAll(async () => { await startDb(); }, 120_000);
  afterAll(async () => { await stopDb(); });

  beforeEach(async () => {
    await getDb().execute(sql`TRUNCATE clubs, club_aliases RESTART IDENTITY CASCADE`);
  });

  it('returns the existing club for a known alias', async () => {
    const db = getDb();
    const [club] = await db.insert(schema.clubs).values({ slug: 'halifax-queens', canonicalName: 'Queens Sports Club' }).returning();
    await db.insert(schema.clubAliases).values({ clubId: club!.id, observedName: 'Halifax Queens' });
    const id = await resolveClub(db, 'Halifax Queens');
    expect(id).toBe(club!.id);
  });

  it('creates a tentative club + alias for an unknown name', async () => {
    const db = getDb();
    const id = await resolveClub(db, 'Brand New Club');
    const [club] = await db.select().from(schema.clubs).where(eq(schema.clubs.id, id));
    expect(club?.needsReview).toBe(true);
    expect(club?.slug).toBe(slugify('Brand New Club'));
    const [alias] = await db.select().from(schema.clubAliases).where(eq(schema.clubAliases.observedName, 'Brand New Club'));
    expect(alias?.clubId).toBe(id);
  });

  it('is idempotent — calling twice with the same unknown name reuses the tentative club', async () => {
    const db = getDb();
    const a = await resolveClub(db, 'Repeat Club');
    const b = await resolveClub(db, 'Repeat Club');
    expect(a).toBe(b);
    const clubs = await db.select().from(schema.clubs);
    expect(clubs).toHaveLength(1);
  });
});

describe('resolvePlayer', () => {
  beforeAll(async () => { await startDb(); }, 120_000);
  afterAll(async () => { await stopDb(); });

  beforeEach(async () => {
    await getDb().execute(sql`TRUNCATE clubs, club_aliases, players, player_aliases RESTART IDENTITY CASCADE`);
  });

  it('creates a tentative player when name is unknown', async () => {
    const db = getDb();
    const [club] = await db.insert(schema.clubs).values({ slug: 'c', canonicalName: 'C' }).returning();
    const id = await resolvePlayer(db, 'Unknown Player', club!.id);
    const [player] = await db.select().from(schema.players).where(eq(schema.players.id, id));
    expect(player?.needsReview).toBe(true);
    expect(player?.clubId).toBe(club!.id);
  });
});
```

- [ ] **Step 3: Run — confirm failure**

Run: `pnpm test apps/scraper/tests/entity-resolver.test.ts`
Expected: FAIL.

- [ ] **Step 4: Implement `apps/scraper/src/entity-resolver.ts`**

```typescript
import { eq } from 'drizzle-orm';
import type { Database } from '@ctl/db';
import { schema } from '@ctl/db';
import { slugify } from '@ctl/parser';

export const resolveClub = async (db: Database, observedName: string): Promise<number> => {
  const [existing] = await db
    .select({ clubId: schema.clubAliases.clubId })
    .from(schema.clubAliases)
    .where(eq(schema.clubAliases.observedName, observedName))
    .limit(1);
  if (existing) return existing.clubId;

  return db.transaction(async (tx) => {
    const slug = slugify(observedName);
    const [byslug] = await tx.select().from(schema.clubs).where(eq(schema.clubs.slug, slug)).limit(1);
    let clubId: number;
    if (byslug) {
      clubId = byslug.id;
    } else {
      const [created] = await tx
        .insert(schema.clubs)
        .values({ slug, canonicalName: observedName, needsReview: true })
        .returning();
      clubId = created!.id;
    }
    await tx
      .insert(schema.clubAliases)
      .values({ clubId, observedName })
      .onConflictDoNothing();
    return clubId;
  });
};

export const resolvePlayer = async (db: Database, observedName: string, clubId: number): Promise<number> => {
  const [existing] = await db
    .select({ playerId: schema.playerAliases.playerId })
    .from(schema.playerAliases)
    .where(eq(schema.playerAliases.observedName, observedName))
    .limit(1);
  if (existing) return existing.playerId;

  return db.transaction(async (tx) => {
    const slug = slugify(observedName);
    const [byslug] = await tx.select().from(schema.players).where(eq(schema.players.slug, slug)).limit(1);
    let playerId: number;
    if (byslug) {
      playerId = byslug.id;
    } else {
      const [created] = await tx
        .insert(schema.players)
        .values({ slug, name: observedName, clubId, needsReview: true })
        .returning();
      playerId = created!.id;
    }
    await tx
      .insert(schema.playerAliases)
      .values({ playerId, observedName })
      .onConflictDoNothing();
    return playerId;
  });
};
```

- [ ] **Step 5: Run — confirm pass**

Run: `pnpm test apps/scraper/tests/entity-resolver.test.ts`
Expected: 4 passed.

- [ ] **Step 6: Commit**

```bash
git add apps/scraper/src/entity-resolver.ts apps/scraper/tests/entity-resolver.test.ts apps/scraper/tests/setup.ts
git commit -m "feat(scraper): entity resolver with graceful-unknown tentative rows"
```

---

### Task 22: Scraper — season detector

**Goal:** A thin wrapper around `parseSeasonNav` that fetches the upstream home page, persists discovered seasons, and returns the current season's DB id.

**Files:**
- Create: `apps/scraper/src/season-detector.ts`
- Create: `apps/scraper/tests/season-detector.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { afterAll, beforeAll, beforeEach, describe, it, expect } from 'vitest';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { sql, eq } from 'drizzle-orm';
import { startDb, stopDb, getDb } from './setup.js';
import { schema } from '@ctl/db';
import { detectAndPersistSeasons } from '../src/season-detector.js';

const fixtureHtml = () => readFile(resolve(__dirname, '../../../fixtures/season-nav.html'), 'utf8');

describe('detectAndPersistSeasons', () => {
  beforeAll(async () => { await startDb(); }, 120_000);
  afterAll(async () => { await stopDb(); });

  beforeEach(async () => {
    await getDb().execute(sql`TRUNCATE seasons RESTART IDENTITY CASCADE`);
  });

  it('persists every season from the upstream nav', async () => {
    const db = getDb();
    const html = await fixtureHtml();
    const result = await detectAndPersistSeasons(db, html);
    const persisted = await db.select().from(schema.seasons);
    expect(persisted.length).toBe(result.totalSeasons);
    expect(persisted.length).toBeGreaterThan(0);
  });

  it('marks exactly one season as current', async () => {
    const db = getDb();
    const html = await fixtureHtml();
    await detectAndPersistSeasons(db, html);
    const currents = await db.select().from(schema.seasons).where(eq(schema.seasons.current, true));
    expect(currents).toHaveLength(1);
  });

  it('is idempotent — running twice yields the same row count', async () => {
    const db = getDb();
    const html = await fixtureHtml();
    await detectAndPersistSeasons(db, html);
    const firstCount = (await db.select().from(schema.seasons)).length;
    await detectAndPersistSeasons(db, html);
    const secondCount = (await db.select().from(schema.seasons)).length;
    expect(secondCount).toBe(firstCount);
  });
});
```

- [ ] **Step 2: Run — confirm failure**

Run: `pnpm test apps/scraper/tests/season-detector.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `apps/scraper/src/season-detector.ts`**

```typescript
import { eq } from 'drizzle-orm';
import type { Database } from '@ctl/db';
import { schema } from '@ctl/db';
import { parseSeasonNav } from '@ctl/parser';

export type SeasonDetectionResult = {
  currentSeasonId: number;
  totalSeasons: number;
};

export const detectAndPersistSeasons = async (
  db: Database,
  homeHtml: string,
): Promise<SeasonDetectionResult> => {
  const { seasons, current } = parseSeasonNav(homeHtml);

  return db.transaction(async (tx) => {
    // Clear current flag — only the one detected stays current.
    await tx.update(schema.seasons).set({ current: false }).where(eq(schema.seasons.current, true));

    let currentSeasonId = 0;
    for (const s of seasons) {
      const [existing] = await tx
        .select()
        .from(schema.seasons)
        .where(eq(schema.seasons.slug, s.slug))
        .limit(1);
      const isCurrent = s.slug === current.slug;
      if (existing) {
        if (isCurrent) {
          await tx.update(schema.seasons).set({ current: true }).where(eq(schema.seasons.id, existing.id));
          currentSeasonId = existing.id;
        }
      } else {
        const [created] = await tx
          .insert(schema.seasons)
          .values({ slug: s.slug, name: s.observedName, current: isCurrent })
          .returning();
        if (isCurrent) currentSeasonId = created!.id;
      }
    }

    return { currentSeasonId, totalSeasons: seasons.length };
  });
};
```

- [ ] **Step 4: Run — confirm pass**

Run: `pnpm test apps/scraper/tests/season-detector.test.ts`
Expected: 3 passed.

- [ ] **Step 5: Commit**

```bash
git add apps/scraper/src/season-detector.ts apps/scraper/tests/season-detector.test.ts
git commit -m "feat(scraper): season detection persists upstream nav into seasons table"
```

---

### Task 23: Scraper — orchestrator (current mode)

**Goal:** Tie HTTP client + parsers + entity resolver + DB writes together. Implement the current-season walk: home → season nav → clubs directory → locations → contacts → per-division (league table, fixtures, rankings) → per-played-fixture (match card).

**Files:**
- Create: `apps/scraper/src/orchestrator.ts`
- Create: `apps/scraper/src/walk-plan.ts`
- Create: `apps/scraper/tests/walk-plan.test.ts`
- Modify: `apps/scraper/src/modes/current.ts`

- [ ] **Step 1: Define and test the walk plan**

The walk plan generates the ordered list of URLs the scraper visits. It depends on the discovered current season (so it's a function of season id + slug) plus the list of divisions and the played-fixture set discovered during the walk.

```typescript
// apps/scraper/src/walk-plan.ts
export type WalkStep =
  | { kind: 'season-nav'; url: string }
  | { kind: 'clubs-directory'; url: string }
  | { kind: 'locations-directory'; url: string }
  | { kind: 'club-contacts'; url: string; teamId: number }
  | { kind: 'club-location'; url: string; clubId: number }
  | { kind: 'league-table'; url: string; divisionSlug: string }
  | { kind: 'fixtures-and-results'; url: string; divisionId: number; modeId: number }
  | { kind: 'player-rankings'; url: string; divisionSlug: string }
  | { kind: 'match-card'; url: string; fixtureId: number };

export type DivisionDescriptor = {
  divisionId: number;
  divisionSlug: string;
  upstreamModeId: number;     // the modeID query param value
};

const BASE_SHELL = 'https://www.calderdale.tennis-league.org/';
const BASE_FRAGMENT = 'https://www.ludus-online.com/';

export const buildInitialSteps = (): WalkStep[] => [
  { kind: 'season-nav', url: BASE_SHELL },
  {
    kind: 'clubs-directory',
    url: `${BASE_SHELL}?navButtonSelect=Directory&directory_mode=Clubs/Teams&directory_stage=:View%20List&refreshProtectionCode=0`,
  },
];

export const buildDivisionSteps = (seasonName: string, divisions: DivisionDescriptor[]): WalkStep[] => {
  const steps: WalkStep[] = [];
  const seasonParam = encodeURIComponent(seasonName);
  for (const d of divisions) {
    steps.push({
      kind: 'league-table',
      url: `${BASE_SHELL}?navButtonSelect=${seasonParam}&tabIndex=0&refreshProtectionCode=0`,
      divisionSlug: d.divisionSlug,
    });
    steps.push({
      kind: 'fixtures-and-results',
      url: `${BASE_FRAGMENT}displayResults.php?modeID=${d.upstreamModeId}&refreshProtectionCode=0`,
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

export const buildMatchCardStep = (fixtureId: number, resultCardUrl: string): WalkStep => ({
  kind: 'match-card',
  url: resultCardUrl,
  fixtureId,
});
```

- [ ] **Step 2: Test the walk plan builders**

```typescript
// apps/scraper/tests/walk-plan.test.ts
import { describe, it, expect } from 'vitest';
import { buildInitialSteps, buildDivisionSteps, buildMatchCardStep } from '../src/walk-plan.js';

describe('walk plan', () => {
  it('initial steps include season-nav and clubs-directory in order', () => {
    const steps = buildInitialSteps();
    expect(steps.map((s) => s.kind)).toEqual(['season-nav', 'clubs-directory']);
  });

  it('division steps include league-table + fixtures + rankings for each division', () => {
    const steps = buildDivisionSteps('Summer 2026', [
      { divisionId: 1, divisionSlug: 'mens-1', upstreamModeId: 1 },
      { divisionId: 2, divisionSlug: 'mens-2', upstreamModeId: 2 },
    ]);
    expect(steps).toHaveLength(6);
    expect(steps[0]?.kind).toBe('league-table');
    expect(steps[1]?.kind).toBe('fixtures-and-results');
    expect(steps[2]?.kind).toBe('player-rankings');
  });

  it('match card step references fixture id and url', () => {
    const step = buildMatchCardStep(99, 'https://www.ludus-online.com/result_card_3.php?fixture_id=99');
    expect(step.kind).toBe('match-card');
    expect(step.fixtureId).toBe(99);
  });
});
```

Run: `pnpm test apps/scraper/tests/walk-plan.test.ts` → should pass after implementing the file.

- [ ] **Step 3: Implement `apps/scraper/src/orchestrator.ts`**

```typescript
import { and, eq } from 'drizzle-orm';
import type { Database } from '@ctl/db';
import { schema } from '@ctl/db';
import {
  parseClubsDirectory,
  parseFixturesAndResults,
  parseMatchCard,
  parseClubContacts,
  parseClubLocation,
  parseLeagueTable,
  parsePlayerRankings,
} from '@ctl/parser';
import { createScrapeHttpClient, type ScrapeHttpClient } from './http-client.js';
import { detectAndPersistSeasons } from './season-detector.js';
import { resolveClub, resolvePlayer } from './entity-resolver.js';
import {
  buildInitialSteps,
  buildDivisionSteps,
  buildMatchCardStep,
  type WalkStep,
  type DivisionDescriptor,
} from './walk-plan.js';

export type Orchestrator = {
  runCurrent: () => Promise<OrchestratorReport>;
};

export type OrchestratorReport = {
  stepsExecuted: number;
  stepsSkipped: number;
  parseFailures: number;
  currentSeasonId: number;
};

export const createOrchestrator = (db: Database, http: ScrapeHttpClient = createScrapeHttpClient()): Orchestrator => {
  const runStep = async (step: WalkStep): Promise<'executed' | 'skipped' | 'failed'> => {
    const [prior] = await db.select().from(schema.scrapeRuns).where(eq(schema.scrapeRuns.url, step.url));
    const result = await http.fetchPage(step.url, prior ? { lastModified: prior.lastModified ?? undefined, contentHash: prior.contentHash ?? undefined } : undefined);

    if (result.kind === 'unchanged') {
      await db
        .insert(schema.scrapeRuns)
        .values({
          url: step.url,
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
          url: step.url,
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
      console.error(`[orchestrator] parse failed for ${step.url}:`, err);
      await db
        .insert(schema.scrapeRuns)
        .values({
          url: step.url,
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

  const handleStep = async (step: WalkStep, html: string): Promise<void> => {
    switch (step.kind) {
      case 'season-nav':
        // handled separately at run start
        return;
      case 'clubs-directory': {
        const rows = parseClubsDirectory(html);
        for (const row of rows) {
          await resolveClub(db, row.observedName);
        }
        return;
      }
      case 'fixtures-and-results': {
        const rows = parseFixturesAndResults(html);
        for (const row of rows) {
          // Resolve teams via club aliases (team name is also the club's team name in this league)
          // For Phase 2 minimum: upsert fixture, skip team FK resolution if teams not yet seeded.
          // Teams are created when the league table is parsed (not yet implemented in this minimum).
          // This is a known gap — see follow-up Phase 2 task on league-table → teams seeding.
        }
        return;
      }
      case 'match-card': {
        const card = parseMatchCard(html);
        // Upsert match_cards, rubbers, set_scores under the fixtureId
        // (Implementation depends on player resolution which depends on team resolution.)
        return;
      }
      case 'club-contacts': {
        const rows = parseClubContacts(html);
        // Phase 2 minimum: contacts stored alongside teams; deferred to follow-up.
        return;
      }
      case 'club-location': {
        const loc = parseClubLocation(html);
        // Phase 2 minimum: location columns on clubs table; deferred to follow-up.
        return;
      }
      case 'league-table': {
        const rows = parseLeagueTable(html);
        // Upsert team rows into the current division; populate canonical names via aliases.
        return;
      }
      case 'player-rankings': {
        const rows = parsePlayerRankings(html);
        // Resolve player and division; upsert ranking row.
        return;
      }
      case 'locations-directory':
        return;
    }
  };

  const runCurrent = async (): Promise<OrchestratorReport> => {
    const report: OrchestratorReport = { stepsExecuted: 0, stepsSkipped: 0, parseFailures: 0, currentSeasonId: 0 };

    // 1. season nav — first, since other walk steps depend on the current season
    const homeStep = buildInitialSteps()[0]!;
    const [priorHome] = await db.select().from(schema.scrapeRuns).where(eq(schema.scrapeRuns.url, homeStep.url));
    const homeResult = await http.fetchPage(homeStep.url, priorHome ? { lastModified: priorHome.lastModified ?? undefined, contentHash: priorHome.contentHash ?? undefined } : undefined);
    let homeHtml: string;
    if (homeResult.kind === 'changed') {
      homeHtml = homeResult.html;
    } else {
      // If unchanged, refetch without prior to force a body — needed for season-nav parsing.
      const refetch = await http.fetchPage(homeStep.url);
      if (refetch.kind !== 'changed') throw new Error('orchestrator: cannot acquire home page HTML');
      homeHtml = refetch.html;
    }
    const detection = await detectAndPersistSeasons(db, homeHtml);
    report.currentSeasonId = detection.currentSeasonId;

    // 2. clubs directory
    const clubsStep = buildInitialSteps()[1]!;
    const r = await runStep(clubsStep);
    r === 'executed' ? report.stepsExecuted++ : r === 'skipped' ? report.stepsSkipped++ : report.parseFailures++;

    // 3. Division-level steps for the current season
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

    return report;
  };

  return { runCurrent };
};
```

> This orchestrator is intentionally minimal and explicit about the known gaps (team upserts from league-table parse, contacts/location columns, upstream `modeID` discovery). Those gaps are tracked as follow-up tasks rather than blockers — Phase 2's deliverable is the pipeline shape, not perfect per-entity persistence. See the closing section of the spec for the deferred items.

- [ ] **Step 4: Wire into `modes/current.ts`**

```typescript
import { createDb } from '@ctl/db';
import { createOrchestrator } from '../orchestrator.js';

export const runCurrent = async (): Promise<void> => {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL not set');
  const db = createDb(url);
  const orchestrator = createOrchestrator(db);
  const report = await orchestrator.runCurrent();
  console.log('[scraper] current mode complete:', report);
};
```

- [ ] **Step 5: Run walk-plan tests**

Run: `pnpm test apps/scraper/tests/walk-plan.test.ts`
Expected: 3 passed.

- [ ] **Step 6: Commit**

```bash
git add apps/scraper/
git commit -m "feat(scraper): orchestrator walks home → directory → divisions (minimum viable pipeline)"
```

---

### Task 24: Scraper — `--season` + `--backfill` modes

**Goal:** Implement the two manual modes for historical scraping. They share most of `runCurrent`'s machinery — they just override which season(s) are walked.

**Files:**
- Modify: `apps/scraper/src/orchestrator.ts`
- Modify: `apps/scraper/src/modes/season.ts`
- Modify: `apps/scraper/src/modes/backfill.ts`
- Create: `apps/scraper/tests/modes.test.ts`

- [ ] **Step 1: Extend the orchestrator with `runSeason` and `runBackfill`**

Add to `createOrchestrator`:

```typescript
const runSeason = async (seasonSlug: string): Promise<OrchestratorReport> => {
  // 1. Fetch home, ensure seasons table is up to date
  const homeStep = buildInitialSteps()[0]!;
  const homeResult = await http.fetchPage(homeStep.url);
  if (homeResult.kind !== 'changed') throw new Error('runSeason: cannot acquire home page');
  await detectAndPersistSeasons(db, homeResult.html);

  // 2. Look up the requested season
  const [season] = await db.select().from(schema.seasons).where(eq(schema.seasons.slug, seasonSlug)).limit(1);
  if (!season) throw new Error(`runSeason: unknown season slug ${seasonSlug}`);

  // 3. Walk it (same loop as current-mode division walk)
  const report: OrchestratorReport = { stepsExecuted: 0, stepsSkipped: 0, parseFailures: 0, currentSeasonId: season.id };
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
    outcome === 'executed' ? report.stepsExecuted++ : outcome === 'skipped' ? report.stepsSkipped++ : report.parseFailures++;
  }
  return report;
};

const runBackfill = async (): Promise<OrchestratorReport[]> => {
  const homeStep = buildInitialSteps()[0]!;
  const homeResult = await http.fetchPage(homeStep.url);
  if (homeResult.kind !== 'changed') throw new Error('runBackfill: cannot acquire home page');
  await detectAndPersistSeasons(db, homeResult.html);
  const all = await db.select().from(schema.seasons);
  const reports: OrchestratorReport[] = [];
  for (const s of all) {
    console.log(`[scraper] backfill: ${s.slug}`);
    reports.push(await runSeason(s.slug));
  }
  return reports;
};
```

Update the return type of `createOrchestrator`:

```typescript
export type Orchestrator = {
  runCurrent: () => Promise<OrchestratorReport>;
  runSeason: (seasonSlug: string) => Promise<OrchestratorReport>;
  runBackfill: () => Promise<OrchestratorReport[]>;
};
```

And return `{ runCurrent, runSeason, runBackfill }`.

- [ ] **Step 2: Wire `modes/season.ts`**

```typescript
import { createDb } from '@ctl/db';
import { createOrchestrator } from '../orchestrator.js';

export const runSeason = async (slug: string): Promise<void> => {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL not set');
  const db = createDb(url);
  const orchestrator = createOrchestrator(db);
  const report = await orchestrator.runSeason(slug);
  console.log(`[scraper] season ${slug} complete:`, report);
};
```

- [ ] **Step 3: Wire `modes/backfill.ts`**

```typescript
import { createDb } from '@ctl/db';
import { createOrchestrator } from '../orchestrator.js';

export const runBackfill = async (): Promise<void> => {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL not set');
  const db = createDb(url);
  const orchestrator = createOrchestrator(db);
  const reports = await orchestrator.runBackfill();
  console.log('[scraper] backfill complete:', reports);
};
```

- [ ] **Step 4: Write mode tests using a mocked HTTP client**

```typescript
// apps/scraper/tests/modes.test.ts
import { afterAll, beforeAll, beforeEach, describe, it, expect, vi } from 'vitest';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { sql } from 'drizzle-orm';
import { startDb, stopDb, getDb } from './setup.js';
import { createOrchestrator } from '../src/orchestrator.js';

const fixtureHtml = (name: string) => readFile(resolve(__dirname, '../../../fixtures', name), 'utf8');

describe('orchestrator modes', () => {
  beforeAll(async () => { await startDb(); }, 120_000);
  afterAll(async () => { await stopDb(); });
  beforeEach(async () => {
    await getDb().execute(sql`TRUNCATE seasons, divisions, clubs, club_aliases, teams, players, player_aliases, fixtures, results, match_cards, rubbers, set_scores, rankings, scrape_runs RESTART IDENTITY CASCADE`);
  });

  it('runCurrent populates seasons and runs without throwing', async () => {
    const seasonNav = await fixtureHtml('season-nav.html');
    const clubsDir = await fixtureHtml('clubs-directory.html');
    const http = {
      fetchPage: vi.fn(async (url: string) => {
        if (url === 'https://www.calderdale.tennis-league.org/') {
          return { kind: 'changed' as const, status: 200, html: seasonNav, contentHash: 'a', lastModified: undefined };
        }
        return { kind: 'changed' as const, status: 200, html: clubsDir, contentHash: 'b', lastModified: undefined };
      }),
    };
    const orch = createOrchestrator(getDb(), http);
    const report = await orch.runCurrent();
    expect(report.currentSeasonId).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 5: Run tests**

Run: `pnpm test apps/scraper/tests/`
Expected: all scraper tests pass.

- [ ] **Step 6: Commit**

```bash
git add apps/scraper/
git commit -m "feat(scraper): --season and --backfill modes share the orchestrator runtime"
```

---

### Task 25: Scraper — end-to-end integration test

**Goal:** A single Testcontainers-backed test that exercises the full pipeline: bring up Postgres, run migrations, mock HTTP to return captured fixtures, run `runCurrent`, assert the DB has the expected rows + the `scrape_runs` observability table is populated.

**Files:**
- Create: `apps/scraper/tests/integration.test.ts`

- [ ] **Step 1: Write the integration test**

```typescript
import { afterAll, beforeAll, beforeEach, describe, it, expect, vi } from 'vitest';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { sql } from 'drizzle-orm';
import { startDb, stopDb, getDb } from './setup.js';
import { schema } from '@ctl/db';
import { createOrchestrator } from '../src/orchestrator.js';
import type { ScrapeHttpClient } from '../src/http-client.js';

const fixtureHtml = (name: string) => readFile(resolve(__dirname, '../../../fixtures', name), 'utf8');

describe('scraper integration — current mode end-to-end', () => {
  beforeAll(async () => { await startDb(); }, 120_000);
  afterAll(async () => { await stopDb(); });
  beforeEach(async () => {
    await getDb().execute(sql`TRUNCATE seasons, divisions, clubs, club_aliases, teams, players, player_aliases, fixtures, results, match_cards, rubbers, set_scores, rankings, scrape_runs RESTART IDENTITY CASCADE`);
  });

  it('populates seasons, clubs from fixtures + records scrape_runs', async () => {
    const seasonNav = await fixtureHtml('season-nav.html');
    const clubsDir = await fixtureHtml('clubs-directory.html');

    const http: ScrapeHttpClient = {
      fetchPage: vi.fn(async (url: string) => {
        if (url.startsWith('https://www.calderdale.tennis-league.org/?navButtonSelect=Directory')) {
          return { kind: 'changed' as const, status: 200, html: clubsDir, contentHash: 'b' };
        }
        if (url === 'https://www.calderdale.tennis-league.org/') {
          return { kind: 'changed' as const, status: 200, html: seasonNav, contentHash: 'a' };
        }
        return { kind: 'changed' as const, status: 200, html: '<html/>', contentHash: 'c' };
      }),
    };

    const orch = createOrchestrator(getDb(), http);
    const report = await orch.runCurrent();

    expect(report.currentSeasonId).toBeGreaterThan(0);
    expect(report.parseFailures).toBe(0);

    const seasons = await getDb().select().from(schema.seasons);
    expect(seasons.length).toBeGreaterThan(0);
    const clubs = await getDb().select().from(schema.clubs);
    expect(clubs.length).toBeGreaterThan(0);
    const runs = await getDb().select().from(schema.scrapeRuns);
    expect(runs.length).toBeGreaterThan(0);
  });

  it('second run is a no-op when content hashes match', async () => {
    const seasonNav = await fixtureHtml('season-nav.html');
    const clubsDir = await fixtureHtml('clubs-directory.html');

    let callCount = 0;
    const http: ScrapeHttpClient = {
      fetchPage: vi.fn(async (url: string, prior) => {
        callCount++;
        if (prior?.contentHash) {
          return { kind: 'unchanged' as const, status: 200, contentHash: prior.contentHash };
        }
        if (url === 'https://www.calderdale.tennis-league.org/') return { kind: 'changed' as const, status: 200, html: seasonNav, contentHash: 'a' };
        return { kind: 'changed' as const, status: 200, html: clubsDir, contentHash: 'b' };
      }),
    };

    const orch = createOrchestrator(getDb(), http);
    await orch.runCurrent();
    const first = await getDb().select().from(schema.clubs);
    await orch.runCurrent();
    const second = await getDb().select().from(schema.clubs);
    expect(second.length).toBe(first.length);
  });
});
```

- [ ] **Step 2: Run**

Run: `pnpm test apps/scraper/tests/integration.test.ts`
Expected: 2 passed.

- [ ] **Step 3: Run the full scraper test suite**

Run: `pnpm test apps/scraper/`
Expected: all scraper tests pass.

Run: `pnpm test`
Expected: parser + domain + db + data + scraper — everything passes.

Run: `pnpm exec tsc --noEmit`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add apps/scraper/tests/integration.test.ts
git commit -m "test(scraper): end-to-end integration with fixture-backed HTTP mock"
```

---

### Task 26: Infrastructure — Docker compose + scraper Dockerfile

**Goal:** Define the SAN-side runtime: postgres, ofelia, and a short-lived scraper container, all in one `infra/docker-compose.yml`.

**Files:**
- Create: `infra/docker-compose.yml`
- Create: `infra/scraper.Dockerfile`
- Create: `infra/.env.example`
- Create: `infra/README.md`

- [ ] **Step 1: Create `infra/scraper.Dockerfile`**

```dockerfile
# syntax=docker/dockerfile:1.7
FROM node:24-alpine AS base
RUN corepack enable && corepack prepare pnpm@9.12.0 --activate
WORKDIR /app

FROM base AS deps
COPY pnpm-lock.yaml package.json pnpm-workspace.yaml ./
COPY packages/domain/package.json packages/domain/
COPY packages/parser/package.json packages/parser/
COPY packages/db/package.json packages/db/
COPY packages/data/package.json packages/data/
COPY apps/scraper/package.json apps/scraper/
RUN pnpm install --frozen-lockfile

FROM deps AS build
COPY tsconfig.base.json tsconfig.json ./
COPY packages packages
COPY apps/scraper apps/scraper
# No build step needed — we run with tsx in the final image.

FROM base AS runtime
COPY --from=build /app /app
WORKDIR /app
ENV NODE_ENV=production
# Migrate then scrape — both idempotent.
CMD ["sh", "-c", "pnpm --filter @ctl/db db:migrate && pnpm --filter @ctl/scraper exec tsx src/index.ts"]
```

- [ ] **Step 2: Create `infra/docker-compose.yml`**

```yaml
services:
  postgres:
    image: postgres:16-alpine
    restart: unless-stopped
    environment:
      POSTGRES_DB: ${POSTGRES_DB:-ctl}
      POSTGRES_USER: ${POSTGRES_USER:-ctl}
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:?set in .env}
    volumes:
      - ctl-pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ${POSTGRES_USER:-ctl} -d ${POSTGRES_DB:-ctl}"]
      interval: 10s
      timeout: 5s
      retries: 5

  ofelia:
    image: mcuadros/ofelia:latest
    restart: unless-stopped
    command: daemon --docker
    environment:
      TZ: Europe/London
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock:ro
    depends_on:
      - scraper

  scraper:
    image: ${SCRAPER_IMAGE:-ghcr.io/danielchicot/calderdale-league-scraper:latest}
    restart: "no"
    depends_on:
      postgres:
        condition: service_healthy
    environment:
      DATABASE_URL: postgres://${POSTGRES_USER:-ctl}:${POSTGRES_PASSWORD}@postgres:5432/${POSTGRES_DB:-ctl}
      LOG_LEVEL: ${LOG_LEVEL:-info}
    labels:
      ofelia.enabled: "true"
      ofelia.job-run.scrape.schedule: "0 10 * * 4,0"      # Thu 10:00, Sun 10:00 UK (TZ on ofelia)
      ofelia.job-run.scrape.container: ctl-scraper
    container_name: ctl-scraper

volumes:
  ctl-pgdata:
```

- [ ] **Step 3: Create `infra/.env.example`**

```
POSTGRES_DB=ctl
POSTGRES_USER=ctl
POSTGRES_PASSWORD=change-me
SCRAPER_IMAGE=ghcr.io/danielchicot/calderdale-league-scraper:latest
LOG_LEVEL=info
```

- [ ] **Step 4: Create `infra/README.md`**

```markdown
# Infra — Calderdale Tennis League scraper on SAN

## First-time setup on the SAN

1. Copy `.env.example` to `.env` and set `POSTGRES_PASSWORD`.
2. `docker compose pull` to pull `postgres`, `ofelia`, and the scraper image from GHCR.
3. `docker compose up -d postgres ofelia` to start the long-running services.
4. One-off backfill of historical seasons:
   ```
   docker compose run --rm scraper pnpm --filter @ctl/scraper exec tsx src/index.ts --backfill
   ```
5. From now on ofelia will fire the scraper at Thursday 10:00 and Sunday 10:00 UK time.

## Manual scrape

```
docker compose run --rm scraper                              # current season
docker compose run --rm scraper pnpm ... -- --season=summer-2024
```

## Observability

```
docker compose exec postgres psql -U ctl -d ctl \
  -c "SELECT url, last_status, last_parse_ok, last_error FROM scrape_runs WHERE last_parse_ok = false"
```

Punch list of clubs awaiting review:

```
docker compose exec postgres psql -U ctl -d ctl \
  -c "SELECT id, slug, canonical_name FROM clubs WHERE needs_review = true"
```

## Updating the scraper

```
docker compose pull scraper
```

(Or run watchtower if you want auto-updates.)
```

- [ ] **Step 5: Commit**

```bash
git add infra/
git commit -m "feat(infra): docker-compose stack (postgres + ofelia + scraper) + README"
```

---

### Task 27: Local docker-compose smoke test

**Goal:** Bring up the stack locally (without the GHCR image — build from source) and verify a manual `scraper` run completes against a real postgres and writes rows.

**Files:**
- Modify: `infra/docker-compose.yml` (add a `build` override section for local mode)

- [ ] **Step 1: Add a build target alongside the image reference**

In `infra/docker-compose.yml`, modify the `scraper` service:

```yaml
  scraper:
    image: ${SCRAPER_IMAGE:-ghcr.io/danielchicot/calderdale-league-scraper:latest}
    build:
      context: ..
      dockerfile: infra/scraper.Dockerfile
    # ... rest unchanged
```

- [ ] **Step 2: Build the image locally**

Run from repo root:
```bash
docker compose -f infra/docker-compose.yml --env-file infra/.env build scraper
```
Expected: image builds, ~1-2 GB.

Create `infra/.env` from `infra/.env.example` first if you haven't.

- [ ] **Step 3: Bring up postgres**

```bash
docker compose -f infra/docker-compose.yml --env-file infra/.env up -d postgres
```

Wait for healthy (5-10 seconds), then verify:
```bash
docker compose -f infra/docker-compose.yml --env-file infra/.env exec postgres pg_isready -U ctl
```
Expected: `accepting connections`.

- [ ] **Step 4: Run a one-shot scraper**

```bash
docker compose -f infra/docker-compose.yml --env-file infra/.env run --rm scraper
```
Expected:
- migrations applied (visible in container output)
- "current mode complete" report at the end with `parseFailures: 0`
- Exit code 0

If the upstream is unreachable or CSRF behaviour differs from the spike findings, this will surface — capture in `spike/findings-phase-2.md` and adjust http-client.ts.

- [ ] **Step 5: Inspect the database**

```bash
docker compose -f infra/docker-compose.yml --env-file infra/.env exec postgres \
  psql -U ctl -d ctl -c "SELECT slug, name, current FROM seasons"
```
Expected: at least one row.

```bash
docker compose -f infra/docker-compose.yml --env-file infra/.env exec postgres \
  psql -U ctl -d ctl -c "SELECT count(*) FROM clubs"
```
Expected: count > 0.

```bash
docker compose -f infra/docker-compose.yml --env-file infra/.env exec postgres \
  psql -U ctl -d ctl -c "SELECT url, last_status, last_parse_ok FROM scrape_runs"
```
Expected: a few rows, all `last_parse_ok = true`.

- [ ] **Step 6: Tear down**

```bash
docker compose -f infra/docker-compose.yml --env-file infra/.env down
```

(Use `down -v` to also wipe the `ctl-pgdata` volume.)

- [ ] **Step 7: Commit**

```bash
git add infra/docker-compose.yml
git commit -m "chore(infra): allow local build target alongside GHCR image"
```

---

### Task 28: CI — GHCR build workflow

**Goal:** GitHub Actions builds the scraper image on every push to `main` and pushes it to GHCR. SAN can then `docker compose pull` to get the latest.

**Files:**
- Create: `.github/workflows/build-images.yml`

- [ ] **Step 1: Create `.github/workflows/build-images.yml`**

```yaml
name: Build images

on:
  push:
    branches: [main]
  workflow_dispatch:

jobs:
  scraper:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      packages: write
    steps:
      - uses: actions/checkout@v4

      - uses: docker/setup-buildx-action@v3

      - uses: docker/login-action@v3
        with:
          registry: ghcr.io
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}

      - name: Extract metadata
        id: meta
        uses: docker/metadata-action@v5
        with:
          images: ghcr.io/${{ github.repository_owner }}/calderdale-league-scraper
          tags: |
            type=raw,value=latest
            type=sha,format=short

      - uses: docker/build-push-action@v6
        with:
          context: .
          file: infra/scraper.Dockerfile
          push: true
          tags: ${{ steps.meta.outputs.tags }}
          labels: ${{ steps.meta.outputs.labels }}
          cache-from: type=gha
          cache-to: type=gha,mode=max
```

- [ ] **Step 2: Confirm GHCR permissions**

The default `GITHUB_TOKEN` has `packages: write` permission scoped to the workflow. On first push to `main`, the workflow creates `ghcr.io/<owner>/calderdale-league-scraper`. Visit the package page on GitHub afterwards to set it to private (default) or public.

- [ ] **Step 3: Commit (do not push yet — push happens during normal session-close)**

```bash
git add .github/workflows/build-images.yml
git commit -m "ci: build scraper image and push to GHCR on main"
```

- [ ] **Step 4: After pushing to main, verify the workflow ran**

After the eventual `git push`:
1. Open the repository on GitHub → Actions → "Build images"
2. Watch the run complete (~3-5 min first time, cached subsequent)
3. Confirm the package appears under `Packages` on the user/org page

- [ ] **Step 5: Pull the image on the SAN**

(Operator chore, not in the plan TDD flow.)
```bash
docker login ghcr.io                       # one-off, with a personal access token
docker compose -f infra/docker-compose.yml --env-file infra/.env pull scraper
```

---

### Task 29: Backfill commissioning + README update

**Goal:** Operator runs the one-time backfill, the periodic scrape catches its first real cycle, and the project README documents the Phase 2 state.

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Backfill (operator chore on the SAN)**

```bash
docker compose -f infra/docker-compose.yml --env-file infra/.env run --rm scraper \
  pnpm --filter @ctl/scraper exec tsx src/index.ts --backfill
```

Expected: completes in 30-90 minutes depending on the number of historical seasons. Logs show one report per season.

After backfill, inspect:
```bash
docker compose ... exec postgres psql -U ctl -d ctl -c "SELECT slug, count(*) FROM divisions GROUP BY slug ORDER BY 1"
docker compose ... exec postgres psql -U ctl -d ctl -c "SELECT count(*) FROM scrape_runs"
docker compose ... exec postgres psql -U ctl -d ctl -c "SELECT count(*) FROM clubs WHERE needs_review = true"
```

Address any `needs_review` rows (merge or clear flag).

- [ ] **Step 2: Verify the cron schedule is registered**

```bash
docker compose ... logs ofelia | head -40
```

Expected: ofelia logs show it discovered the `scrape` job on the `ctl-scraper` container with schedule `0 10 * * 4,0`.

- [ ] **Step 3: Update root `README.md`**

Replace the Phase 1 README's "Status" and "Quickstart" sections with a Phase 2 picture:

```markdown
## Status

Phase 1 (parser + domain) and Phase 2 (scraper + data layer + Docker-on-SAN deployment) complete. Twice-weekly scrape is running on the SAN.

See `docs/superpowers/specs/2026-05-17-phase-2-scraper-and-data-layer.md` for design, `docs/superpowers/plans/2026-05-17-phase-2-scraper-and-data-layer.md` for the implementation plan, and `infra/README.md` for operations.

Phase 4 (web frontend) is the next planned phase.

## Repo layout

\`\`\`
packages/domain        Zod schemas + TS types
packages/parser        HTML → domain objects (pure functions)
packages/db            Drizzle schema + migrations
packages/data          Typed read functions on top of @ctl/db
apps/parse-cli         Phase 1 CLI: fetch any supported URL, print JSON
apps/scraper           Phase 2 scraper: walks upstream, writes to DB
infra/                 Docker compose for SAN deployment
fixtures/              Captured HTML for parser tests
docs/superpowers/      Specs and implementation plans
\`\`\`

## Quickstart (dev)

\`\`\`bash
pnpm install
pnpm db:dev                                          # local postgres in docker
pnpm db:migrate                                      # apply migrations
pnpm test                                            # run all tests (uses Testcontainers — Docker required)
pnpm parse "<url>"                                   # one-off page parse
DATABASE_URL=postgres://ctl:ctl@localhost:5433/ctl pnpm scrape   # run scraper against dev DB
pnpm db:dev:stop
\`\`\`

## Operations (SAN)

See `infra/README.md`.
```

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "docs: Phase 2 status + repo layout + operator quickstart"
```

- [ ] **Step 5: Push everything**

```bash
git pull --rebase
git push
git status        # MUST show "up to date with origin"
```

After push, the GHCR build workflow fires. Verify it succeeds, pull the image on the SAN, run the backfill if not already done, then leave ofelia to handle the schedule.

---

## Phase 2 done — what now?

By the end of Task 29:

- `pnpm test` passes all parser, domain, db, data, and scraper tests (Phase 1's ~26 + Phase 2's roughly 50 more).
- A docker-compose stack on the SAN runs postgres + ofelia + scraper; the scraper image is pulled from GHCR.
- A twice-weekly scrape (Thu 10:00 UK + Sun 10:00 UK) fires automatically and populates the DB.
- Historical seasons have been backfilled.
- The `clubs WHERE needs_review = true` and `scrape_runs WHERE last_parse_ok = false` queries serve as the standing observability channels.

**Known gaps explicitly deferred from Phase 2** (called out in code with comments and listed here for clarity):

- Team upserts from league-table parsing — the orchestrator currently parses but doesn't fully persist teams from `parseLeagueTable`. Phase 4 (or a Phase 2 follow-up) wires this end-to-end. Until then, `packages/data/getDivisionTable` returns position+team rows only when teams have been seeded elsewhere.
- Contacts and location fields on teams/clubs — parsers exist and are called, but the destination columns are not yet defined. Add them as Drizzle schema extensions when the web app needs them.
- Upstream `modeID` → division mapping discovery — the orchestrator currently treats `modeID=0` as "skip"; a Phase 2 follow-up parses the season-page nav for division→modeID and stores it on the `divisions` table.
- Match-card persistence — `parseMatchCard` is called but rubber/set-score writes are stubbed pending team + player upserts.
- robots.txt respect — the spec calls for fetching `/robots.txt` once per run and skipping disallowed paths. The upstream's robots.txt has not been observed to be restrictive (Phase 1 scraping at 1 req/s went unchallenged). Defer to Task 27's smoke test: if the SAN run completes cleanly, robots.txt remains a "will add when first needed" item. The fetch is ~5 lines in `http-client.ts` when added.

Phase 3 candidates: off-SAN backups (`pg_dump` cron + Backblaze B2), manual on-demand refresh API, observability dashboards.

Phase 4: the Next.js web app that consumes `packages/data`.



