# Fragment URL discovery (2026-05-16)

## Tab → endpoint mapping

The shell (`index.php`) is a ~258 KB server-rendered page. Tabs 0, 2, 3 and 4 have their
primary data **inline** in the shell (server-rendered). Only Tabs 1 (Fixtures & Results)
injects its content via XHR after page load. The league table (tab 0) is also fully
server-rendered but the shell for tabs 0–3 contains an empty `<div
id="seasonLeagueDivision_results">` that is filled by XHR, meaning `displayResults.php` is
the fragment for **tab 1**, not tab 0.

> Note: the two saved fixture shells are **Mixed Division 1** (modeID=3), despite their
> filenames suggesting Men's Division 1. Men's Division 1 is modeID=8.

| Tab | Rendering | Fragment endpoint | DOM target | Returns | Notes |
|-----|-----------|-------------------|------------|---------|-------|
| League Table (tab 0) | Server-rendered inline | — | `<div id="leagueTable">` | HTML in shell | Full league table HTML baked into `index.php` response; ~4 KB div |
| Fixtures & Results (tab 1) | **XHR** | `displayResults.php` (see full URL below) | `<div id="seasonLeagueDivision_results">` | HTML fragment ~43 KB | Combines fixture list **and** league table standings |
| Contacts (tab 2) | Team list inline; detail XHR | `displayContacts.php` | `<div id="seasonLeagueDivision_contact">` | HTML fragment ~3 KB | Team list is server-rendered; clicking a team fires XHR for contact detail |
| Locations (tab 3) | Location list inline; detail XHR | `displayLocations.php?Mode=html` + `?Mode=java` | `<div id="seasonLeagueDivision_location">` | HTML fragment ~17 KB (html) + JS ~5 KB (java) | Location list inline; detail (address + map init JS) loaded on click |
| Player Rankings (tab 4) | Server-rendered inline | — | `<div id="playerRanking">` | HTML in shell | All ~114 KB of ranked player rows baked into the `tabIndex=4` shell; autocomplete uses `rankedPlayersList.php` (XML, not the ranking data) |

### Full fragment URLs for XHR endpoints

**Tab 1 – Fixtures & Results (`displayResults.php`)**
```
https://www.ludus-online.com/tennis-league/functions/administration/league/displayResults.php
  ?WebsiteTimeZone=Europe/London
  &seasonIdentifierID=2
  &database=ludus3_tl_calderdale
  &commonDatabase=ludus3_tennis_common
  &mode=view-division
  &modeID=3
  &daysResultsRequired=7
  &resultsSecretaryVerificationRequired=N
```
Response: 200, `text/html; charset=UTF-8`, ~43 KB HTML fragment. Contains both the
fixtures/results wizard **and** the league standings table. Confirmed real data: team names,
Points column, match result rows.

**Tab 2 – Contact detail (`displayContacts.php`)**
```
https://www.ludus-online.com/tennis-league/functions/season/displayContacts.php
  ?WebsiteTimeZone=Europe/London
  &seasonIdentifierID=2
  &database=ludus3_tl_calderdale
  &commonDatabase=ludus3_tennis_common
  &Mode=team
  &teamID={teamID}
  &contactIDPrefix=seasonLeagueDivisionWebObject
  &refreshProtectionCode={code}
  &user_privacy=public
```
Response: 200, `text/html`, ~3 KB. Returns contact name/phone details for one team.
`teamID=80` = Cragg Vale, Mixed Div 1.

**Tab 3 – Location HTML (`displayLocations.php?Mode=html`)**
```
https://www.ludus-online.com/tennis-league/functions/season/displayLocations.php
  ?Mode=html
  &WebsiteTimeZone=Europe/London
  &seasonIdentifierID=2
  &database=ludus3_tl_calderdale
  &commonDatabase=ludus3_tennis_common
  &divisionID=3
  &locationID={locationID}
  &clubID={clubID}
  &contactIDPrefix=seasonLeagueDivisionWebObject
  &mapPrefix=location
  &tennisProductPath=tennis-league
  &refreshProtectionCode={code}
  &user_privacy=public
```
Response: 200, `text/html`, ~17 KB. Returns club address, website, court surface info,
map containers. `locationID=197, clubID=16` = Cragg Vale TC.

**Tab 3 – Location map JS (`displayLocations.php?Mode=java`)**
```
https://www.ludus-online.com/tennis-league/functions/season/displayLocations.php
  ?Mode=java
  &... (same params as Mode=html)
```
Response: 200, `text/html`, ~5 KB. Returns raw JavaScript (not JSON) that is `eval()`'d
to initialise a Google Maps instance with GPS coordinates. Content-Type is `text/html`
despite being a JS blob.

