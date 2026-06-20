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
 * Extract one position's player name, handling both upstream markup variants:
 *  - select variant (editable cards): <select id="resultsCard_{side}_{ord}_pair_{pos}">
 *    with the chosen player as <option ... selected>.
 *  - input variant (locked cards): a disabled <input type="text" value="Name">
 *    immediately preceding <span id="resultsCard_{side}_{ord}_pair_{pos}_error">.
 */
function extractPositionName(
  $: ReturnType<typeof load>,
  side: 'home' | 'away',
  ord: string,
  pos: 'top' | 'bottom',
): string | undefined {
  const baseId = `resultsCard_${side}_${ord}_pair_${pos}`;

  const select = $(`select#${baseId}`);
  if (select.length > 0) {
    const chosen = select.find('option[selected]').first().text().trim();
    // Guard against a placeholder being marked selected.
    if (chosen && !/^select player name/i.test(chosen)) return chosen;
    return undefined;
  }

  const input = $(`#${baseId}_error`).prev('input[type="text"]');
  const val = input.attr('value')?.trim();
  return val || undefined;
}

/**
 * Extract the two player names for a given pair.
 *
 * Delegates to extractPositionName which handles both the select variant
 * (editable cards) and the input variant (locked/completed cards).
 */
function extractPairNames(
  $: ReturnType<typeof load>,
  side: 'home' | 'away',
  pairIndex: number,
): string[] {
  const ord = ordinal(pairIndex);
  const names: string[] = [];
  const top = extractPositionName($, side, ord, 'top');
  if (top) names.push(top);
  const bottom = extractPositionName($, side, ord, 'bottom');
  if (bottom) names.push(bottom);
  return names;
}

/**
 * Determine the winning team's name for a rubber, handling both markup variants:
 *  - editable cards: a `<select id="resultsCard_winning_team_{code}">` with the
 *    winning team as the selected option.
 *  - locked cards: a disabled `<input type="text" value="Team Name">` in the row
 *    immediately following the rubber's abandoned checkbox.
 *
 * Used to orient each set's winner_games/loser_games onto the home/away teams.
 * Returns '' when no winner is recorded.
 */
function extractWinnerTeamName($: ReturnType<typeof load>, code: string): string {
  const select = $(`select#resultsCard_winning_team_${code}`);
  if (select.length > 0) {
    const chosen = select.find('option[selected]').first().text().trim();
    // Guard against the "select winning team..." placeholder being selected.
    if (chosen && !/^select winning team/i.test(chosen)) return chosen;
    return '';
  }

  const input = $(`#resultsCard_rubber_${code}_abandoned`)
    .closest('tr')
    .next('tr')
    .find('input[type="text"][disabled]');
  return input.attr('value')?.trim() ?? '';
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

    // Set scores: the winner_games and loser_games inputs encode each set's
    // scores in (rubber-winner, rubber-loser) order. The rubber's winning team
    // (read once, below) tells us how to orient those onto home/away.
    const sets: { home: number; away: number }[] = [];

    const winnerTeamName = extractWinnerTeamName($, code);

    // Find set numbers present for this rubber.
    const winnerGamesPattern = new RegExp(
      `^resultsCard_rubber_${code}_set_(\\d+)_winner_games$`,
    );
    $('input[type="text"]').each((_, el) => {
      const id = $(el).attr('id') ?? '';
      const m = winnerGamesPattern.exec(id);
      if (!m) return;

      const setNum = parseInt(m[1]!, 10);
      const winnerRaw = ($(el).attr('value') ?? '').trim();

      const loserInput = $(`#resultsCard_rubber_${code}_set_${setNum}_loser_games`);
      const loserRaw = (loserInput.attr('value') ?? '').trim();

      // Unplayed sets (e.g. set 3 of a two-set rubber) render as empty inputs — skip them.
      if (winnerRaw === '' || loserRaw === '') return;

      const winnerGames = parseIntStrict(winnerRaw);
      const loserGames = parseIntStrict(loserRaw);

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
