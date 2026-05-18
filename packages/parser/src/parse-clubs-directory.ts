import { load } from 'cheerio';
import { slugify } from './helpers.js';

export type ClubsDirectoryRow = {
  observedName: string;
  slug: string;
};

const NAME_PATTERN = /Mode=html[^"]*?&name=([^"]+?)&user_privacy=/g;

export const parseClubsDirectory = (html: string): ClubsDirectoryRow[] => {
  const $ = load(html);
  const seen = new Map<string, ClubsDirectoryRow>();

  $('script').each((_, el) => {
    const content = $(el).html() ?? '';
    let match: RegExpExecArray | null;
    NAME_PATTERN.lastIndex = 0;
    while ((match = NAME_PATTERN.exec(content)) !== null) {
      const observedName = decodeURIComponent(match[1] ?? '').trim();
      if (!observedName) continue;
      const slug = slugify(observedName);
      if (seen.has(slug)) continue;
      seen.set(slug, { observedName, slug });
    }
  });

  return Array.from(seen.values());
};
