# Phase 1: Foundation, Parser, Domain — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A working `pnpm parse <url>` CLI that fetches any supported public page on `https://www.calderdale.tennis-league.org/`, parses it into validated JSON, and prints to stdout. Three page types covered end-to-end (clubs/teams directory, league table, player rankings) — proves the entire pipeline (fetch → parse → validate → emit JSON) works, and de-risks the `refreshProtectionCode` session token concern from the spec.

**Architecture:** pnpm workspaces monorepo skeleton. `packages/domain` defines Zod schemas + inferred TS types for every entity. `packages/parser` exports pure functions of shape `(html: string) => DomainObject` — one per page type, fully testable against captured HTML fixtures with no network. `apps/parse-cli` is a thin wrapper: page-type detection from URL → fetch → parse → JSON.stringify → stdout. Functional style throughout (no classes), `unknown` over `any`, Zod's `.parse` at the seam between HTML and the domain.

**Tech Stack:** TypeScript 5.6, pnpm 9, Vitest, Zod 3, cheerio, tsx, undici, ESLint with typescript-eslint, Prettier.

---

## File structure at end of phase

```
calderdale-tennis-league/
├── package.json                          (root, workspace orchestration)
├── pnpm-workspace.yaml
├── tsconfig.base.json
├── tsconfig.json
├── .prettierrc.json
├── eslint.config.js
├── vitest.config.ts
├── .npmrc
├── packages/
│   ├── domain/
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   ├── src/
│   │   │   ├── index.ts                  (re-exports)
│   │   │   ├── primitives.ts             (Slug, BtmNumber, etc.)
│   │   │   ├── club.ts                   (Club, Location)
│   │   │   ├── team.ts
│   │   │   ├── division.ts
│   │   │   ├── season.ts
│   │   │   ├── player.ts
│   │   │   ├── fixture.ts
│   │   │   ├── result.ts                 (Result, MatchCard, Rubber)
│   │   │   └── ranking.ts
│   │   └── tests/
│   │       └── round-trip.test.ts        (parse → encode → reparse)
│   └── parser/
│       ├── package.json
│       ├── tsconfig.json
│       ├── src/
│       │   ├── index.ts                  (public API: parsers + types)
│       │   ├── http.ts                   (fetch with CSRF strategy)
│       │   ├── page-type.ts              (URL → PageType detection)
│       │   ├── helpers.ts                (cheerio utilities)
│       │   ├── parse-clubs-directory.ts
│       │   ├── parse-league-table.ts
│       │   └── parse-player-rankings.ts
│       └── tests/
│           ├── parse-clubs-directory.test.ts
│           ├── parse-league-table.test.ts
│           ├── parse-player-rankings.test.ts
│           └── http.test.ts              (CSRF strategy)
├── apps/
│   └── parse-cli/
│       ├── package.json
│       ├── tsconfig.json
│       ├── src/
│       │   └── index.ts                  (CLI entry)
│       └── README.md
└── fixtures/
    ├── README.md                         (how to capture/refresh fixtures)
    ├── capture.ts                        (helper to fetch + save)
    ├── clubs-directory.html
    ├── league-table-mens-div-1.html
    └── player-rankings-mens-div-1.html
```

---

## Tasks

### Task 1: Initialize pnpm monorepo and base tooling

**Files:**
- Create: `package.json`
- Create: `pnpm-workspace.yaml`
- Create: `tsconfig.base.json`
- Create: `tsconfig.json`
- Create: `.npmrc`
- Create: `.prettierrc.json`
- Create: `eslint.config.js`
- Create: `vitest.config.ts`

- [ ] **Step 1: Verify pnpm is installed**

Run: `pnpm --version`
Expected: `9.x.x` or higher. If missing: `corepack enable && corepack prepare pnpm@latest --activate`.

- [ ] **Step 2: Create root `package.json`**

```json
{
  "name": "calderdale-tennis-league",
  "private": true,
  "type": "module",
  "packageManager": "pnpm@9.12.0",
  "scripts": {
    "build": "pnpm -r build",
    "test": "vitest run",
    "test:watch": "vitest",
    "lint": "eslint .",
    "format": "prettier --write .",
    "format:check": "prettier --check .",
    "parse": "pnpm --filter parse-cli exec tsx src/index.ts"
  },
  "devDependencies": {
    "@types/node": "^22.7.0",
    "@vitest/coverage-v8": "^2.1.0",
    "eslint": "^9.12.0",
    "prettier": "^3.3.3",
    "tsx": "^4.19.1",
    "typescript": "^5.6.2",
    "typescript-eslint": "^8.8.0",
    "vitest": "^2.1.0"
  }
}
```

- [ ] **Step 3: Create `pnpm-workspace.yaml`**

```yaml
packages:
  - 'packages/*'
  - 'apps/*'
```

- [ ] **Step 4: Create `.npmrc`**

```
strict-peer-dependencies=false
auto-install-peers=true
```

- [ ] **Step 5: Create `tsconfig.base.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "lib": ["ES2022"],
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "noImplicitOverride": true,
    "noFallthroughCasesInSwitch": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "isolatedModules": true,
    "verbatimModuleSyntax": true
  }
}
```

- [ ] **Step 6: Create root `tsconfig.json`**

```json
{
  "extends": "./tsconfig.base.json",
  "compilerOptions": {
    "noEmit": true
  },
  "include": ["**/*.ts"],
  "exclude": ["node_modules", "**/dist"]
}
```

- [ ] **Step 7: Create `.prettierrc.json`**

```json
{
  "semi": true,
  "singleQuote": true,
  "trailingComma": "all",
  "printWidth": 100,
  "tabWidth": 2,
  "arrowParens": "always"
}
```

- [ ] **Step 8: Create `eslint.config.js`**

```javascript
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['**/dist/**', '**/node_modules/**', '**/*.config.js'],
  },
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
);
```

- [ ] **Step 9: Create `vitest.config.ts`**

```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: false,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      exclude: ['**/dist/**', '**/*.config.*', 'fixtures/**'],
    },
  },
});
```

- [ ] **Step 10: Install and verify**

Run: `pnpm install`
Expected: lockfile created, no errors.

Run: `pnpm exec tsc --noEmit`
Expected: no output (success).

