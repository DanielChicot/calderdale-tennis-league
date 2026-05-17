import * as cheerio from 'cheerio';

export type LeagueTableRow = {
  position: number;
  teamName: string;
  resultsReceived: number;
  resultsTotal: number;
  pointsWon: number;
  pointsLost: number;
};

const parseFraction = (text: string): { num: number; denom: number } => {
  const m = /^(\d+)\s*\/\s*(\d+)$/.exec(text.trim());
  if (!m) throw new Error(`parseFraction: not a fraction: ${JSON.stringify(text)}`);
  return { num: Number(m[1]), denom: Number(m[2]) };
};

const parseFloat_ = (text: string): number => {
  const n = Number(text.trim());
  if (!Number.isFinite(n)) throw new Error(`parseFloat_: not a number: ${JSON.stringify(text)}`);
  return n;
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
    const [teamName, received, lost, won] = cells;
    if (!teamName || !received) return;
    const { num, denom } = parseFraction(received);
    rows.push({
      position: rows.length + 1,
      teamName,
      resultsReceived: num,
      resultsTotal: denom,
      pointsLost: parseFloat_(lost ?? ''),
      pointsWon: parseFloat_(won ?? ''),
    });
  });

  return rows;
};
