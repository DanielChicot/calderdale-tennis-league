export { fetchHtml } from './http.js';
export type { FetchHtmlOptions } from './http.js';

export { slugify, parseIntStrict, parseDecimalStrict, parseScore } from './helpers.js';

export { detectPageType, detectShellPageType, detectFragmentType } from './page-type.js';
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