**Tab 4 – Player Rankings autocomplete only (`rankedPlayersList.php`)**
```
https://www.ludus-online.com/tennis-league/functions/rankedPlayersList.php
  ?input={text}
  &database=ludus3_tl_calderdale
  &commonDatabase=ludus3_tennis_common
  &seasonIdentifierID=2
  &playerRankingsEntireLeague=division_group
  &divisionGroupID=1
  &divisionID=3
  &clubID=0
  &teamID=0
```
Response: 200, `text/xml;charset=UTF-8`, ~9 KB. Returns XML `<results>` with `<rs>` elements
(id + CDATA name). This is **autocomplete only**; the actual rankings table is server-rendered
in the `tabIndex=4` shell.

## Clubs/Teams directory

**Clubs directory** (`index.php?navButtonSelect=Directory`): The club **list** (name, address,
court count) is **server-rendered inline** in the shell (~92 KB). Each club's location map
detail fires an XHR to `displayLocations.php?Mode=html` and `Mode=java` (same endpoint as
tab 3, but with `seasonIdentifierID=0` and a `commonClubID` param instead of `divisionID`).

**ListTeams.php** (club→team dropdown):
```
https://ludus-online.com/tennis-league/functions/season/ListTeams.php
  ?database=ludus3_tl_calderdale
  &club_id={clubID}
```
Response: 200, `text/html`, ~256 bytes. Returns a JavaScript array literal (not JSON – uses
unquoted keys) of `{value, text}` objects. Used to populate the sub-nav team selector.
Note: uses bare `ludus-online.com` (no `www`).

## Match cards

```
https://www.ludus-online.com/tennis-league/functions/results/results_cards/result_card_37.php
  ?WebsiteTimeZone=Europe/London
  &fixture_id={fixtureID}
  &database=ludus3_tl_calderdale
  &commonDatabase=ludus3_tennis_common
  &mode=view-division
  &modeID={base64_encoded_modeID}
  &refreshProtectionCode={code}
  &daysResultsRequired=7
  &customersOrginisationName=Calderdale+Tennis+League
  &customerWebsiteURL=www.calderdale.tennis-league.org
```
Response: 200, `text/html`, ~25 KB. Returns a complete match scorecard with player names,
rubber scores, and match result. `fixture_id` values are plain integers (453, 454, …).
`modeID` is **base64-encoded** (`czoxOiIzIjs=` = `s:1:"3";` in PHP serialize format).
`refreshProtectionCode` appears to be a session token embedded in the shell JS; it changes
between the two saved fixture files (`pix3katftq3uzsx9` vs `zq0zmg0d86ny5ipt`).

The filename `result_card_37` appears to be a fixed template identifier, not fixture-specific.

## Other endpoints discovered

**`displayRearranged.php`** – returns HTML (793 bytes) showing available rearrangement dates
for a fixture. Called on page load with null params.

**`displayStarred.php`** – returns starred/registered player availability grid for a team
(42 bytes when empty, larger when players are registered). Called alongside contact display.

**Archive season list** – `index.php?navButtonSelect=Archive` returns a server-rendered shell
listing historical seasons. Season navigation uses:
```
index.php?archive_stage=Summer:2025&refreshProtectionCode={code}
```
Seasons present: Summer 2021, 2022, 2023, 2024, 2025 (plus current Summer 2026).

**PDF export** – `index.php?OutputType=pdf&DocumentType=leagueTable&mode=league&mode_id=0&SeasonIdentifierID=2`
→ HTTP 200, `application/pdf`, ~31 KB. Genuinely returns a PDF.

**OutputType=json** – Returns HTTP 200 with **0 bytes** (not implemented).

**OutputType=xls** – Returns HTTP 200 with 190 bytes HTML (error/empty, not a spreadsheet).

## Notable parameter conventions

- `database` is always `ludus3_tl_calderdale`
- `commonDatabase` is always `ludus3_tennis_common`
- `administrationDatabase` is `ludus3_administration` (used in `displayRearranged.php` only)
- `seasonIdentifierID=2` = Summer 2026 (current season); `0` = season-agnostic (used in
  clubs directory location calls)
- `modeID` = numeric division ID: 3=Mixed Div 1, 4=Mixed Div 2, 5=Ladies Div 1, 6=Ladies
  Div 2, 8=Mens Div 1, 9=Mens Div 2, 10=Mens Div 3, 11=Mens Div 4, 14=Ladies Div 3
