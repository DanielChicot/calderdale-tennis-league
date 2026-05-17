import * as cheerio from 'cheerio';
import { parseDecimalStrict, parseFraction } from './helpers.js';

export type LeagueTableRow = {
  position: number;
  teamName: string;
  resultsReceived: number;
  resultsTotal: number;
  pointsWon: number;
  pointsLost: number;
};

export const parseLeagueTable = (html: string): LeagueTableRow[] => {
  const $ = cheerio.load(html);
  const rows: LeagueTableRow[] = [];

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
    rows.push({
      position: rows.length + 1,
      teamName,
      resultsReceived: num,
      resultsTotal: denom,
      pointsLost: parseDecimalStrict(lost),
      pointsWon: parseDecimalStrict(won),
    });
  });

  return rows;
};
