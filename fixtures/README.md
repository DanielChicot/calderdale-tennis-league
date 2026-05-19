# Fixtures

Captured HTML from the upstream Calderdale Tennis League site, used as
inputs for parser tests. These are golden files — when a parser test
fails after a fixture refresh, that's a real signal the upstream HTML
has changed.

## Architecture note

The upstream site is a hybrid: most public data is **server-rendered inline**
in the `index.php` shell (large ~250 KB pages), but a handful of tabs load
fragments via XHR from `ludus-online.com` PHP endpoints after page load.
See `spike/fragment-urls.md` for the full discovery map of which tabs are
inline vs XHR'd.

For Phase 1 parsers, all three data sources are inline in the shell. Parsers
navigate to the relevant `<div id="...">` block:

| Fixture | URL | Relevant container | Tab |
|---|---|---|---|
| `clubs-directory.html` | `?navButtonSelect=Directory&directory_mode=Clubs/Teams&directory_stage=:View%20List` | The clubs list block (inline) | Directory |
| `league-table-mixed-div-1.html` | `?navButtonSelect=Summer%202026&tabIndex=0` | `<div id="leagueTable">` | League Table |
| `player-rankings-mixed-div-1.html` | `?navButtonSelect=Summer%202026&tabIndex=4` | `<div id="playerRanking">` | Player Rankings |

(`modeID=3` in the upstream maps to Mixed Division 1, not Mens — the original
filenames were mislabelled and have been renamed.)

## Phase 1 fixtures

| Fixture | URL | Description |
|---|---|---|
| `clubs-directory.html` | `?navButtonSelect=Directory&directory_mode=Clubs/Teams&directory_stage=:View%20List` | Full clubs/teams directory listing |
| `league-table-mixed-div-1.html` | `?navButtonSelect=Summer%202026&tabIndex=0` | League table for Mixed Division 1 |
| `player-rankings-mixed-div-1.html` | `?navButtonSelect=Summer%202026&tabIndex=4` | Player rankings for Mixed Division 1 |

## Phase 2 fixtures (Task 4 + follow-up)

| Fixture | URL | Description |
|---|---|---|
| `season-nav.html` | bare home URL (no query params) | Site shell with nav bar; Directory tab is selected (`navWebObject_StartCurrent`); season tabs are present but not in selected state |
| `season-nav-current-selected.html` | `?navButtonSelect=Summer%202026` | Site shell with "Summer 2026" tab in selected state (`navWebObject_MidCurrent`); use this to test season-detection logic |
| `season-nav-archive.html` | `?navButtonSelect=Archive` | Archive landing page; sidebar lists historical seasons Summer 2021–2025 via `archive_stage=Summer:YYYY` links |
| `fixtures-and-results-mens-div-1.html` | `displayResults.php?modeID=8&seasonIdentifierID=2` | Fixtures and results page for Mens Division 1 |
| `club-contacts-sample.html` | `displayContacts.php?teamID=80` | Club contacts page for Cragg Vale |
| `club-location-sample.html` | `displayLocations.php?Mode=html&locationID=197&clubID=16` | Club location page for Cragg Vale TC |
| `match-card-sample.html` | `result_card_37.php?fixture_id=453` | Match card for Liversedge A v Sowerby (Mixed Div 1) |

**Note on selected-state class naming:** when the *first* nav tab is selected the class is `navWebObject_StartCurrent`; when a *middle* tab is selected the class is `navWebObject_MidCurrent`. The `season-nav.html` fixture (bare home) shows `StartCurrent` on Directory; `season-nav-current-selected.html` shows `MidCurrent` on Summer 2026. A season-detector should key on whichever of these classes is present on a nav `<li>` and then read the anchor text/href.

## Refresh a fixture

    pnpm capture "<full URL>" <fixture-name>

Example:

    pnpm capture "https://www.calderdale.tennis-league.org/?navButtonSelect=Directory&directory_mode=Clubs/Teams&directory_stage=:View%20List&refreshProtectionCode=0" clubs-directory

This writes `fixtures/clubs-directory.html`. Re-run when adding new
parsers or when the upstream changes.
