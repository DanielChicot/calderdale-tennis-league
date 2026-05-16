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