Run: `pnpm test`
Expected: "No test files found" (this is fine — we have no tests yet).

- [ ] **Step 11: Commit**

```bash
git add package.json pnpm-workspace.yaml tsconfig.base.json tsconfig.json .npmrc .prettierrc.json eslint.config.js vitest.config.ts pnpm-lock.yaml
git commit -m "chore: initialize pnpm workspaces monorepo with TS, ESLint, Vitest, Prettier"
```

---

### Task 2: CSRF/session spike — investigate `refreshProtectionCode`

**Goal:** Determine empirically whether `refreshProtectionCode=0` is a working bypass for the CSRF token (which the design spec flagged as the highest unknown). The answer dictates the HTTP client design in Task 3.

**Files:**
- Create: `spike/csrf-investigation.ts`
- Create: `spike/findings.md`

- [ ] **Step 1: Create `spike/csrf-investigation.ts`**

```typescript
import { fetch } from 'undici';

const BASE = 'https://www.calderdale.tennis-league.org/';
const UA = 'CalderdaleLeagueMirror-spike/0.1 (contact: dan.chicot@gmail.com)';

const probe = async (label: string, url: string, init: RequestInit = {}) => {
  const res = await fetch(url, {
    ...init,
    headers: { 'User-Agent': UA, ...(init.headers ?? {}) },
    redirect: 'manual',
  });
  const body = await res.text();
  console.log(
    `[${label}] status=${res.status} length=${body.length} hasLeagueTable=${body.includes('League Table')}`,
  );
  return { status: res.status, body, headers: res.headers };
};

const main = async () => {
  // 1. Bare URL with no token at all
  await probe('no-token', `${BASE}?navButtonSelect=Summer%202026`);

  // 2. URL with refreshProtectionCode=0 (seen in the wild)
  await probe(
    'token-zero',
    `${BASE}?navButtonSelect=Summer%202026&refreshProtectionCode=0`,
  );

  // 3. Warm-up: fetch home, capture cookies, replay with cookie
  const home = await probe('warmup-home', BASE);
  const cookie = home.headers.get('set-cookie');
  if (cookie) {
    await probe(
      'warmup-replay',
      `${BASE}?navButtonSelect=Summer%202026`,
      { headers: { Cookie: cookie } },
    );
  }
};

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 2: Install undici at root for the spike**

Run: `pnpm add -D -w undici`

- [ ] **Step 3: Run the spike**

Run: `pnpm exec tsx spike/csrf-investigation.ts`

Look for:
- Which probes return `status=200` AND `hasLeagueTable=true`?
- Did any redirect (status 30x)?
- Does `token-zero` work without any cookie management?

- [ ] **Step 4: Document findings in `spike/findings.md`**

Write a short markdown file capturing:
- Each probe's outcome (status, content presence)
- Decision: which strategy will the HTTP client use?
  - **Best case:** `refreshProtectionCode=0` works on every URL → no session management needed.
  - **Middle case:** Cookie warm-up works → HTTP client maintains a single cookie jar across calls.
  - **Worst case:** Both fail → need to extract a fresh `refreshProtectionCode` from the home page HTML and inject into subsequent URLs.
- One paragraph: implications for `parser/src/http.ts`.

- [ ] **Step 5: Commit spike + findings**

```bash
git add spike/ pnpm-lock.yaml package.json
git commit -m "spike: investigate refreshProtectionCode CSRF strategy"
```

> The remaining tasks assume the **best or middle case**. If the spike reveals the worst case, add a sub-task to Task 3 to extract and inject tokens; everything else still holds.

---

### Task 3: Implement HTTP client in `packages/parser`

**Files:**
- Create: `packages/parser/package.json`
- Create: `packages/parser/tsconfig.json`
- Create: `packages/parser/src/http.ts`
- Create: `packages/parser/tests/http.test.ts`

- [ ] **Step 1: Create `packages/parser/package.json`**

```json
{
  "name": "@ctl/parser",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "exports": {
    ".": "./src/index.ts"
  },
  "dependencies": {
    "@ctl/domain": "workspace:*",
    "cheerio": "^1.0.0",
    "undici": "^6.20.0"
  }
}
```

- [ ] **Step 2: Create `packages/parser/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "include": ["src/**/*", "tests/**/*"]
}
```

- [ ] **Step 3: Install workspace dependencies**

Run: `pnpm install`
Expected: `@ctl/parser` linked, cheerio + undici installed.

- [ ] **Step 4: Write the failing test for `fetchHtml`**

Create `packages/parser/tests/http.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fetchHtml } from '../src/http.js';

describe('fetchHtml', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('returns body text on 200', async () => {
    const fakeFetch = vi.fn().mockResolvedValue({
      status: 200,
      text: async () => '<html>ok</html>',
      headers: new Headers(),
    });
    const html = await fetchHtml('https://example.test/page', { fetch: fakeFetch });
    expect(html).toBe('<html>ok</html>');
  });

  it('throws with status and url on non-200', async () => {
    const fakeFetch = vi.fn().mockResolvedValue({
      status: 503,
      text: async () => 'oops',
      headers: new Headers(),
    });
    await expect(fetchHtml('https://example.test/page', { fetch: fakeFetch })).rejects.toThrow(
      /503.*example\.test\/page/,
    );
  });

  it('sends a polite User-Agent', async () => {
    const fakeFetch = vi.fn().mockResolvedValue({
      status: 200,
      text: async () => '<html />',
      headers: new Headers(),
    });
    await fetchHtml('https://example.test/page', { fetch: fakeFetch });
    const init = fakeFetch.mock.calls[0]?.[1] as RequestInit;
    const headers = new Headers(init.headers);
    expect(headers.get('User-Agent')).toMatch(/CalderdaleLeagueMirror/);
  });
});
```

- [ ] **Step 5: Run the test — confirm it fails**

Run: `pnpm test packages/parser/tests/http.test.ts`
Expected: FAIL — `fetchHtml` is not defined.

- [ ] **Step 6: Implement `packages/parser/src/http.ts`**

```typescript
import { fetch as undiciFetch } from 'undici';

const USER_AGENT =
  'CalderdaleLeagueMirror/0.1 (contact: dan.chicot@gmail.com; non-affiliated personal mirror)';

