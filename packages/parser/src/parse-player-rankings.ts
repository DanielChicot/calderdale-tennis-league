import { load } from 'cheerio';
import { parseIntStrict, parseDecimalStrict } from './helpers.js';
import type { RankingMovement } from '@ctl/domain';

export type PlayerRankingRow = {
  rank: number;
  playerName: string;
  clubName: string | null;
  primaryDivision: string | null;
  rubbersWon: number;
  rubbersPlayed: number;
  gamesWon: number;
  gamesPlayed: number;
  rankingScore: number;
  movement: RankingMovement;
};

const PLAYER_RE = /^(.+?)\s*-\s*\[(.+?)\]\s*$/;

const playerAndClub = (text: string): { playerName: string; clubName: string | null } => {
  const m = PLAYER_RE.exec(text);
  if (m) {
    return { playerName: m[1]!.trim(), clubName: m[2]!.trim() };
  }
  return { playerName: text, clubName: null };
};

const movementFromImgSrc = (src: string, cellText: string): RankingMovement => {
  if (src.includes('red_on_green_up_arrow')) return 'up';
  if (src.includes('red_on_green_down_arrow')) return 'down';
  if (/new/i.test(cellText)) return 'new';
  return 'same';
};

export const parsePlayerRankings = (html: string): PlayerRankingRow[] => {
  const $ = load(html);
  const rows: PlayerRankingRow[] = [];

  $('#playerRanking table.playerRankings_table tbody tr').each((_, el) => {
    const $cells = $(el).find('td');
    if ($cells.length < 11) return;

    const { playerName, clubName } = playerAndClub($cells.eq(1).text().trim());
    if (!playerName) return;

    const rank = parseIntStrict($cells.eq(0).text().trim());
    const movementCell = $cells.eq(10);
    const imgSrc = movementCell.find('img').attr('src') ?? '';

    rows.push({
      rank,
      playerName,
      clubName,
      primaryDivision: $cells.eq(2).text().trim() || null,
      rubbersWon: parseDecimalStrict($cells.eq(3).text().trim()),
      rubbersPlayed: parseIntStrict($cells.eq(4).text().trim()),
      gamesWon: parseIntStrict($cells.eq(5).text().trim()),
      gamesPlayed: parseIntStrict($cells.eq(6).text().trim()),
      rankingScore: parseDecimalStrict($cells.eq(9).text().trim()),
      movement: movementFromImgSrc(imgSrc, movementCell.text().trim()),
    });
  });

  return rows;
};
