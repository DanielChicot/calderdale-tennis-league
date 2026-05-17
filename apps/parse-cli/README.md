# parse-cli

Tiny CLI that takes a URL on the upstream Calderdale Tennis League site,
detects the page type, fetches it, parses it, and prints validated JSON.

## Usage

    pnpm parse "<url>"

Examples:

    pnpm parse "https://www.calderdale.tennis-league.org/?navButtonSelect=Directory&directory_mode=Clubs/Teams&directory_stage=:View%20List&refreshProtectionCode=0"

    pnpm parse "https://www.calderdale.tennis-league.org/?navButtonSelect=Summer%202026&tabIndex=0&refreshProtectionCode=0"

Supported page types in Phase 1: `clubs-directory`, `league-table`, `player-rankings`.
