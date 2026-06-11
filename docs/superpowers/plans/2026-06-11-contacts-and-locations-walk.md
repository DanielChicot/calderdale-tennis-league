# Contacts + Locations Walk Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Populate team contact details (new `team_contacts` table) and club locations (new columns on `clubs`) on every scrape run — one fetch per team for contacts, one per club for locations.

**Architecture:** A new `parseClubsDropdown` parser extracts upstream club ids from the `my_club` dropdown already present on the league-table POST page; the `league-table-post` handler stores them in a new `clubs.upstream_club_id` column (NULL-only set, warn-on-mismatch — same policy as `upstream_team_id`). A new stage (after match-cards, both modes) schedules the existing-but-no-op `'club-contacts'` and `'club-location'` walk steps every run via two new URL builders; content-hash dedup makes unchanged pages skip the handlers. Contacts write via delete-and-reinsert per team; locations via a single UPDATE on clubs.

**Tech Stack:** TypeScript 5.6 (strict, verbatimModuleSyntax, exactOptionalPropertyTypes, noUncheckedIndexedAccess), pnpm 9 workspaces, Drizzle ORM 0.36 + postgres-js 3.4, Cheerio, Vitest 2.1, Testcontainers 10.13.

**Spec:** `docs/superpowers/specs/2026-06-11-contacts-and-locations-walk-design.md`

