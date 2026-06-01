import { load } from 'cheerio';
import { slugify } from './helpers.js';

export type DivisionsDropdownRow = {
  observedName: string;                    // "Mens Division 1"
  modeId: number;                          // 8
  group: 'Mens' | 'Ladies' | 'Mixed';
  slug: string;                            // "mens-division-1"
};

const GROUP_REGEX = /^(Mens|Ladies|Mixed)\b/;

export const parseDivisionsDropdown = (html: string): DivisionsDropdownRow[] => {
  const $ = load(html);
  const rows: DivisionsDropdownRow[] = [];

  $('select[name="season_subNav_my_division"] option').each((_, el) => {
    const valueAttr = $(el).attr('value');
    if (!valueAttr) return;
    const modeId = Number(valueAttr);
    if (!Number.isInteger(modeId) || modeId <= 0) return;

    const observedName = $(el).text().trim();
    const match = GROUP_REGEX.exec(observedName);
    if (!match) return;

    rows.push({
      observedName,
      modeId,
      group: match[1] as 'Mens' | 'Ladies' | 'Mixed',
      slug: slugify(observedName),
    });
  });

  return rows;
};
