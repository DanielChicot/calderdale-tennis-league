# Per-team contacts + per-club locations walk

## Goal

Populate team contact details (`team_contacts`, new table) and club locations (new columns on `clubs`) on every scrape run. Combines bd issues `calderdale-tennis-league-i79` (contacts) and `calderdale-tennis-league-3ix` (locations) — same shape of work, both unblocked by `teams.upstream_team_id` from the standings vertical.

## Decisions captured during brainstorming

| Question | Choice | Why |
|---|---|---|
| Combined vertical | One spec/plan for both walks | Sibling fragments: same page family, same stage, same handler idiom. Mirrors the r7n+h9f combined sweep. |
| Fetch cadence | Every run | Contacts DO change mid-season (new captain, updated phone); locations rarely. ~96 extra fetches ≈ +1.6 min twice a week is acceptable; content-hash dedup skips the parse/write for unchanged pages, so re-runs cost only pacing time. |
| Contacts URL (spike-verified) | `…/tennis-league/functions/season/displayContacts.php?WebsiteTimeZone=Europe/London&database=ludus3_tl_calderdale&commonDatabase=ludus3_tennis_common&Mode=team&teamID=<upstream_team_id>&refreshProtectionCode=0&user_privacy=public` | Live test returned the real contact table (2.7 KB). `seasonIdentifierID` NOT required. |
| Locations URL (spike-verified) | `…/tennis-league/functions/season/displayLocations.php?Mode=html&WebsiteTimeZone=Europe/London&database=ludus3_tl_calderdale&commonDatabase=ludus3_tennis_common&locationID=0&clubID=<upstream_club_id>&refreshProtectionCode=0&user_privacy=public` | Live test returned the real address fragment (17 KB, postcode present). `locationID=0` + `clubID` selects the club's venue; `divisionID`/`seasonIdentifierID` NOT required. |
| Upstream club ids | New `clubs.upstream_club_id` column, populated from the `my_club` dropdown on the league-table POST page | The dropdown (`<select name="season_subNav_my_club">`) lists ALL clubs with upstream ids (e.g. `<option value="13">Akroydon</option>`); present on every league-table page. Names resolve through the existing `resolveClub` alias path. The `displayLocation(this, 0, <clubID>)` handlers carry the same ids but per-division; the dropdown is complete in one parse. |
| Club-id conflict policy | NULL-only set; warn-on-mismatch, keep existing | Same policy as `teams.upstream_team_id`. |
| Location storage | Columns on `clubs` (`address`, `postcode`, `lat`, `lng`), all nullable | Location is 1:1 with club; a join table buys nothing. |
| Contacts storage | New `team_contacts` table; snapshot per team via delete-and-reinsert | Same idiom as rubbers. Contacts are small (1-3 rows/team). |
| Step id semantics | Steps carry OUR DB ids (`teamId`, `clubId`); upstream ids go in the URL via the builders | Match-card pattern. The `'club-contacts'` and `'club-location'` WalkStep variants already exist with these fields. |
| Contacts ↔ players linking | Not done | Contacts are often non-players (secretaries, parents). YAGNI. |

## Scope

**In:**
- New parser `parseClubsDropdown(html)` → `{ observedName: string; upstreamClubId: number }[]` from `select[name="season_subNav_my_club"]` (skip the `select a club...` placeholder).
- Migration `0007`:
  - `clubs.upstream_club_id INTEGER` nullable + partial unique index (`WHERE upstream_club_id IS NOT NULL`).
  - `clubs.address TEXT`, `clubs.postcode VARCHAR(10)`, `clubs.lat NUMERIC`, `clubs.lng NUMERIC` — all nullable.
  - New `team_contacts` table (below).
- `league-table-post` handler addition: parse the clubs dropdown; per entry `resolveClub(observedName)` → set `upstream_club_id` if NULL; warn on mismatch.
- Builders `buildClubContactsStep(teamId, upstreamTeamId)` and `buildClubLocationStep(clubId, upstreamClubId)` constructing the spike-verified URLs.
- New stage (after match-cards, in both `runCurrent` and `runSeason`): contacts for every team in the season's divisions with `upstream_team_id IS NOT NULL`; locations for every club with `upstream_club_id IS NOT NULL` (clubs are season-agnostic — locations run off the full clubs table).
- Handlers:
  - `'club-contacts'`: `parseClubContacts(html)` → delete-and-reinsert `team_contacts` for `step.teamId` in one transaction.
  - `'club-location'`: `parseClubLocation(html)` → `UPDATE clubs SET address, postcode, lat, lng WHERE id = step.clubId` (single statement; no transaction needed).

**Out:**
- Linking contacts to `players`.
- Venue-sharing normalisation (two clubs at one ground stay two copies of the address).
- Private-contact recovery — `parseClubContacts` already drops "private - log on to website" placeholders.

## Architecture / data flow

```
runCurrent / runSeason (after the match-cards stage):
  6. contacts + locations stage (every run — content-hash dedup skips unchanged):
       teams:  SELECT t.id, t.upstream_team_id FROM teams t
               JOIN divisions d ON d.id = t.division_id
               WHERE d.season_id = <season> AND t.upstream_team_id IS NOT NULL
         → buildClubContactsStep(t.id, t.upstream_team_id) → runStep
             ↳ parseClubContacts → tx: DELETE team_contacts WHERE team_id; INSERT rows
       clubs:  SELECT c.id, c.upstream_club_id FROM clubs c
               WHERE c.upstream_club_id IS NOT NULL
         → buildClubLocationStep(c.id, c.upstream_club_id) → runStep
             ↳ parseClubLocation → UPDATE clubs SET address/postcode/lat/lng
```

