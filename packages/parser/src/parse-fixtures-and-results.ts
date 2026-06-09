import { load } from 'cheerio';
import { parseDecimalStrict } from './helpers.js';
import type { FixtureStatus } from '@ctl/domain';

export type FixtureRow = {
  observedDate: string;            // raw upstream text, kept for debugging
  date: string;                    // ISO YYYY-MM-DD
  homeTeamName: string;
  awayTeamName: string;
  status: FixtureStatus;
  score?: { home: number; away: number };
  fixtureRef?: {
    id: number;       // upstream fixture_id
    cardId: number;   // N from result_card_N.php — per-division card template id
  };
};

const MONTHS: Record<string, string> = {
  jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
  jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12',
};

// Accepts "Thu Apr 23rd 2026" (cells joined by spaces) — strips ordinal suffix
const toIsoDate = (raw: string): string => {
  // Strip ordinal suffixes — "23rd", "1st" → "23", "1"
  const cleaned = raw.trim().replace(/(\d+)(st|nd|rd|th)/i, '$1');

  // "Thu Apr 23 2026" → month-first with optional leading day-of-week
  const mdy = /^(?:\w+\s+)?(\w{3,9})\s+(\d{1,2})\s+(\d{4})$/i.exec(cleaned);
  if (mdy) {
    const month = MONTHS[mdy[1]!.toLowerCase().slice(0, 3)];
    if (month) return `${mdy[3]}-${month}-${mdy[2]!.padStart(2, '0')}`;
  }

  // "23 Apr 2026" or "23 Apr Thu 2026" — day-first
  const dmy = /^(\d{1,2})[\s\/\-]+(\w{3,9})[\s\/\-]+(\d{4})$/i.exec(cleaned);
  if (dmy) {
    const day = dmy[1]!.padStart(2, '0');
    const month = MONTHS[dmy[2]!.toLowerCase().slice(0, 3)];
    const year = dmy[3]!;
    if (month) return `${year}-${month}-${day}`;
  }

  // Numeric "dd/mm/yyyy"
  const numeric = /^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/.exec(cleaned);
  if (numeric) {
    return `${numeric[3]}-${numeric[2]!.padStart(2, '0')}-${numeric[1]!.padStart(2, '0')}`;
  }

  throw new Error(`toIsoDate: cannot parse ${JSON.stringify(raw)}`);
};

const classifyStatus = (statusText: string, hasScore: boolean): FixtureStatus => {
  const t = statusText.trim();
  // Upstream uses abbreviations in the status notes cell:
  //   "MC"    = Match Conceded
  //   "<n>RC" = Rubbers Conceded (n = number of conceded rubbers)
  // (Other statuses like postponed/unfinished/rearranged-* are speculative — we keep
  //  the long-form patterns as fallbacks until a real fixture confirms their format.)
  if (/^mc$/i.test(t)) return 'match-conceded';
  if (/^\d+rc$/i.test(t)) return 'rubbers-conceded';

  const lower = t.toLowerCase();
  if (/match\s*conceded/.test(lower)) return 'match-conceded';
  if (/rubbers?\s*conceded/.test(lower)) return 'rubbers-conceded';
  if (/rearr.*postponed/.test(lower)) return 'rearranged-postponed';
  if (/rearr.*unfinished/.test(lower)) return 'rearranged-unfinished';
  if (/postponed/.test(lower)) return 'postponed';
  if (/unfinished/.test(lower)) return 'unfinished';
  if (hasScore) return 'completed';
  return 'scheduled';
};

// Parse "displayResultsCard('result_card_39', 127)" → { cardId: 39, fixtureId: 127 }
const parseResultCardCall = (
  onsubmit: string,
): { cardId: number; fixtureId: number } | undefined => {
  const m = /displayResultsCard\(\s*'result_card_(\d+)'\s*,\s*(\d+)\s*\)/.exec(onsubmit);
  if (!m) return undefined;
  return { cardId: Number(m[1]), fixtureId: Number(m[2]) };
};

export const parseFixturesAndResults = (html: string): FixtureRow[] => {
  const $ = load(html);
  const rows: FixtureRow[] = [];

  // The tbody contains all fixture rows; thead rows have no <td>, only <th>
  $('table.resultsWizardWebObject_table tbody tr').each((_, el) => {
    const tds = $(el).find('td');
    // Skip empty sentinel rows (e.g. id="firstOutstanding")
    if (tds.length < 14) return;

    const cell = (i: number) => tds.eq(i).text().trim();

    // Columns: [0]=day-of-week, [1]=month, [2]=day+ordinal, [3]=year,
    //           [4]=time, [5]=home, [6]=icon, [7]=home-score, [8]="v",
    //           [9]=away-score, [10]=icon, [11]=away, [12]=form, [13]=notes
    const dayOfWeek = cell(0);
    const month = cell(1);
    const dayOrdinal = cell(2);
    const year = cell(3);
    const observedDate = `${dayOfWeek} ${month} ${dayOrdinal} ${year}`;
    const date = toIsoDate(observedDate);

    const homeTeamName = cell(5).trim();
    const awayTeamName = cell(11).trim();

    if (!homeTeamName || !awayTeamName) return;

    // Detect played vs scheduled via the icon class on td[6]
    const iconClass = tds.eq(6).attr('class') ?? '';
    const isPlayed = iconClass.includes('matchCardIcon_G');

    const homeScoreRaw = cell(7);
    const awayScoreRaw = cell(9);
    const hasScore = homeScoreRaw !== '' && awayScoreRaw !== '';

    const statusNotes = cell(13);
    const status = classifyStatus(statusNotes, isPlayed && hasScore);

    // Score — only for played fixtures with actual score data
    let score: FixtureRow['score'];
    if (isPlayed && hasScore) {
      score = {
        home: parseDecimalStrict(homeScoreRaw),
        away: parseDecimalStrict(awayScoreRaw),
      };
    }

    // fixtureRef — extract from form onsubmit attribute
    let fixtureRef: FixtureRow['fixtureRef'];
    const form = tds.eq(12).find('form').first();
    const onsubmit = form.attr('onsubmit') ?? '';
    const parsed = parseResultCardCall(onsubmit);
    if (parsed) {
      fixtureRef = {
        id: parsed.fixtureId,
        cardId: parsed.cardId,
      };
    }

    rows.push({
      observedDate,
      date,
      homeTeamName,
      awayTeamName,
      status,
      ...(score !== undefined && { score }),
      ...(fixtureRef !== undefined && { fixtureRef }),
    });
  });

  return rows;
};
