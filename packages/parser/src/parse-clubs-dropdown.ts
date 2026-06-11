import { load } from 'cheerio';

export type ClubsDropdownRow = {
  observedName: string;     // e.g. "Cragg Vale" — resolves via club aliases
  upstreamClubId: number;   // upstream club id, e.g. 16
};

// The "My Club" dropdown on the league-table page lists every club in the league
// with its upstream id. The placeholder option carries no value attribute.
export const parseClubsDropdown = (html: string): ClubsDropdownRow[] => {
  const $ = load(html);
  const rows: ClubsDropdownRow[] = [];

  $('select[name="season_subNav_my_club"] option').each((_, el) => {
    const valueAttr = $(el).attr('value');
    if (!valueAttr) return;
    const upstreamClubId = Number(valueAttr);
    if (!Number.isInteger(upstreamClubId) || upstreamClubId <= 0) return;

    const observedName = $(el).text().trim();
    if (!observedName) return;

    rows.push({ observedName, upstreamClubId });
  });

  return rows;
};
