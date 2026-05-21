import { load } from 'cheerio';
import { parseIntStrict } from './helpers.js';

export type MatchCardRubberRow = {
  orderInCard: number;
  homePlayerNames: string[];
  awayPlayerNames: string[];
  sets: { home: number; away: number }[];
};

export type MatchCardResult = {
  rubbers: MatchCardRubberRow[];
};

const ORDINALS = ['1st', '2nd', '3rd', '4th', '5th', '6th'];

/** Map pair index (1-based) to ordinal string used in HTML IDs. */
function ordinal(n: number): string {
  const s = ORDINALS[n - 1];
  if (s === undefined) {
    throw new Error(`ordinal: no ordinal for pair index ${n}`);
  }
  return s;
}

/**
 * Extract the two player names for a given pair.
 *
 * The HTML encodes each pair as:
 *   <input type="text" value="Player Name" disabled />
 *   <span ... id="resultsCard_{side}_{ordinal}_pair_top_error"></span>
 *   ...
 *   <input type="text" value="Player Name" disabled />
 *   <span ... id="resultsCard_{side}_{ordinal}_pair_bottom_error"></span>
 *
 * We find the span by ID and walk back to its preceding-sibling input.
 */
function extractPairNames(
  $: ReturnType<typeof load>,
  side: 'home' | 'away',
  pairIndex: number,
): string[] {
  const ord = ordinal(pairIndex);
  const topSpanId = `resultsCard_${side}_${ord}_pair_top_error`;
  const bottomSpanId = `resultsCard_${side}_${ord}_pair_bottom_error`;

  const topInput = $(`#${topSpanId}`).prev('input[type="text"]');
  const bottomInput = $(`#${bottomSpanId}`).prev('input[type="text"]');

  const names: string[] = [];

  const topVal = topInput.attr('value')?.trim();
  if (topVal) names.push(topVal);

  const bottomVal = bottomInput.attr('value')?.trim();
  if (bottomVal) names.push(bottomVal);

  return names;
}

/**
 * Parse a match-card result page (result_card_*.php) into structured rubber data.
 *
 * The page contains a 3×3 grid where rubber cells are identified by
 * conceded-checkbox IDs of the form `resultsCard_rubber_{H}v{A}_conceded`,
 * where H is the home pair number and A is the away pair number.
 *
 * Reading order is row-major: 1v1, 1v2, 1v3, 2v1, 2v2, 2v3, 3v1, 3v2, 3v3.
 */
export const parseMatchCard = (html: string): MatchCardResult => {
  const $ = load(html);

  // Collect all rubber codes in document order by finding conceded checkboxes.
  const rubberCodes: string[] = [];
  $('input[type="checkbox"]').each((_, el) => {
    const id = $(el).attr('id') ?? '';
    const m = /^resultsCard_rubber_(\d+v\d+)_conceded$/.exec(id);
    if (m) {
      rubberCodes.push(m[1]!);
    }
  });

  // Build a cache of pair names to avoid repeated DOM traversal.
  const pairNameCache = new Map<string, string[]>();
  const getPairNames = (side: 'home' | 'away', idx: number): string[] => {
    const key = `${side}-${idx}`;
    if (!pairNameCache.has(key)) {
      pairNameCache.set(key, extractPairNames($, side, idx));
    }
    return pairNameCache.get(key)!;
  };

  // The home team name is read once from the left column header td that has
  // class matchCardBordered and contains "Home Team".
  const homeTeamName = $('td.matchCardBordered')
    .filter((_, el) => $(el).text().includes('Home Team'))
    .find('br')
    .parent()
    .text()
    .replace('Home Team', '')
    .trim();

  const rubbers: MatchCardRubberRow[] = rubberCodes.map((code, i) => {
    const parts = code.split('v');
    const homePairIdx = parseInt(parts[0]!, 10);
    const awayPairIdx = parseInt(parts[1]!, 10);

    // Player names
    const homePlayerNames = getPairNames('home', homePairIdx);
    const awayPlayerNames = getPairNames('away', awayPairIdx);

    // Set scores: the winner_games and loser_games inputs encode scores in
    // winner/loser order.  A winner input (no ID, adjacent to the abandoned
    // checkbox) tells us which team won.  We scan for all set numbers.
    const sets: { home: number; away: number }[] = [];

    // Find set numbers present for this rubber.
    const winnerGamesPattern = new RegExp(
      `^resultsCard_rubber_${code}_set_(\\d+)_winner_games$`,
    );
    $('input[type="text"]').each((_, el) => {
      const id = $(el).attr('id') ?? '';
      const m = winnerGamesPattern.exec(id);
      if (!m) return;

      const setNum = parseInt(m[1]!, 10);
      const winnerGames = parseIntStrict($(el).attr('value') ?? '0');

      const loserInput = $(`#resultsCard_rubber_${code}_set_${setNum}_loser_games`);
      const loserGames = parseIntStrict(loserInput.attr('value') ?? '0');

      // Determine which team won by finding the winner input.
      // It appears after the abandoned checkbox whose id is
      // `resultsCard_rubber_{code}_abandoned`.
      const winnerInput = $(`#resultsCard_rubber_${code}_abandoned`)
        .closest('tr')
        .next('tr')
        .find('input[type="text"][disabled]');

      const winnerTeamName = winnerInput.attr('value')?.trim() ?? '';

      let homeGames: number;
      let awayGames: number;

      if (winnerTeamName === homeTeamName) {
        homeGames = winnerGames;
        awayGames = loserGames;
      } else {
        homeGames = loserGames;
        awayGames = winnerGames;
      }

      sets[setNum - 1] = { home: homeGames, away: awayGames };
    });

    return {
      orderInCard: i + 1,
      homePlayerNames,
      awayPlayerNames,
      sets: sets.filter(Boolean),
    };
  });

  return { rubbers };
};