The `upstream_club_id` population happens earlier, inside the existing `'league-table-post'` handler:

```
'league-table-post' handler (addition, after the standings loop):
  const clubEntries = parseClubsDropdown(html);
  for each { observedName, upstreamClubId }:
    clubId = resolveClub(db, observedName)
    read clubs.upstream_club_id:
      NULL          → UPDATE clubs SET upstream_club_id
      equal         → no-op
      different     → console.warn, keep existing
```

(The dropdown is identical on every division's league-table page; the second-through-ninth parses hit the no-op branch.)

### Parser

**`packages/parser/src/parse-clubs-dropdown.ts`:**

```ts
export type ClubsDropdownRow = { observedName: string; upstreamClubId: number };
export const parseClubsDropdown = (html: string): ClubsDropdownRow[];
```

Selector: `select[name="season_subNav_my_club"] option`. Skip options without a positive-integer `value` (the `select a club...` placeholder has `id="0"` and no usable value) and the `-->enter new player<--`-style sentinels if any. Trim names.

### Walk-plan

The `'club-contacts'` (`{ kind; url; teamId }`) and `'club-location'` (`{ kind; url; clubId }`) variants already exist. New builders:

```ts
const SEASON_FRAGMENT = 'https://www.ludus-online.com/tennis-league/functions/season/';

export const buildClubContactsStep = (teamId: number, upstreamTeamId: number): WalkStep => ({
  kind: 'club-contacts',
  url: `${SEASON_FRAGMENT}displayContacts.php?WebsiteTimeZone=Europe/London&database=ludus3_tl_calderdale&commonDatabase=ludus3_tennis_common&Mode=team&teamID=${upstreamTeamId}&refreshProtectionCode=0&user_privacy=public`,
  teamId,
});

export const buildClubLocationStep = (clubId: number, upstreamClubId: number): WalkStep => ({
  kind: 'club-location',
  url: `${SEASON_FRAGMENT}displayLocations.php?Mode=html&WebsiteTimeZone=Europe/London&database=ludus3_tl_calderdale&commonDatabase=ludus3_tennis_common&locationID=0&clubID=${upstreamClubId}&refreshProtectionCode=0&user_privacy=public`,
  clubId,
});
```

### Handlers

```ts
case 'club-contacts': {
  const contacts = parseClubContacts(html);
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

(An empty contacts parse deletes existing rows and inserts none — correct: the upstream page is the source of truth and the fetch succeeded. A location parse with no postcode writes NULLs — same reasoning.)

## Schema delta

One migration (`packages/db/src/migrations/0007_*.sql`):

```sql
ALTER TABLE clubs ADD COLUMN upstream_club_id INTEGER;
CREATE UNIQUE INDEX clubs_upstream_club_id_idx
  ON clubs (upstream_club_id) WHERE upstream_club_id IS NOT NULL;
ALTER TABLE clubs ADD COLUMN address TEXT;
ALTER TABLE clubs ADD COLUMN postcode VARCHAR(10);
ALTER TABLE clubs ADD COLUMN lat NUMERIC;
ALTER TABLE clubs ADD COLUMN lng NUMERIC;

CREATE TABLE team_contacts (
  id SERIAL PRIMARY KEY,
  team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  name VARCHAR(128) NOT NULL,
  role VARCHAR(64),
  phone VARCHAR(32),
  email VARCHAR(128)
);
CREATE INDEX team_contacts_team_id_idx ON team_contacts (team_id);
```

Drizzle-side: extend `packages/db/src/schema/clubs.ts` (columns + partial unique index, `sql` import for the `.where()`); new `packages/db/src/schema/team-contacts.ts`; barrel export. `lat`/`lng` as `numeric` → strings in JS, preserving precision.

## Testing strategy

**Unit (no DB):**
- `parseClubsDropdown` against `league-table-mens-div-1-post.html`: ≥ 15 rows; `Akroydon → 13`; `Cragg Vale → 16`; placeholder skipped; names trimmed.
- Builders: URL contains all spike-verified params + the upstream id; step carries OUR id.
- Existing `parseClubContacts` / `parseClubLocation` tests unchanged.

**Integration (Testcontainers):**
- `team_contacts` delete-and-reinsert: seed a team with 2 contacts, re-run the handler write with 1 contact, assert exactly 1 remains.

**E2E (`modes.test.ts`):**
- Route `displayContacts.php` URLs → `fixtures/club-contacts-sample.html`; `displayLocations.php` → `fixtures/club-location-sample.html`.
- Assert after `runCurrent`: clubs with `upstream_club_id` ≥ 15; `team_contacts` > 0; at least one club has a non-null `postcode`.

**Live verification (manual):**
1. `pnpm db:migrate`, truncate-free run (`pnpm scrape`) — contacts/locations are additive; expect ~96 extra steps, runtime ~3.5 min, `parseFailures: 0`.
2. psql: `clubs WHERE upstream_club_id IS NOT NULL` ≈ 18+; `team_contacts` ≈ 78+ rows; `clubs WHERE postcode IS NOT NULL` ≈ 18; spot-check Cragg Vale (postcode HX7 5TA per spike) and one team's contact against the live site.
3. Second scrape: counts stable, runtime similar (every-run cadence — fetches happen, unchanged pages skip handlers).

## Deferred follow-ups (already filed)

- `xq6` — runBackfill N+1 home fetches.
- Stale-snapshot-rows P4 (rankings/standings).

## Out of scope (will not be filed)

- Contacts↔players linking.
- Venue-sharing normalisation.
- Geocoding fallback when upstream provides no lat/lng.