**Spike-verified facts:**
- Contacts URL: `https://www.ludus-online.com/tennis-league/functions/season/displayContacts.php?WebsiteTimeZone=Europe/London&database=ludus3_tl_calderdale&commonDatabase=ludus3_tennis_common&Mode=team&teamID=<upstreamTeamId>&refreshProtectionCode=0&user_privacy=public` → 200, real contact table. No `seasonIdentifierID` needed.
- Locations URL: `https://www.ludus-online.com/tennis-league/functions/season/displayLocations.php?Mode=html&WebsiteTimeZone=Europe/London&database=ludus3_tl_calderdale&commonDatabase=ludus3_tennis_common&locationID=0&clubID=<upstreamClubId>&refreshProtectionCode=0&user_privacy=public` → 200, real address fragment (`locationID=0` selects the club's venue). No `divisionID` needed.
- The `my_club` dropdown in `fixtures/league-table-mens-div-1-post.html` has 19 options: 1 placeholder (`id="0"`, no value attr, text `select a club...`) + 18 clubs with numeric values. First three: Akroydon→13, Cleckheaton→15, Cragg Vale→16.
- Fixtures `club-contacts-sample.html` and `club-location-sample.html` are committed and already covered by parser tests.

---

### Task 1: Parser — `parseClubsDropdown`

**Files:**
- Create: `packages/parser/src/parse-clubs-dropdown.ts`
- Create: `packages/parser/tests/parse-clubs-dropdown.test.ts`
- Modify: `packages/parser/src/index.ts` (add exports)

- [ ] **Step 1: Write the failing tests**

Create `packages/parser/tests/parse-clubs-dropdown.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseClubsDropdown } from '../src/parse-clubs-dropdown.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const loadFixture = async (name: string) =>
  readFile(resolve(__dirname, '../../../fixtures', name), 'utf8');

describe('parseClubsDropdown', () => {
  it('extracts all 18 clubs with upstream ids from the league-table page', async () => {
    const html = await loadFixture('league-table-mens-div-1-post.html');
    const rows = parseClubsDropdown(html);
    expect(rows).toHaveLength(18);
  });

  it('locks in known club-id pairs', async () => {
    const html = await loadFixture('league-table-mens-div-1-post.html');
    const rows = parseClubsDropdown(html);
    const byName = new Map(rows.map((r) => [r.observedName, r.upstreamClubId]));
    expect(byName.get('Akroydon')).toBe(13);
    expect(byName.get('Cleckheaton')).toBe(15);
    expect(byName.get('Cragg Vale')).toBe(16);
  });

  it('skips the placeholder option and trims names', async () => {
    const html = await loadFixture('league-table-mens-div-1-post.html');
    const rows = parseClubsDropdown(html);
    for (const r of rows) {
      expect(r.observedName).toBe(r.observedName.trim());
      expect(r.observedName.length).toBeGreaterThan(0);
      expect(r.observedName).not.toMatch(/select a club/i);
      expect(Number.isInteger(r.upstreamClubId)).toBe(true);
      expect(r.upstreamClubId).toBeGreaterThan(0);
    }
  });

  it('returns empty for HTML without the dropdown', () => {
    expect(parseClubsDropdown('<html><body></body></html>')).toEqual([]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run packages/parser/tests/parse-clubs-dropdown.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Write the parser**

Create `packages/parser/src/parse-clubs-dropdown.ts`:

```ts
import { load } from 'cheerio';

export type ClubsDropdownRow = {
  observedName: string;     // e.g. "Cragg Vale" — resolves via club aliases
  upstreamClubId: number;   // upstream club id, e.g. 16
};

// The "My Club" dropdown on the league-table page lists every club in the league
// with its upstream id. The placeholder option carries no value attribute.
export const parseClubsDropdown = (html: string): ClubsDropdownRow[] => {
  const $ = load(html);
  const rows: ClubsDropdownRow[] = [];

  $('select[name="season_subNav_my_club"] option').each((_, el) => {
    const valueAttr = $(el).attr('value');
    if (!valueAttr) return;
    const upstreamClubId = Number(valueAttr);
    if (!Number.isInteger(upstreamClubId) || upstreamClubId <= 0) return;

    const observedName = $(el).text().trim();
    if (!observedName) return;

    rows.push({ observedName, upstreamClubId });
  });

  return rows;
};
```

- [ ] **Step 4: Export from package index**

Modify `packages/parser/src/index.ts` — append:

```ts
export { parseClubsDropdown } from './parse-clubs-dropdown.js';
export type { ClubsDropdownRow } from './parse-clubs-dropdown.js';
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm vitest run packages/parser/tests/parse-clubs-dropdown.test.ts`
Expected: 4 passed.

- [ ] **Step 6: Commit**

```bash
git add packages/parser/src/parse-clubs-dropdown.ts packages/parser/tests/parse-clubs-dropdown.test.ts packages/parser/src/index.ts
git commit -m "feat(parser): parseClubsDropdown extracts upstream club ids"
```

---

### Task 2: Migration — clubs columns + `team_contacts`

**Files:**
- Modify: `packages/db/src/schema/clubs.ts`
- Create: `packages/db/src/schema/team-contacts.ts`
- Modify: `packages/db/src/schema/index.ts`
- Create: `packages/db/src/migrations/0007_*.sql` (drizzle-kit generated)

**Context:** Five new nullable columns on `clubs` (one with a partial unique index) + the `team_contacts` table. No dedicated schema test (nullable unconstrained columns; the e2e covers the write paths) — same reasoning as migration 0006.

- [ ] **Step 1: Modify the clubs schema**

Replace `packages/db/src/schema/clubs.ts`'s `clubs` table definition (keep `clubAliases` untouched):

```ts
import { sql } from 'drizzle-orm';
import { pgTable, serial, varchar, boolean, integer, numeric, text, uniqueIndex } from 'drizzle-orm/pg-core';

export const clubs = pgTable(
  'clubs',
  {
    id: serial('id').primaryKey(),
    slug: varchar('slug', { length: 64 }).notNull(),
    canonicalName: varchar('canonical_name', { length: 128 }).notNull(),
    needsReview: boolean('needs_review').notNull().default(false),
    upstreamClubId: integer('upstream_club_id'),   // from the my_club dropdown, when known
    address: text('address'),
    postcode: varchar('postcode', { length: 10 }),
    lat: numeric('lat'),
    lng: numeric('lng'),
  },
  (t) => ({
    slugIdx: uniqueIndex('clubs_slug_idx').on(t.slug),
    upstreamClubIdIdx: uniqueIndex('clubs_upstream_club_id_idx')
      .on(t.upstreamClubId)
      .where(sql`upstream_club_id IS NOT NULL`),
  }),
);
```

(The `clubAliases` table below it keeps its existing `integer` import usage — make sure the import line covers everything both tables need.)

- [ ] **Step 2: Create the team-contacts schema**

Create `packages/db/src/schema/team-contacts.ts`:

```ts
import { pgTable, serial, integer, varchar, index } from 'drizzle-orm/pg-core';
import { teams } from './teams.ts';

export const teamContacts = pgTable(
  'team_contacts',
  {
    id: serial('id').primaryKey(),
    teamId: integer('team_id').notNull().references(() => teams.id, { onDelete: 'cascade' }),
    name: varchar('name', { length: 128 }).notNull(),
    role: varchar('role', { length: 64 }),
    phone: varchar('phone', { length: 32 }),
    email: varchar('email', { length: 128 }),
  },
  (t) => ({
    teamIdx: index('team_contacts_team_id_idx').on(t.teamId),
  }),
);
```

(Note the `.ts` import extension — drizzle-kit 0.28 CJS-resolution convention used by all schema files.)

- [ ] **Step 3: Export from the schema barrel**

Modify `packages/db/src/schema/index.ts` — append:

```ts
export * from './team-contacts.ts';
```

- [ ] **Step 4: Generate the migration**

Run: `pnpm --filter @ctl/db db:generate`
Expected: a new `packages/db/src/migrations/0007_<name>.sql` containing:
- `CREATE TABLE IF NOT EXISTS "team_contacts" (...)` with the FK ON DELETE cascade
- 5 × `ALTER TABLE "clubs" ADD COLUMN ...` (upstream_club_id, address, postcode, lat, lng)
- `CREATE UNIQUE INDEX ... "clubs_upstream_club_id_idx" ... WHERE upstream_club_id IS NOT NULL`
- `CREATE INDEX ... "team_contacts_team_id_idx" ...`

Open the SQL and confirm nothing unrelated was emitted. If it was, stop and investigate.

- [ ] **Step 5: Run the db test suite**

Run: `pnpm vitest run packages/db/tests/`
Expected: all pass (migrations 0000-0007 apply cleanly in Testcontainers).

- [ ] **Step 6: Commit**

```bash
git add packages/db/src/schema/clubs.ts packages/db/src/schema/team-contacts.ts packages/db/src/schema/index.ts packages/db/src/migrations/0007_*.sql packages/db/src/migrations/meta
git commit -m "feat(db): clubs location columns + upstream_club_id + team_contacts table"
```

---

### Task 3: Walk-plan — contacts + location builders

**Files:**
- Modify: `apps/scraper/src/walk-plan.ts`
- Modify: `apps/scraper/tests/walk-plan.test.ts`

**Context:** The `'club-contacts'` (`{ kind; url; teamId }`) and `'club-location'` (`{ kind; url; clubId }`) WalkStep variants already exist — no union change. Two new builders construct the spike-verified URLs; steps carry OUR DB ids, upstream ids go in the URL (match-card pattern).

- [ ] **Step 1: Write the failing tests**

In `apps/scraper/tests/walk-plan.test.ts`, extend the import:

```ts
import { buildInitialSteps, buildDivisionSteps, buildMatchCardStep, buildDivisionsDiscoveryStep, buildPlayerRankingsStep, buildClubContactsStep, buildClubLocationStep } from '../src/walk-plan.js';
```

Append before the closing `});` of `describe('walk plan', ...)`:

```ts
  it('club contacts step builds the season-fragment URL with required params', () => {
    const step = buildClubContactsStep(7, 40);
    expect(step.kind).toBe('club-contacts');
    if (step.kind === 'club-contacts') {
      expect(step.teamId).toBe(7);
      expect(step.url).toContain('/tennis-league/functions/season/displayContacts.php');
      expect(step.url).toContain('Mode=team');
      expect(step.url).toContain('teamID=40');
      expect(step.url).toContain('WebsiteTimeZone=Europe/London');
      expect(step.url).toContain('database=ludus3_tl_calderdale');
      expect(step.url).toContain('user_privacy=public');
    }
  });

  it('club location step builds the season-fragment URL with required params', () => {
    const step = buildClubLocationStep(3, 16);
    expect(step.kind).toBe('club-location');
    if (step.kind === 'club-location') {
      expect(step.clubId).toBe(3);
      expect(step.url).toContain('/tennis-league/functions/season/displayLocations.php');
      expect(step.url).toContain('Mode=html');
      expect(step.url).toContain('locationID=0');
      expect(step.url).toContain('clubID=16');
      expect(step.url).toContain('commonDatabase=ludus3_tennis_common');
    }
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run apps/scraper/tests/walk-plan.test.ts`
Expected: FAIL (builders not exported).

- [ ] **Step 3: Add the builders**

Append to `apps/scraper/src/walk-plan.ts`:

```ts
const SEASON_FRAGMENT = 'https://www.ludus-online.com/tennis-league/functions/season/';

export const buildClubContactsStep = (
  teamId: number,            // our DB teams.id — used by the handler
  upstreamTeamId: number,    // upstream team id — goes in the URL
): WalkStep => ({
  kind: 'club-contacts',
  url: `${SEASON_FRAGMENT}displayContacts.php?WebsiteTimeZone=Europe/London&database=ludus3_tl_calderdale&commonDatabase=ludus3_tennis_common&Mode=team&teamID=${upstreamTeamId}&refreshProtectionCode=0&user_privacy=public`,
  teamId,
});

export const buildClubLocationStep = (
  clubId: number,            // our DB clubs.id — used by the handler
  upstreamClubId: number,    // upstream club id — goes in the URL
): WalkStep => ({
  kind: 'club-location',
  // locationID=0 selects the club's venue; Mode=html returns the address fragment.
  url: `${SEASON_FRAGMENT}displayLocations.php?Mode=html&WebsiteTimeZone=Europe/London&database=ludus3_tl_calderdale&commonDatabase=ludus3_tennis_common&locationID=0&clubID=${upstreamClubId}&refreshProtectionCode=0&user_privacy=public`,
  clubId,
});
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run apps/scraper/tests/walk-plan.test.ts`
Expected: 8 passed (6 existing + 2 new).

- [ ] **Step 5: Commit**

```bash
git add apps/scraper/src/walk-plan.ts apps/scraper/tests/walk-plan.test.ts
git commit -m "feat(scraper): contacts + location step builders with verified URLs"
```

---

### Task 4: Orchestrator — club-id capture, both handlers, every-run stage

**Files:**
- Modify: `apps/scraper/src/orchestrator.ts`

**Context:** Four changes:
1. Imports: `parseClubsDropdown` (parser block), `buildClubContactsStep` + `buildClubLocationStep` (walk-plan block).
2. `'league-table-post'` handler: after the existing teamHandlers warning loop, parse the clubs dropdown and set `clubs.upstream_club_id` (NULL-only, warn-on-mismatch).
3. Replace the `'club-contacts'` and `'club-location'` no-op cases with real handlers.
4. Contacts + locations stage in both `runCurrent` and `runSeason`, after the match-cards stage.

No new unit tests — Task 5's e2e covers everything. Suite must stay green.

- [ ] **Step 1: Update imports**

In the `@ctl/parser` import block, add `parseClubsDropdown` (alphabetical placement next to `parseClubsDirectory` is fine).

In the walk-plan import block, add `buildClubContactsStep` and `buildClubLocationStep`.

- [ ] **Step 2: Capture club ids in the `league-table-post` handler**

Find the end of the `'league-table-post'` case — the final loop:

```ts
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

Insert the clubs-dropdown block between that loop and the `return;`:

```ts
        for (const h of parsed.teamHandlers) {
          if (!handlerNamesMatchedByStandings.has(h.teamName)) {
            console.warn(
              `[orchestrator] contacts handler "${h.teamName}" (upstreamId=${h.upstreamTeamId}) has no matching standings row in division ${step.divisionId}`,
            );
          }
        }

        // The page also carries the league-wide "My Club" dropdown with upstream club
        // ids. Capture them here (NULL-only set, warn-on-mismatch — same policy as
        // upstream_team_id). Identical on every division's page, so re-parses no-op.
        const clubEntries = parseClubsDropdown(html);
        for (const entry of clubEntries) {
          const clubId = await resolveClub(db, entry.observedName);
          const [existingClub] = await db
            .select({ upstreamClubId: schema.clubs.upstreamClubId })
            .from(schema.clubs)
            .where(eq(schema.clubs.id, clubId))
            .limit(1);
          if (existingClub?.upstreamClubId == null) {
            await db
              .update(schema.clubs)
              .set({ upstreamClubId: entry.upstreamClubId })
              .where(eq(schema.clubs.id, clubId));
          } else if (existingClub.upstreamClubId !== entry.upstreamClubId) {
            console.warn(
              `[orchestrator] upstream_club_id mismatch for club ${clubId} (${entry.observedName}): existing=${existingClub.upstreamClubId}, observed=${entry.upstreamClubId}; keeping existing`,
            );
          }
        }
        return;
      }
```

- [ ] **Step 3: Replace the contacts no-op handler**

Find:

```ts
      case 'club-contacts': {
        parseClubContacts(html);
        // Phase 2 minimum: contacts stored alongside teams; deferred to follow-up.
        return;
      }
```

Replace with:

```ts
      case 'club-contacts': {
        const contacts = parseClubContacts(html);
        // Snapshot per team: the upstream page is the source of truth, so a successful
        // fetch replaces whatever we had — including replacing with nothing.
        await db.transaction(async (tx) => {
          await tx.delete(schema.teamContacts).where(eq(schema.teamContacts.teamId, step.teamId));
          for (const c of contacts) {
            await tx.insert(schema.teamContacts).values({
              teamId: step.teamId,
              name: c.name,
              role: c.role ?? null,
              phone: c.phone ?? null,
              email: c.email ?? null,
            });
          }
        });
        return;
      }
```

- [ ] **Step 4: Replace the location no-op handler**

Find:

```ts
      case 'club-location': {
        parseClubLocation(html);
        // Phase 2 minimum: location columns on clubs table; deferred to follow-up.
        return;
      }
```

Replace with:

```ts
      case 'club-location': {
        const loc = parseClubLocation(html);
        await db
          .update(schema.clubs)
          .set({
            address: loc.address ?? null,
            postcode: loc.postcode ?? null,
            lat: loc.lat != null ? String(loc.lat) : null,
            lng: loc.lng != null ? String(loc.lng) : null,
          })
          .where(eq(schema.clubs.id, step.clubId));
        return;
      }
```

- [ ] **Step 5: Add the stage to `runCurrent`**

After the missing-cards loop in `runCurrent` (and before its `return report;`), insert:

```ts
    // 6. Contacts + locations — every run. Contacts change mid-season (new captain);
    // content-hash dedup means unchanged pages skip the handlers, so re-runs cost
    // only the fetch pacing.
    const contactTeams = await db
      .select({ teamId: schema.teams.id, upstreamTeamId: schema.teams.upstreamTeamId })
      .from(schema.teams)
      .innerJoin(schema.divisions, eq(schema.divisions.id, schema.teams.divisionId))
      .where(and(eq(schema.divisions.seasonId, detection.currentSeasonId), isNotNull(schema.teams.upstreamTeamId)));
    for (const t of contactTeams) {
      const outcome = await runStep(buildClubContactsStep(t.teamId, t.upstreamTeamId!));
      outcome === 'executed' ? report.stepsExecuted++ : outcome === 'skipped' ? report.stepsSkipped++ : report.parseFailures++;
    }

    const locationClubs = await db
      .select({ clubId: schema.clubs.id, upstreamClubId: schema.clubs.upstreamClubId })
      .from(schema.clubs)
      .where(isNotNull(schema.clubs.upstreamClubId));
    for (const c of locationClubs) {
      const outcome = await runStep(buildClubLocationStep(c.clubId, c.upstreamClubId!));
      outcome === 'executed' ? report.stepsExecuted++ : outcome === 'skipped' ? report.stepsSkipped++ : report.parseFailures++;
    }

    return report;
```

- [ ] **Step 6: Add the same stage to `runSeason`**

After `runSeason`'s missing-cards loop (before its `return report;`), insert the same block with `season.id` in place of `detection.currentSeasonId`:

```ts
    // Contacts + locations — same stage as runCurrent, keyed to this season's teams.
    const contactTeams = await db
      .select({ teamId: schema.teams.id, upstreamTeamId: schema.teams.upstreamTeamId })
      .from(schema.teams)
      .innerJoin(schema.divisions, eq(schema.divisions.id, schema.teams.divisionId))
      .where(and(eq(schema.divisions.seasonId, season.id), isNotNull(schema.teams.upstreamTeamId)));
    for (const t of contactTeams) {
      const outcome = await runStep(buildClubContactsStep(t.teamId, t.upstreamTeamId!));
      outcome === 'executed' ? report.stepsExecuted++ : outcome === 'skipped' ? report.stepsSkipped++ : report.parseFailures++;
    }

    const locationClubs = await db
      .select({ clubId: schema.clubs.id, upstreamClubId: schema.clubs.upstreamClubId })
      .from(schema.clubs)
      .where(isNotNull(schema.clubs.upstreamClubId));
    for (const c of locationClubs) {
      const outcome = await runStep(buildClubLocationStep(c.clubId, c.upstreamClubId!));
      outcome === 'executed' ? report.stepsExecuted++ : outcome === 'skipped' ? report.stepsSkipped++ : report.parseFailures++;
    }
    return report;
```

- [ ] **Step 7: Run the full suite**

Run: `pnpm test`
Expected: all pass. The existing e2e gains contacts/locations fetches that hit the mock's `<html></html>` fallback: `parseClubContacts` returns `[]` (delete-then-insert-nothing — harmless), `parseClubLocation` returns all-undefined fields (UPDATE sets NULLs — harmless). If something else breaks, REPORT rather than patching blind.

- [ ] **Step 8: Commit**

```bash
git add apps/scraper/src/orchestrator.ts
git commit -m "feat(scraper): contacts + locations handlers with every-run stage and club-id capture"
```

---

### Task 5: End-to-end test — contacts, locations, idempotency

**Files:**
- Modify: `apps/scraper/tests/modes.test.ts`

- [ ] **Step 1: Update the test**

a. Load the two fixtures (after the `matchCard` load):

```ts
    const clubContacts = await fixtureHtml('club-contacts-sample.html');
    const clubLocation = await fixtureHtml('club-location-sample.html');
```

b. Route the fragment URLs in the `fetchPage` mock — insert BEFORE the final fallback return:

```ts
        if (url.includes('displayContacts.php')) {
          return { kind: 'changed' as const, status: 200, html: clubContacts, contentHash: `cc:${url}`.slice(0, 64) };
        }
        if (url.includes('displayLocations.php')) {
          return { kind: 'changed' as const, status: 200, html: clubLocation, contentHash: `cl:${url}`.slice(0, 64) };
        }
```

c. Rename the test to `'runCurrent populates seasons, clubs, divisions, teams, fixtures, standings, rankings, match cards, contacts, locations'`.

d. Add assertions after the match-card block (before the self-healing section):

```ts
    const clubsWithUpstream = await db
      .select()
      .from(schema.clubs)
      .where(sql`upstream_club_id IS NOT NULL`);
    expect(clubsWithUpstream.length).toBeGreaterThanOrEqual(15);

    const contactRows = await db.select().from(schema.teamContacts);
    expect(contactRows.length).toBeGreaterThan(0);
    for (const c of contactRows) {
      expect(c.name.length).toBeGreaterThan(0);
      expect(c.teamId).toBeGreaterThan(0);
    }

    const clubsWithPostcode = await db
      .select()
      .from(schema.clubs)
      .where(sql`postcode IS NOT NULL`);
    expect(clubsWithPostcode.length).toBeGreaterThan(0);
```

e. After the self-healing section's second `await orch.runCurrent();` and its existing assertions, add the idempotency check (the second run re-fetches contacts with the same mock HTML — delete-and-reinsert must leave counts unchanged):

```ts
    const contactsAfterSecondRun = await db.select().from(schema.teamContacts);
    expect(contactsAfterSecondRun.length).toBe(contactRows.length);
```

- [ ] **Step 2: Run the test**

Run: `pnpm vitest run apps/scraper/tests/modes.test.ts`
Expected: PASS.

- [ ] **Step 3: Run the full suite**

Run: `pnpm test`
Expected: all pass.

- [ ] **Step 4: Commit**

```bash
git add apps/scraper/tests/modes.test.ts
git commit -m "test(scraper): e2e covers contacts, locations, and contact idempotency"
```

---

### Task 6: Live verification against the upstream

**Files:**
- None (manual / shell-only)

- [ ] **Step 1: Migrate**

Run: `pnpm db:migrate` (applies 0007). The dev DB keeps its scraped data — this vertical is additive, no truncate needed.

- [ ] **Step 2: Scrape**

Run: `DATABASE_URL=postgres://ctl:ctl@localhost:5433/ctl pnpm scrape`
Expected: ~96 more steps than the steady-state 23 (78 contacts + ~18 locations), runtime ~2.5 min, `parseFailures: 0`.

- [ ] **Step 3: psql verification**

```bash
docker exec ctl-db-dev psql -U ctl -d ctl -c "SELECT 'clubs w/ upstream id' t, count(*) FROM clubs WHERE upstream_club_id IS NOT NULL UNION ALL SELECT 'team_contacts', count(*) FROM team_contacts UNION ALL SELECT 'clubs w/ postcode', count(*) FROM clubs WHERE postcode IS NOT NULL;"
docker exec ctl-db-dev psql -U ctl -d ctl -c "SELECT canonical_name, postcode, address FROM clubs WHERE slug = 'cragg-vale';"
docker exec ctl-db-dev psql -U ctl -d ctl -c "SELECT t.name AS team, tc.name, tc.role, tc.phone IS NOT NULL AS has_phone FROM team_contacts tc JOIN teams t ON t.id = tc.team_id LIMIT 8;"
```

Expected:
- Clubs with upstream id ≈ 18.
- `team_contacts` ≈ 78+ (1-3 per team).
- Clubs with postcode ≈ 18 (only clubs with an upstream id get location fetches).
- Cragg Vale's postcode = `HX7 5TA` (spike-verified).
- Contact rows show real names/roles; private phone/email correctly absent.

- [ ] **Step 4: Second scrape — cadence check**

Run: `DATABASE_URL=postgres://ctl:ctl@localhost:5433/ctl pnpm scrape`
Expected: similar runtime (every-run cadence — the ~96 fragment fetches happen again); most return unchanged content → `stepsSkipped` high; counts in the DB unchanged.

- [ ] **Step 5: Push**

```bash
git pull --rebase
git push
git status   # MUST show "up to date with origin"
```

---

## Post-implementation: bd housekeeping

After Task 6 succeeds:

- Close BOTH `calderdale-tennis-league-i79` and `calderdale-tennis-league-3ix` with the live numbers.
- Remaining open: `xq6` runBackfill N+1 (P3), stale-snapshot-rows (P4).
