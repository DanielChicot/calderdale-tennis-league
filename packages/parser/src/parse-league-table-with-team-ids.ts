import { load } from 'cheerio';
import { parseDecimalStrict, parseFraction } from './helpers.js';

export type StandingsRow = {
  position: number;
  teamName: string;
  resultsReceived: number;
  resultsTotal: number;
  pointsWon: number;
  pointsLost: number;
};

export type TeamHandlerEntry = { teamName: string; upstreamTeamId: number };

export type ParsedLeagueTablePage = {
  standings: StandingsRow[];
  teamHandlers: TeamHandlerEntry[];
};

// Match the inline JS handler form: displayContact( this , 42 )
// Requires `this` (the per-li form), not the whole-page `displayContact( null, …)`.
const DISPLAY_CONTACT_REGEX = /displayContact\(\s*this\s*,\s*(\d+)\s*\)/;

export const parseLeagueTableWithTeamIds = (html: string): ParsedLeagueTablePage => {
  const $ = load(html);

  const standings: StandingsRow[] = [];
  $('#leagueTable table.leagueTable_table tbody tr').each((_, el) => {
    const cells = $(el)
      .find('td')
      .map((__, td) => $(td).text().trim())
      .get();
    if (cells.length < 4) return;
    const teamName = cells[0]!;
    const received = cells[1]!;
    const lost = cells[2]!;
    const won = cells[3]!;
    if (!teamName || !received) return;
    const { num, denom } = parseFraction(received);
    standings.push({
      position: standings.length + 1,
      teamName,
      resultsReceived: num,
      resultsTotal: denom,
      pointsLost: parseDecimalStrict(lost),
      pointsWon: parseDecimalStrict(won),
    });
  });

  const teamHandlers: TeamHandlerEntry[] = [];
  $('li[onclick]').each((_, el) => {
    const onClick = $(el).attr('onclick') ?? '';
    const match = DISPLAY_CONTACT_REGEX.exec(onClick);
    if (!match) return;
    const teamName = $(el).text().trim();
    if (!teamName) return;
    teamHandlers.push({ teamName, upstreamTeamId: Number(match[1]!) });
  });

  return { standings, teamHandlers };
};
