import { describe, it, expect } from 'vitest';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseSeasonNav } from '../src/parse-season-nav.js';

const loadFixture = async (name: string) =>
  readFile(resolve(__dirname, '../../../fixtures', name), 'utf8');

describe('parseSeasonNav', () => {
  it('returns at least one season', async () => {
    const html = await loadFixture('season-nav.html');
    const result = parseSeasonNav(html);
    expect(result.seasons.length).toBeGreaterThan(0);
  });

  it('marks exactly one season as current when season tab is selected', async () => {
    const html = await loadFixture('season-nav-current-selected.html');
    const result = parseSeasonNav(html);
    const currents = result.seasons.filter((s) => s.current);
    expect(currents).toHaveLength(1);
    expect(result.current).toEqual(currents[0]);
    expect(result.current?.observedName).toBe('Summer 2026');
  });

  it('produces kebab-case slugs for each season', async () => {
    const html = await loadFixture('season-nav.html');
    const result = parseSeasonNav(html);
    for (const s of result.seasons) {
      expect(s.slug).toMatch(/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/);
      expect(s.observedName.length).toBeGreaterThan(0);
    }
  });

  it('includes "Summer" or "Winter" seasons that look real', async () => {
    const html = await loadFixture('season-nav.html');
    const result = parseSeasonNav(html);
    expect(result.seasons.some((s) => /^(Summer|Winter)/.test(s.observedName))).toBe(true);
  });

  it('infers current from the solo top-nav season when no tab has the Current class', async () => {
    // On the bare-home page, Directory is the selected tab — no season carries
    // navWebObject_*Current. But the upstream nav only ever lists the live
    // current season alongside Directory/Archive, so a solo top-nav season is
    // unambiguously the current one.
    const html = await loadFixture('season-nav.html');
    const result = parseSeasonNav(html);
    expect(result.current?.observedName).toBe('Summer 2026');
  });

  it('archive page still identifies the live season as current via the solo top-nav tab', async () => {
    // The archive page's top nav is [Directory, Summer 2026, Archive(Current)].
    // Even though the user is on the Archive tab, Summer 2026 is still the live
    // current season — solo-tab inference picks it up correctly.
    const html = await loadFixture('season-nav-archive.html');
    const result = parseSeasonNav(html);
    expect(result.current?.observedName).toBe('Summer 2026');
  });

  it('archive page yields multiple historical seasons', async () => {
    const html = await loadFixture('season-nav-archive.html');
    const result = parseSeasonNav(html);
    // Archive sidebar lists Summer 2021–2025 via archive_stage links
    expect(result.seasons.length).toBeGreaterThanOrEqual(5);
    expect(result.seasons.every((s) => /^(Summer|Winter)/.test(s.observedName))).toBe(true);
  });
});
