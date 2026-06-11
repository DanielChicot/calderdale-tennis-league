import { describe, it, expect } from 'vitest';
import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseClubsDropdown } from '../src/parse-clubs-dropdown.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const loadFixture = async (name: string) =>
  readFile(resolve(__dirname, '../../../fixtures', name), 'utf8');

describe('parseClubsDropdown', () => {
  it('extracts all 18 clubs with upstream ids from the league-table page', async () => {
    const html = await loadFixture('league-table-mens-div-1-post.html');
    const rows = parseClubsDropdown(html);
    expect(rows).toHaveLength(18);
  });

  it('locks in known club-id pairs', async () => {
    const html = await loadFixture('league-table-mens-div-1-post.html');
    const rows = parseClubsDropdown(html);
    const byName = new Map(rows.map((r) => [r.observedName, r.upstreamClubId]));
    expect(byName.get('Akroydon')).toBe(13);
    expect(byName.get('Cleckheaton')).toBe(15);
    expect(byName.get('Cragg Vale')).toBe(16);
  });

  it('skips the placeholder option and trims names', async () => {
    const html = await loadFixture('league-table-mens-div-1-post.html');
    const rows = parseClubsDropdown(html);
    for (const r of rows) {
      expect(r.observedName).toBe(r.observedName.trim());
      expect(r.observedName.length).toBeGreaterThan(0);
      expect(r.observedName).not.toMatch(/select a club/i);
      expect(Number.isInteger(r.upstreamClubId)).toBe(true);
      expect(r.upstreamClubId).toBeGreaterThan(0);
    }
  });

  it('returns empty for HTML without the dropdown', () => {
    expect(parseClubsDropdown('<html><body></body></html>')).toEqual([]);
  });
});