type FetchLike = (url: string, init?: RequestInit) => Promise<{
  status: number;
  text(): Promise<string>;
  headers: Headers;
}>;

export type FetchHtmlOptions = {
  fetch?: FetchLike;
  headers?: Record<string, string>;
};

export const fetchHtml = async (url: string, options: FetchHtmlOptions = {}): Promise<string> => {
  const f = (options.fetch ?? (undiciFetch as unknown as FetchLike));
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

- [ ] **Step 7: Run the test — confirm it passes**

Run: `pnpm test packages/parser/tests/http.test.ts`
Expected: 3 passed.

- [ ] **Step 8: Commit**

```bash
git add packages/parser/ pnpm-lock.yaml
git commit -m "feat(parser): add fetchHtml with polite UA and dependency-injected fetch"
```

> If the spike found the worst case (need to mint and inject a token per session), add a `getOrMintToken()` helper here and a separate test for token injection. Use the same dependency-injected fetch pattern.

---

### Task 4: Define domain schemas in `packages/domain`

**Files:**
- Create: `packages/domain/package.json`
- Create: `packages/domain/tsconfig.json`
- Create: `packages/domain/src/index.ts`
- Create: `packages/domain/src/primitives.ts`
- Create: `packages/domain/src/season.ts`
- Create: `packages/domain/src/division.ts`
- Create: `packages/domain/src/club.ts`
- Create: `packages/domain/src/team.ts`
- Create: `packages/domain/src/player.ts`
- Create: `packages/domain/src/ranking.ts`
- Create: `packages/domain/src/fixture.ts`
- Create: `packages/domain/src/result.ts`
- Create: `packages/domain/tests/round-trip.test.ts`

- [ ] **Step 1: Create `packages/domain/package.json`**

```json
{
  "name": "@ctl/domain",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "exports": {
    ".": "./src/index.ts"
  },
  "dependencies": {
    "zod": "^3.23.8"
  }
}
```

- [ ] **Step 2: Create `packages/domain/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "include": ["src/**/*", "tests/**/*"]
}
```

- [ ] **Step 3: Install Zod**

Run: `pnpm install`

- [ ] **Step 4: Create `packages/domain/src/primitives.ts`**

```typescript
import { z } from 'zod';

export const Slug = z.string().regex(/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/);
export type Slug = z.infer<typeof Slug>;

export const BtmNumber = z.string().regex(/^\d{4,8}$/);
export type BtmNumber = z.infer<typeof BtmNumber>;

export const IsoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
export type IsoDate = z.infer<typeof IsoDate>;
```

- [ ] **Step 5: Create `packages/domain/src/season.ts`**

```typescript
import { z } from 'zod';
import { Slug } from './primitives.js';

export const Season = z.object({
  id: z.number().int().positive(),
  slug: Slug,
  name: z.string().min(1),
  current: z.boolean(),
});
export type Season = z.infer<typeof Season>;
```

- [ ] **Step 6: Create `packages/domain/src/division.ts`**

```typescript
import { z } from 'zod';
import { Slug } from './primitives.js';

export const DivisionGroup = z.enum(['Mixed', 'Mens', 'Ladies']);
export type DivisionGroup = z.infer<typeof DivisionGroup>;

export const Division = z.object({
  id: z.number().int().positive(),
  slug: Slug,
  name: z.string().min(1),
  group: DivisionGroup,
  seasonId: z.number().int().positive(),
});
export type Division = z.infer<typeof Division>;
```

- [ ] **Step 7: Create `packages/domain/src/club.ts`**

```typescript
import { z } from 'zod';
import { Slug } from './primitives.js';

export const Location = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  address: z.string().optional(),
  postcode: z.string().optional(),
});
export type Location = z.infer<typeof Location>;

export const Club = z.object({
  id: z.number().int().positive(),
  slug: Slug,
  name: z.string().min(1),
  location: Location.optional(),
});
export type Club = z.infer<typeof Club>;
```

- [ ] **Step 8: Create `packages/domain/src/team.ts`**

```typescript
import { z } from 'zod';
import { Slug } from './primitives.js';

export const Team = z.object({
  id: z.number().int().positive(),
  slug: Slug,
  name: z.string().min(1),
  clubId: z.number().int().positive(),
  divisionId: z.number().int().positive(),
});
export type Team = z.infer<typeof Team>;
```

- [ ] **Step 9: Create `packages/domain/src/player.ts`**

```typescript
import { z } from 'zod';
import { BtmNumber, Slug } from './primitives.js';

export const Player = z.object({
  id: z.number().int().positive(),
  slug: Slug,
  name: z.string().min(1),
  btmNumber: BtmNumber.optional(),
  clubId: z.number().int().positive(),
});
export type Player = z.infer<typeof Player>;
```

- [ ] **Step 10: Create `packages/domain/src/ranking.ts`**

```typescript
import { z } from 'zod';

export const RankingMovement = z.enum(['up', 'down', 'same', 'new']);
export type RankingMovement = z.infer<typeof RankingMovement>;

export const Ranking = z.object({
  playerId: z.number().int().positive(),
  divisionId: z.number().int().positive(),
  rank: z.number().int().positive(),
  rubbersWon: z.number().int().nonnegative(),
  rubbersPlayed: z.number().int().nonnegative(),
  gamesWon: z.number().int().nonnegative(),
  gamesPlayed: z.number().int().nonnegative(),
  rankingScore: z.number(),
  movement: RankingMovement,
});
export type Ranking = z.infer<typeof Ranking>;
```

- [ ] **Step 11: Create `packages/domain/src/fixture.ts`**

```typescript
import { z } from 'zod';
import { IsoDate } from './primitives.js';

export const FixtureStatus = z.enum([
  'scheduled',
  'completed',
  'postponed',
  'unfinished',
  'rearranged-postponed',
  'rearranged-unfinished',
  'rubbers-conceded',
  'match-conceded',
]);
export type FixtureStatus = z.infer<typeof FixtureStatus>;

export const Fixture = z.object({
  id: z.number().int().positive(),
  date: IsoDate,
  homeTeamId: z.number().int().positive(),
  awayTeamId: z.number().int().positive(),
  divisionId: z.number().int().positive(),
  status: FixtureStatus,
});
export type Fixture = z.infer<typeof Fixture>;
```

- [ ] **Step 12: Create `packages/domain/src/result.ts`**

```typescript
import { z } from 'zod';

export const SetScore = z.object({
  home: z.number().int().nonnegative(),
  away: z.number().int().nonnegative(),
});
export type SetScore = z.infer<typeof SetScore>;

export const Rubber = z.object({
  homePlayerIds: z.array(z.number().int().positive()).min(1).max(2),
  awayPlayerIds: z.array(z.number().int().positive()).min(1).max(2),
  sets: z.array(SetScore),
});
export type Rubber = z.infer<typeof Rubber>;

export const MatchCard = z.object({
  fixtureId: z.number().int().positive(),
  rubbers: z.array(Rubber),
});
export type MatchCard = z.infer<typeof MatchCard>;

export const Result = z.object({
  fixtureId: z.number().int().positive(),
  homeScore: z.number().int().nonnegative(),
  awayScore: z.number().int().nonnegative(),
  matchCard: MatchCard.optional(),
});
export type Result = z.infer<typeof Result>;
```

- [ ] **Step 13: Create `packages/domain/src/index.ts`**

```typescript
export * from './primitives.js';
export * from './season.js';
export * from './division.js';
export * from './club.js';
export * from './team.js';
export * from './player.js';
export * from './ranking.js';
export * from './fixture.js';
export * from './result.js';
```

- [ ] **Step 14: Write round-trip tests**

Create `packages/domain/tests/round-trip.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { Club, Division, Player, Ranking, Fixture, Result } from '../src/index.js';

describe('domain round-trip (parse → serialise → re-parse)', () => {
  it('Club survives JSON round-trip', () => {
    const original: Club = {
      id: 1,
      slug: 'halifax-queens',
      name: 'Halifax Queens',
      location: { lat: 53.7, lng: -1.86 },
    };
    const reparsed = Club.parse(JSON.parse(JSON.stringify(original)));
    expect(reparsed).toEqual(original);
  });

  it('Division enforces group enum', () => {
    expect(() =>
      Division.parse({ id: 1, slug: 'd', name: 'D', group: 'Junior', seasonId: 1 }),
    ).toThrow();
  });

  it('Ranking rejects negative rubbers', () => {
    expect(() =>
      Ranking.parse({
        playerId: 1,
        divisionId: 1,
        rank: 1,
        rubbersWon: -1,
        rubbersPlayed: 0,
        gamesWon: 0,
        gamesPlayed: 0,
        rankingScore: 0,
        movement: 'same',
      }),
    ).toThrow();
  });

  it('Fixture rejects unknown status', () => {
    expect(() =>
      Fixture.parse({
        id: 1,
        date: '2026-05-15',
        homeTeamId: 1,
        awayTeamId: 2,
        divisionId: 1,
        status: 'in-progress',
      }),
    ).toThrow();
  });

  it('Result accepts no matchCard (e.g. before result entry)', () => {
    const r: Result = { fixtureId: 1, homeScore: 0, awayScore: 0 };
    expect(Result.parse(JSON.parse(JSON.stringify(r)))).toEqual(r);
  });
});
```

- [ ] **Step 15: Run tests**

Run: `pnpm test packages/domain/`
Expected: 5 passed.

- [ ] **Step 16: Commit**

```bash
git add packages/domain/ pnpm-lock.yaml
git commit -m "feat(domain): add Zod schemas for Club, Team, Division, Season, Player, Fixture, Result, MatchCard, Rubber, Ranking"
```

---

### Task 5: Fixture capture script

**Goal:** A repeatable way to grab a real HTML page from the upstream site and save it to `fixtures/`. Used by every parser task to get test inputs.

**Files:**
- Create: `fixtures/capture.ts`
- Create: `fixtures/README.md`

- [ ] **Step 1: Create `fixtures/capture.ts`**

```typescript
import { writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fetchHtml } from '../packages/parser/src/http.js';

const main = async () => {
  const [url, name] = process.argv.slice(2);
  if (!url || !name) {
    console.error('Usage: pnpm capture <url> <name>');
    console.error('Example: pnpm capture "https://www.calderdale.tennis-league.org/?navButtonSelect=Directory" clubs-directory');
    process.exit(1);
  }
  const html = await fetchHtml(url);
  const out = resolve('fixtures', `${name}.html`);
  await mkdir(dirname(out), { recursive: true });
  await writeFile(out, html, 'utf8');
  console.log(`Wrote ${out} (${html.length} bytes)`);
};

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 2: Add `capture` script to root `package.json`**

Modify `package.json` `"scripts"` block:

```json
"capture": "tsx fixtures/capture.ts"
```

(Add it next to `"parse"`.)

- [ ] **Step 3: Create `fixtures/README.md`**

```markdown
# Fixtures

Captured HTML from the upstream Calderdale Tennis League site, used as
inputs for parser tests. These are golden files — when a parser test
fails after a fixture refresh, that's a real signal the upstream HTML
has changed.

## Refresh a fixture

    pnpm capture "<full URL>" <fixture-name>

Example:

    pnpm capture "https://www.calderdale.tennis-league.org/?navButtonSelect=Directory" clubs-directory

This writes `fixtures/clubs-directory.html`. Re-run when adding new
parsers or when the upstream changes.
```

- [ ] **Step 4: Capture the three Phase 1 fixtures**

Run, in sequence:

```bash
pnpm capture "https://www.calderdale.tennis-league.org/?navButtonSelect=Directory&directory_mode=Clubs/Teams&directory_stage=:View%20List&refreshProtectionCode=0" clubs-directory
pnpm capture "https://www.calderdale.tennis-league.org/?navButtonSelect=Summer%202026&tabIndex=0&refreshProtectionCode=0" league-table-mens-div-1
pnpm capture "https://www.calderdale.tennis-league.org/?navButtonSelect=Summer%202026&tabIndex=4&refreshProtectionCode=0" player-rankings-mens-div-1
```

Expected: three `fixtures/*.html` files appear, each several KB.

> If the spike (Task 2) found that `refreshProtectionCode=0` does NOT work, replace `&refreshProtectionCode=0` with the working strategy from your spike findings (e.g., omit the parameter, or run a warm-up first).

- [ ] **Step 5: Sanity-check the fixtures**

Open each `.html` file briefly. Confirm it contains the expected text:
- `clubs-directory.html`: list of club names (Halifax Queens, Marsden, etc.)
- `league-table-mens-div-1.html`: a table with team names and "Points Won" / "Points Lost" columns
- `player-rankings-mens-div-1.html`: a table with player names and ranking columns

If any fixture is empty/redirect/login wall, refine the URL or revisit the spike.

- [ ] **Step 6: Commit**

```bash
git add fixtures/ package.json
git commit -m "chore(fixtures): add capture script and three baseline fixtures"
```

---

### Task 6: Parser helpers

**Files:**
- Create: `packages/parser/src/helpers.ts`
- Create: `packages/parser/tests/helpers.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/parser/tests/helpers.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { slugify, parseIntStrict, parseScore } from '../src/helpers.js';

describe('slugify', () => {
  it('lowercases and dashes spaces', () => {
    expect(slugify('Halifax Queens')).toBe('halifax-queens');
  });
  it('strips punctuation', () => {
    expect(slugify("Cragg Vale (1st team)")).toBe('cragg-vale-1st-team');
  });
  it('collapses repeated dashes', () => {
    expect(slugify('A  --  B')).toBe('a-b');
  });
});

describe('parseIntStrict', () => {
  it('parses pure integer', () => {
    expect(parseIntStrict('42')).toBe(42);
  });
  it('throws on non-integer', () => {
    expect(() => parseIntStrict('4.2')).toThrow();
    expect(() => parseIntStrict('abc')).toThrow();
    expect(() => parseIntStrict('')).toThrow();
  });
});

describe('parseScore', () => {
  it('parses "6-3" as { home: 6, away: 3 }', () => {
    expect(parseScore('6-3')).toEqual({ home: 6, away: 3 });
  });
  it('throws on malformed', () => {
    expect(() => parseScore('6:3')).toThrow();
  });
});
```

- [ ] **Step 2: Run — confirm failure**

Run: `pnpm test packages/parser/tests/helpers.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `packages/parser/src/helpers.ts`**

```typescript
export const slugify = (input: string): string =>
  input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

export const parseIntStrict = (input: string): number => {
  if (!/^-?\d+$/.test(input)) {
    throw new Error(`parseIntStrict: not an integer: ${JSON.stringify(input)}`);
  }
  return Number(input);
};

export const parseScore = (input: string): { home: number; away: number } => {
  const match = /^(\d+)-(\d+)$/.exec(input.trim());
  if (!match) {
    throw new Error(`parseScore: not a score: ${JSON.stringify(input)}`);
  }
  return { home: Number(match[1]), away: Number(match[2]) };
};
```

- [ ] **Step 4: Run — confirm pass**

Run: `pnpm test packages/parser/tests/helpers.test.ts`
Expected: 7 passed.

- [ ] **Step 5: Commit**

```bash
git add packages/parser/src/helpers.ts packages/parser/tests/helpers.test.ts
git commit -m "feat(parser): add slugify, parseIntStrict, parseScore helpers"
```

---

### Task 7: Parser — clubs/teams directory

**Files:**
- Create: `packages/parser/src/parse-clubs-directory.ts`
- Create: `packages/parser/tests/parse-clubs-directory.test.ts`

- [ ] **Step 1: Inspect `fixtures/clubs-directory.html`**

Open the fixture and identify the HTML structure containing the club list. Look for:
- Container element (probably a `<table>`, `<ul>`, or repeating `<div>`)
- The selector that picks out each club row
- The text/attribute that contains the club name

Make notes on selectors before writing the test (the test asserts shape, the impl uses these selectors).

- [ ] **Step 2: Write the failing test**

Create `packages/parser/tests/parse-clubs-directory.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseClubsDirectory } from '../src/parse-clubs-directory.js';
import { Club } from '@ctl/domain';

const loadFixture = async (name: string) =>
  readFile(resolve(__dirname, '../../../fixtures', name), 'utf8');

describe('parseClubsDirectory', () => {
  it('extracts every club listed in the fixture', async () => {
    const html = await loadFixture('clubs-directory.html');
    const clubs = parseClubsDirectory(html);

    expect(clubs.length).toBeGreaterThan(10);
    for (const c of clubs) {
      expect(() => Club.parse(c)).not.toThrow();
    }
  });

  it('includes Halifax Queens with a kebab-case slug', async () => {
    const html = await loadFixture('clubs-directory.html');
    const clubs = parseClubsDirectory(html);
    const hq = clubs.find((c) => c.name === 'Halifax Queens');
    expect(hq).toBeDefined();
    expect(hq?.slug).toBe('halifax-queens');
  });

  it('assigns deterministic positive ids', async () => {
    const html = await loadFixture('clubs-directory.html');
    const clubs = parseClubsDirectory(html);
    const ids = clubs.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.every((id) => Number.isInteger(id) && id > 0)).toBe(true);
  });
});
```

- [ ] **Step 3: Run — confirm failure**

Run: `pnpm test packages/parser/tests/parse-clubs-directory.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement `packages/parser/src/parse-clubs-directory.ts`**

> The exact cheerio selectors depend on what you saw in Step 1. Below is a representative implementation; adjust selectors to match the real HTML.

```typescript
import * as cheerio from 'cheerio';
import { Club } from '@ctl/domain';
import { slugify } from './helpers.js';

export const parseClubsDirectory = (html: string): Club[] => {
  const $ = cheerio.load(html);
  const seen = new Map<string, Club>();

  // Adjust this selector to match the real fixture.
  // Common shapes: table rows, list items, anchors with a known class.
  $('a[href*="club_id="], li.club-row, table.clubs tr').each((_, el) => {
    const name = $(el).text().trim();
    if (!name) return;
    const slug = slugify(name);
    if (seen.has(slug)) return;
    seen.set(slug, {
      id: seen.size + 1,
      slug,
      name,
    });
  });

  return Array.from(seen.values());
};
```

- [ ] **Step 5: Run — iterate selectors until passing**

Run: `pnpm test packages/parser/tests/parse-clubs-directory.test.ts`

If failing: open the fixture, inspect the actual selectors, tighten the cheerio query. Common pitfalls:
- Multiple representations of the same club (map view + list view): dedupe by slug (already handled).
- Empty rows / heading rows: filter on non-empty trimmed text.
- Whitespace inside `<a>` tags: use `.text().trim()`.

Iterate until the three test assertions pass.

- [ ] **Step 6: Commit**

```bash
git add packages/parser/src/parse-clubs-directory.ts packages/parser/tests/parse-clubs-directory.test.ts
git commit -m "feat(parser): parse clubs/teams directory page"
```

---

### Task 8: Parser — league table

**Files:**
- Create: `packages/parser/src/parse-league-table.ts`
- Create: `packages/parser/tests/parse-league-table.test.ts`

- [ ] **Step 1: Inspect `fixtures/league-table-mens-div-1.html`**

Identify the league-table block. Note the columns. The spec says columns are: Team Name, Results Received (e.g. `4/18`), Points Lost, Points Won.

- [ ] **Step 2: Define the parser's return type**

The parser returns a list of league-table rows. Add a type to `packages/parser/src/parse-league-table.ts` (next step) — but spec it in the test first:

```typescript
type LeagueTableRow = {
  position: number;
  teamName: string;
  resultsReceived: number;
  resultsTotal: number;
  pointsWon: number;
  pointsLost: number;
};
```

- [ ] **Step 3: Write the failing test**

Create `packages/parser/tests/parse-league-table.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseLeagueTable } from '../src/parse-league-table.js';

const loadFixture = async (name: string) =>
  readFile(resolve(__dirname, '../../../fixtures', name), 'utf8');

describe('parseLeagueTable', () => {
  it('extracts at least 4 teams in order', async () => {
    const html = await loadFixture('league-table-mens-div-1.html');
    const rows = parseLeagueTable(html);

    expect(rows.length).toBeGreaterThanOrEqual(4);
    expect(rows[0]?.position).toBe(1);
    expect(rows.at(-1)?.position).toBe(rows.length);
  });

  it('parses results-received as numerator/denominator', async () => {
    const html = await loadFixture('league-table-mens-div-1.html');
    const rows = parseLeagueTable(html);
    const r = rows[0]!;
    expect(r.resultsReceived).toBeGreaterThanOrEqual(0);
    expect(r.resultsTotal).toBeGreaterThan(0);
    expect(r.resultsReceived).toBeLessThanOrEqual(r.resultsTotal);
  });

  it('parses points as non-negative integers', async () => {
    const html = await loadFixture('league-table-mens-div-1.html');
    const rows = parseLeagueTable(html);
    for (const r of rows) {
      expect(r.pointsWon).toBeGreaterThanOrEqual(0);
      expect(r.pointsLost).toBeGreaterThanOrEqual(0);
      expect(Number.isInteger(r.pointsWon)).toBe(true);
      expect(Number.isInteger(r.pointsLost)).toBe(true);
    }
  });
});
```

- [ ] **Step 4: Run — confirm failure**

Run: `pnpm test packages/parser/tests/parse-league-table.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 5: Implement `packages/parser/src/parse-league-table.ts`**

```typescript
import * as cheerio from 'cheerio';
import { parseIntStrict } from './helpers.js';

export type LeagueTableRow = {
  position: number;
  teamName: string;
  resultsReceived: number;
  resultsTotal: number;
  pointsWon: number;
  pointsLost: number;
};

const parseFraction = (text: string): { num: number; denom: number } => {
  const m = /^(\d+)\s*\/\s*(\d+)$/.exec(text.trim());
  if (!m) throw new Error(`parseFraction: not a fraction: ${JSON.stringify(text)}`);
  return { num: Number(m[1]), denom: Number(m[2]) };
};

export const parseLeagueTable = (html: string): LeagueTableRow[] => {
  const $ = cheerio.load(html);
  const rows: LeagueTableRow[] = [];

  // Adjust selector to match the real league-table block in the fixture.
  $('table.league-table tbody tr, table.results tbody tr').each((index, el) => {
    const cells = $(el)
      .find('td')
      .map((_, td) => $(td).text().trim())
      .get();
    if (cells.length < 4) return;
    const [teamName, received, lost, won] = cells;
    if (!teamName) return;
    const { num, denom } = parseFraction(received ?? '');
    rows.push({
      position: index + 1,
      teamName,
      resultsReceived: num,
      resultsTotal: denom,
      pointsLost: parseIntStrict(lost ?? ''),
      pointsWon: parseIntStrict(won ?? ''),
    });
  });

  return rows;
};
```

- [ ] **Step 6: Iterate until tests pass**

Run: `pnpm test packages/parser/tests/parse-league-table.test.ts`

Tighten selector based on the real HTML. The fixture is the source of truth — let it drive the implementation.

- [ ] **Step 7: Commit**

```bash
git add packages/parser/src/parse-league-table.ts packages/parser/tests/parse-league-table.test.ts
git commit -m "feat(parser): parse league table page"
```

---

### Task 9: Parser — player rankings

**Files:**
- Create: `packages/parser/src/parse-player-rankings.ts`
- Create: `packages/parser/tests/parse-player-rankings.test.ts`

- [ ] **Step 1: Inspect `fixtures/player-rankings-mens-div-1.html`**

Per the spec, columns are: Rank, Player Name (linked to club), Primary Division, Rubbers Won, Rubbers Played, Games Won, Games Played, Division Fraction, Played Fraction, Ranking Score, Movement.

- [ ] **Step 2: Write the failing test**

Create `packages/parser/tests/parse-player-rankings.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parsePlayerRankings } from '../src/parse-player-rankings.js';

const loadFixture = async (name: string) =>
  readFile(resolve(__dirname, '../../../fixtures', name), 'utf8');

describe('parsePlayerRankings', () => {
  it('extracts ranked players in order', async () => {
    const html = await loadFixture('player-rankings-mens-div-1.html');
    const rows = parsePlayerRankings(html);

    expect(rows.length).toBeGreaterThan(5);
    expect(rows[0]?.rank).toBe(1);
    expect(rows.every((r, i) => r.rank === i + 1)).toBe(true);
  });

  it('parses non-negative rubber and game stats', async () => {
    const html = await loadFixture('player-rankings-mens-div-1.html');
    const rows = parsePlayerRankings(html);
    for (const r of rows) {
      expect(r.rubbersWon).toBeGreaterThanOrEqual(0);
      expect(r.rubbersPlayed).toBeGreaterThanOrEqual(r.rubbersWon);
      expect(r.gamesWon).toBeGreaterThanOrEqual(0);
      expect(r.gamesPlayed).toBeGreaterThanOrEqual(r.gamesWon);
    }
  });

  it('classifies movement as up | down | same | new', async () => {
    const html = await loadFixture('player-rankings-mens-div-1.html');
    const rows = parsePlayerRankings(html);
    const allowed = new Set(['up', 'down', 'same', 'new']);
    for (const r of rows) {
      expect(allowed.has(r.movement)).toBe(true);
    }
  });
});
```

- [ ] **Step 3: Run — confirm failure**

Run: `pnpm test packages/parser/tests/parse-player-rankings.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement `packages/parser/src/parse-player-rankings.ts`**

```typescript
import * as cheerio from 'cheerio';
import { parseIntStrict } from './helpers.js';
import type { RankingMovement } from '@ctl/domain';

export type PlayerRankingRow = {
  rank: number;
  playerName: string;
  clubName: string | null;
  primaryDivision: string | null;
  rubbersWon: number;
  rubbersPlayed: number;
  gamesWon: number;
  gamesPlayed: number;
  rankingScore: number;
  movement: RankingMovement;
};

const classifyMovement = (cellText: string, hasArrowUp: boolean, hasArrowDown: boolean): RankingMovement => {
  if (hasArrowUp) return 'up';
  if (hasArrowDown) return 'down';
  if (/new/i.test(cellText)) return 'new';
  return 'same';
};

export const parsePlayerRankings = (html: string): PlayerRankingRow[] => {
  const $ = cheerio.load(html);
  const rows: PlayerRankingRow[] = [];

  // Adjust selector to match the real rankings table.
  $('table.player-rankings tbody tr, table.rankings tbody tr').each((index, el) => {
    const $row = $(el);
    const cells = $row.find('td');
    if (cells.length < 8) return;

    const playerLink = $row.find('a').first();
    const playerName = playerLink.text().trim() || $(cells[1]!).text().trim();
    const clubName = $(cells[1]!).find('a[href*="club"]').text().trim() || null;

    const movementCell = $(cells.last()!);
    const movement = classifyMovement(
      movementCell.text(),
      movementCell.find('img[src*="up"], .arrow-up').length > 0,
      movementCell.find('img[src*="down"], .arrow-down').length > 0,
    );

    rows.push({
      rank: index + 1,
      playerName,
      clubName,
      primaryDivision: $(cells[2]!).text().trim() || null,
      rubbersWon: parseIntStrict($(cells[3]!).text().trim()),
      rubbersPlayed: parseIntStrict($(cells[4]!).text().trim()),
      gamesWon: parseIntStrict($(cells[5]!).text().trim()),
      gamesPlayed: parseIntStrict($(cells[6]!).text().trim()),
      rankingScore: Number($(cells[7]!).text().trim()),
      movement,
    });
  });

  return rows;
};
```

- [ ] **Step 5: Iterate until tests pass**

Run: `pnpm test packages/parser/tests/parse-player-rankings.test.ts`

The exact column indices and movement-arrow markup will need adjusting against the real fixture — that's what the iteration loop is for.

- [ ] **Step 6: Commit**

```bash
git add packages/parser/src/parse-player-rankings.ts packages/parser/tests/parse-player-rankings.test.ts
git commit -m "feat(parser): parse player rankings page"
```

---

### Task 10: Page-type detection

**Files:**
- Create: `packages/parser/src/page-type.ts`
- Create: `packages/parser/tests/page-type.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/parser/tests/page-type.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { detectPageType } from '../src/page-type.js';

describe('detectPageType', () => {
  it('detects clubs directory by query params', () => {
    const url = 'https://www.calderdale.tennis-league.org/?navButtonSelect=Directory&directory_mode=Clubs/Teams&directory_stage=:View%20List';
    expect(detectPageType(url)).toBe('clubs-directory');
  });

  it('detects league table from tabIndex=0 on a season page', () => {
    const url = 'https://www.calderdale.tennis-league.org/?navButtonSelect=Summer%202026&tabIndex=0';
    expect(detectPageType(url)).toBe('league-table');
  });

  it('detects player rankings from tabIndex=4 on a season page', () => {
    const url = 'https://www.calderdale.tennis-league.org/?navButtonSelect=Summer%202026&tabIndex=4';
    expect(detectPageType(url)).toBe('player-rankings');
  });

  it('throws for unknown URLs', () => {
    expect(() => detectPageType('https://www.calderdale.tennis-league.org/?random=true')).toThrow();
  });
});
```

- [ ] **Step 2: Run — confirm failure**

Run: `pnpm test packages/parser/tests/page-type.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `packages/parser/src/page-type.ts`**

```typescript
export type PageType = 'clubs-directory' | 'league-table' | 'player-rankings';

export const detectPageType = (url: string): PageType => {
  const u = new URL(url);
  const params = u.searchParams;

  const nav = params.get('navButtonSelect');
  const dirMode = params.get('directory_mode');
  const tabIndex = params.get('tabIndex');

  if (nav === 'Directory' && dirMode?.startsWith('Clubs/Teams')) {
    return 'clubs-directory';
  }
  if (nav?.startsWith('Summer') || nav?.startsWith('Winter')) {
    if (tabIndex === '0') return 'league-table';
    if (tabIndex === '4') return 'player-rankings';
  }
  throw new Error(`detectPageType: cannot classify ${url}`);
};
```

- [ ] **Step 4: Run — confirm pass**

Run: `pnpm test packages/parser/tests/page-type.test.ts`
Expected: 4 passed.

- [ ] **Step 5: Commit**

```bash
git add packages/parser/src/page-type.ts packages/parser/tests/page-type.test.ts
git commit -m "feat(parser): URL → page-type detection for Phase 1 page types"
```

---

### Task 11: Public API for `@ctl/parser`

**Files:**
- Create: `packages/parser/src/index.ts`

- [ ] **Step 1: Create `packages/parser/src/index.ts`**

```typescript
export { fetchHtml } from './http.js';
export type { FetchHtmlOptions } from './http.js';

export { detectPageType } from './page-type.js';
export type { PageType } from './page-type.js';

export { parseClubsDirectory } from './parse-clubs-directory.js';
export { parseLeagueTable } from './parse-league-table.js';
export type { LeagueTableRow } from './parse-league-table.js';
export { parsePlayerRankings } from './parse-player-rankings.js';
export type { PlayerRankingRow } from './parse-player-rankings.js';
```

- [ ] **Step 2: Verify it type-checks**

Run: `pnpm exec tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add packages/parser/src/index.ts
git commit -m "feat(parser): expose Phase 1 public API surface"
```

---

### Task 12: `parse-cli` app — fetch + parse + JSON

**Files:**
- Create: `apps/parse-cli/package.json`
- Create: `apps/parse-cli/tsconfig.json`
- Create: `apps/parse-cli/src/index.ts`
- Create: `apps/parse-cli/README.md`

- [ ] **Step 1: Create `apps/parse-cli/package.json`**

```json
{
  "name": "parse-cli",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "dependencies": {
    "@ctl/parser": "workspace:*"
  }
}
```

- [ ] **Step 2: Create `apps/parse-cli/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "include": ["src/**/*"]
}
```

- [ ] **Step 3: Install**

Run: `pnpm install`

- [ ] **Step 4: Create `apps/parse-cli/src/index.ts`**

```typescript
import {
  detectPageType,
  fetchHtml,
  parseClubsDirectory,
  parseLeagueTable,
  parsePlayerRankings,
  type PageType,
} from '@ctl/parser';

