import * as cheerio from 'cheerio';
import type { Club } from '@ctl/domain';
import { slugify } from './helpers.js';

const NAME_PATTERN = /Mode=html[^"]*?&name=([^"]+?)&user_privacy=/g;

export const parseClubsDirectory = (html: string): Club[] => {
  const $ = cheerio.load(html);
  const seen = new Map<string, Club>();

  $('script').each((_, el) => {
    const content = $(el).html() ?? '';
    let match: RegExpExecArray | null;
    NAME_PATTERN.lastIndex = 0;
    while ((match = NAME_PATTERN.exec(content)) !== null) {
      const name = decodeURIComponent(match[1] ?? '').trim();
      if (!name) continue;
      const slug = slugify(name);
      if (seen.has(slug)) continue;
      seen.set(slug, {
        id: seen.size + 1,
        slug,
        name,
      });
    }
  });

  return Array.from(seen.values());
};
