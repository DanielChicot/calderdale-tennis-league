import { load } from 'cheerio';
import { slugify } from './helpers.js';

export type SeasonNavRow = {
  observedName: string;
  slug: string;
  current: boolean;
};

export type SeasonNavResult = {
  seasons: SeasonNavRow[];
  // Optional: current is undefined when no season tab is in the selected state
  // (e.g., on the bare-home page where Directory tab is selected, not a season).
  current: SeasonNavRow | undefined;
};

// CSS classes the upstream uses to indicate the selected (active) tab.
// The class name encodes tab position: Start (first), Mid (middle), End (last).
const CURRENT_CLASSES = ['navWebObject_StartCurrent', 'navWebObject_MidCurrent', 'navWebObject_EndCurrent'];

export const parseSeasonNav = (html: string): SeasonNavResult => {
  const $ = load(html);
  const seen = new Map<string, SeasonNavRow>();

  // ── Top-level nav tabs ──────────────────────────────────────────────────────
  // The upstream renders nav tabs as anchor links inside #navWebObject_MainTabsUL.
  // Each <li> carries a navWebObject_* class; the selected tab has one of the
  // CURRENT_CLASSES. We only keep tabs whose text starts with "Summer" or "Winter".
  $('#navWebObject_MainTabsUL li').each((_, li) => {
    const $li = $(li);
    const $a = $li.find('a').first();
    if (!$a.length) return;

    const observedName = $a.text().trim();
    if (!observedName || !/^(Summer|Winter)\s/.test(observedName)) return;

    const slug = slugify(observedName);
    const liClass = $li.attr('class') ?? '';
    const current = CURRENT_CLASSES.some((cls) => liClass.includes(cls));

    if (!seen.has(slug)) {
      seen.set(slug, { observedName, slug, current });
    }
  });

  // ── Archive sidebar ─────────────────────────────────────────────────────────
  // When the Archive tab is selected the page renders a sidebar with links of
  // the form ?archive_stage=Summer:2025&... The text node inside each link only
  // shows the year ("2025"), but the full season name ("Summer 2025") is encoded
  // in the href. We reconstruct it from there.
  $('a[href*="archive_stage="]').each((_, el) => {
    const rawHref = $(el).attr('href') ?? '';
    // Defensive: upstream sometimes percent-encodes query params (e.g. %3A for colon).
    const href = decodeURIComponent(rawHref);
    const match = /archive_stage=([^:&]+):(\d{4})/.exec(href);
    if (!match) return;

    const [, type, year] = match;
    const observedName = `${type} ${year}`;
    if (!/^(Summer|Winter)\s/.test(observedName)) return;

    const slug = slugify(observedName);
    // Archive sidebar entries are never in "current" state — they are
    // historical seasons accessible from the Archive tab.
    if (!seen.has(slug)) {
      seen.set(slug, { observedName, slug, current: false });
    }
  });

  const seasons = Array.from(seen.values());
  const current = seasons.find((s) => s.current);

  return { seasons, current };
};