const dispatch = (pageType: PageType, html: string): unknown => {
  switch (pageType) {
    case 'clubs-directory':
      return parseClubsDirectory(html);
    case 'league-table':
      return parseLeagueTable(html);
    case 'player-rankings':
      return parsePlayerRankings(html);
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
  const result = dispatch(pageType, html);
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
};

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 5: Create `apps/parse-cli/README.md`**

```markdown
# parse-cli

Tiny CLI that takes a URL on the upstream Calderdale Tennis League site,
detects the page type, fetches it, parses it, and prints validated JSON.

## Usage

    pnpm parse "<url>"

Examples:

    pnpm parse "https://www.calderdale.tennis-league.org/?navButtonSelect=Directory&directory_mode=Clubs/Teams&directory_stage=:View%20List&refreshProtectionCode=0"

    pnpm parse "https://www.calderdale.tennis-league.org/?navButtonSelect=Summer%202026&tabIndex=0&refreshProtectionCode=0"

Supported page types in Phase 1: `clubs-directory`, `league-table`, `player-rankings`.
```

- [ ] **Step 6: Smoke test against the live upstream**

Run, in sequence:

```bash
pnpm parse "https://www.calderdale.tennis-league.org/?navButtonSelect=Directory&directory_mode=Clubs/Teams&directory_stage=:View%20List&refreshProtectionCode=0" | head -40
pnpm parse "https://www.calderdale.tennis-league.org/?navButtonSelect=Summer%202026&tabIndex=0&refreshProtectionCode=0" | head -40
pnpm parse "https://www.calderdale.tennis-league.org/?navButtonSelect=Summer%202026&tabIndex=4&refreshProtectionCode=0" | head -40
```

Expected: each prints a JSON array. If any prints an empty array `[]`, the parser's selectors don't match the live HTML — refresh the corresponding fixture (`pnpm capture ...`), update the parser, re-run tests.

- [ ] **Step 7: Run the full test suite**

Run: `pnpm test`
Expected: all tests pass (5 helpers + 3 http + 5 domain + 3 clubs + 3 league + 3 rankings + 4 page-type ≈ 26).

Run: `pnpm exec tsc --noEmit`
Expected: no errors.

Run: `pnpm lint`
Expected: no errors. Fix any with `pnpm format` and selective edits.

- [ ] **Step 8: Commit**

```bash
git add apps/parse-cli/ pnpm-lock.yaml
git commit -m "feat(parse-cli): fetch, dispatch by page type, emit JSON"
```

---

### Task 13: Phase 1 README

**Files:**
- Create: `README.md`

- [ ] **Step 1: Create `README.md`**

```markdown
# Calderdale Tennis League — modern frontend

A re-imagined, personalised public-view frontend for [calderdale.tennis-league.org](https://www.calderdale.tennis-league.org/), built as a static-first PWA.

> Not affiliated with the Calderdale Tennis League. Data is sourced from their public site by polite scheduled scraping.

## Status

Phase 1 in progress: foundation, parser, domain types. See `docs/superpowers/plans/` for plans and `docs/superpowers/specs/` for the design spec.

## Project shape

\`\`\`mermaid
flowchart LR
  Upstream[(calderdale.tennis-league.org)]
  Scraper -- HTML --> Upstream
  Scraper -- JSON --> R2[(R2 snapshots)]
  Web[Next.js · Cloudflare Pages] --> R2
  Web -- live --> LiveAPI[Cloudflare Worker]
  LiveAPI -- HTML --> Upstream
\`\`\`

## Repo layout

\`\`\`
packages/domain     Zod schemas + TS types
packages/parser     HTML → domain objects (pure functions)
apps/parse-cli      Phase 1 CLI: fetch any supported URL, print JSON
fixtures/           Captured HTML for parser tests
docs/superpowers/   Specs and implementation plans
\`\`\`

## Quickstart

\`\`\`bash
pnpm install
pnpm test
pnpm parse "<url>"
\`\`\`

See `apps/parse-cli/README.md` for example URLs.
```

- [ ] **Step 2: Verify the mermaid renders**

In a markdown previewer (or GitHub) confirm the mermaid diagram displays. If it doesn't, ensure the triple-backtick fences are on their own lines.

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: project README"
```

---

## Phase 1 done — what now?

By the end of Task 13:
- `pnpm test` passes ~26 tests across helpers, http, domain, page-type, and 3 parsers.
- `pnpm parse <url>` works against the real upstream for all 3 supported page types.
- The CSRF question is answered (spike findings live in `spike/findings.md`).
- The repo is structured for Phase 2 to drop in additional parsers and the scraper without restructuring.

Phase 2 will add: parsers for fixtures & results, match cards, club detail; the scraper app that walks every URL and writes JSON to R2; and a GitHub Actions cron workflow.
