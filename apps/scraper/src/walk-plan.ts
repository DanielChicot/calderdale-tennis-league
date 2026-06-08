export type WalkStep =
  | { kind: 'season-nav'; url: string }
  | { kind: 'clubs-directory'; url: string }
  | { kind: 'divisions-discovery'; url: string; seasonId: number }
  | { kind: 'locations-directory'; url: string }
  | { kind: 'club-contacts'; url: string; teamId: number }
  | { kind: 'club-location'; url: string; clubId: number }
  | { kind: 'league-table-post'; url: string; divisionId: number; modeId: number; postBody: string }
  | { kind: 'fixtures-and-results'; url: string; divisionId: number; modeId: number }
  | { kind: 'player-rankings'; url: string; divisionSlug: string }
  | { kind: 'match-card'; url: string; fixtureId: number };

export type DivisionDescriptor = {
  divisionId: number;
  divisionSlug: string;
  upstreamModeId: number;     // the modeID query param value
};

const BASE_SHELL = 'https://www.calderdale.tennis-league.org/';
// Upstream serves fragment endpoints from a nested path — the bare /displayResults.php form
// returns 404. Matches the nested-path branch already covered in parser/page-type detection.
const BASE_FRAGMENT = 'https://www.ludus-online.com/tennis-league/functions/administration/league/';

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
      kind: 'league-table-post',
      url: `${BASE_SHELL}index.php?navButtonSelect=${seasonParam}&tabIndex=0&refreshProtectionCode=0`,
      divisionId: d.divisionId,
      modeId: d.upstreamModeId,
      postBody: `season_subNav_mode=league&season_subNav_subMode=division&season_subNav_my_division=${d.upstreamModeId}&refreshProtectionCode=0`,
    });
    steps.push({
      kind: 'fixtures-and-results',
      // Upstream displayResults.php requires the full JS-equivalent param set —
      // missing any one returns a PHP-notice page that the parser can't read.
      url: `${BASE_FRAGMENT}displayResults.php?WebsiteTimeZone=Europe/London&seasonIdentifierID=2&database=ludus3_tl_calderdale&commonDatabase=ludus3_tennis_common&mode=view-division&modeID=${d.upstreamModeId}&daysResultsRequired=7&resultsSecretaryVerificationRequired=N&refreshProtectionCode=0`,
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

export const buildDivisionsDiscoveryStep = (seasonName: string, seasonId: number): WalkStep => ({
  kind: 'divisions-discovery',
  url: `${BASE_SHELL}?navButtonSelect=${encodeURIComponent(seasonName)}&tabIndex=0&refreshProtectionCode=0`,
  seasonId,
});