- `divisionGroupID=1` = the "mixed" group (Mixed Div 1+2 share a group for rankings)
- `playerRankingsEntireLeague=division` shows one division; `division_group` shows both
  divisions in the group
- `refreshProtectionCode` is a client-side cache-buster, not a CSRF guard: the upstream
  treats `refreshProtectionCode=0` as valid for every fragment endpoint tested. Verified
  by Phase 1 for the shell pages and `displayResults.php`, and by Phase 2 Task 1
  (commit `ac3d332`, `spike/findings-phase-2.md`) for `displayContacts.php`,
  `displayLocations.php`, and `result_card_*.php`.
- `modeID` param in result card URLs is PHP-serialized and base64-encoded, not a plain int
- `ListTeams.php` uses bare `ludus-online.com` (without `www`) — this resolves correctly

## Surprises / unknowns

1. **Tab 0 (League Table) is server-rendered** — the `index.php` shell itself contains the
   full league table HTML. There is no separate fragment endpoint for it. This means the
   shell must be fetched (not just `displayResults.php`) to get the league table.

2. **Tab 4 (Player Rankings) is also server-rendered** — 114 KB of ranked player rows are
   embedded in the `tabIndex=4` shell. To capture rankings for a division you fetch
   `index.php?tabIndex=4` (with division context), not a separate PHP endpoint.

3. **`displayResults.php` serves both tabs 0 and 1** — the same fragment contains both a
   league standings table and the fixtures/results list. The Fixtures & Results tab shows
   this content via XHR; the League Table tab shows the same data server-rendered in the
   shell (independently generated, not reusing the XHR result).

4. **`Mode=java` returns JavaScript source with `text/html` content-type** — it is
   `eval()`'d in the browser. Contains GPS lat/lng coordinates for the map, not JSON.

5. **`refreshProtectionCode` is session-bound** — the two saved fixture files have different
   codes. For static fixture capture, `displayResults.php` works without it, but contact/
   location/match-card endpoints may return errors without a valid code. Further testing
   needed to determine if these endpoints enforce CSRF validation or just ignore it.

6. **Fixture filename `league-table-mens-div-1.html` is mislabelled** — it is the Mixed
   Division 1 shell (modeID=3), not Men's Division 1 (modeID=8).

7. **Season ID mapping is opaque** — the season nav uses
   `?navButtonSelect=Summer%202026` (→ shell with `seasonIdentifierID=2`). No endpoint
   exists to list season IDs; you must parse the archive page for `archive_stage` links.

## Recommended fixture URLs for Phase 1 Tasks 6-9

These are the three fragment endpoints most valuable to capture as fixtures, as they carry
the bulk of structured league data and are called on every page load:

**1. Fixtures & Results fragment (tab 1) — Mixed Division 1:**
```
https://www.ludus-online.com/tennis-league/functions/administration/league/displayResults.php?WebsiteTimeZone=Europe/London&seasonIdentifierID=2&database=ludus3_tl_calderdale&commonDatabase=ludus3_tennis_common&mode=view-division&modeID=3&daysResultsRequired=7&resultsSecretaryVerificationRequired=N
```
~43 KB HTML fragment. No auth/CSRF required. Contains league table standings + all fixtures
with scores.

**2. Fixtures & Results fragment (tab 1) — Mens Division 1:**
```
https://www.ludus-online.com/tennis-league/functions/administration/league/displayResults.php?WebsiteTimeZone=Europe/London&seasonIdentifierID=2&database=ludus3_tl_calderdale&commonDatabase=ludus3_tennis_common&mode=view-division&modeID=8&daysResultsRequired=7&resultsSecretaryVerificationRequired=N
```
~44 KB HTML fragment. Same structure, different division data.

**3. Match card for a specific fixture:**
```
https://www.ludus-online.com/tennis-league/functions/results/results_cards/result_card_37.php?WebsiteTimeZone=Europe/London&fixture_id=453&database=ludus3_tl_calderdale&commonDatabase=ludus3_tennis_common&mode=view-division&modeID=czoxOiIzIjs=&refreshProtectionCode=pix3katftq3uzsx9&daysResultsRequired=7&customersOrginisationName=Calderdale+Tennis+League&customerWebsiteURL=www.calderdale.tennis-league.org
```
~25 KB HTML fragment. Contains full scorecard with player names and rubber scores.
Note: `refreshProtectionCode` may need refreshing from a live shell before fetching.
