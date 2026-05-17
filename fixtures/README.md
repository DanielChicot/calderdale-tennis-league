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

## Refresh a fixture

    pnpm capture "<full URL>" <fixture-name>

Example:

    pnpm capture "https://www.calderdale.tennis-league.org/?navButtonSelect=Directory&directory_mode=Clubs/Teams&directory_stage=:View%20List&refreshProtectionCode=0" clubs-directory

This writes `fixtures/clubs-directory.html`. Re-run when adding new
parsers or when the upstream changes.
