import { describe, it, expect } from 'vitest';
import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseDivisionsDropdown } from '../src/parse-divisions-dropdown.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const loadFixture = async (name: string) =>
  readFile(resolve(__dirname, '../../../fixtures', name), 'utf8');

describe('parseDivisionsDropdown', () => {
  it('returns all 9 divisions with mode ids', async () => {
    const html = await loadFixture('league-table-mixed-div-1.html');
    const rows = parseDivisionsDropdown(html);
    expect(rows).toHaveLength(9);
    const modeIds = rows.map((r) => r.modeId).sort((a, b) => a - b);
    expect(modeIds).toEqual([3, 4, 5, 6, 8, 9, 10, 11, 14]);
  });

  it('classifies groups: 2 Mixed, 3 Ladies, 4 Mens', async () => {
    const html = await loadFixture('league-table-mixed-div-1.html');
    const rows = parseDivisionsDropdown(html);
    const counts = rows.reduce<Record<string, number>>((acc, r) => {
      acc[r.group] = (acc[r.group] ?? 0) + 1;
      return acc;
    }, {});
    expect(counts).toEqual({ Mixed: 2, Ladies: 3, Mens: 4 });
  });

  it('produces kebab-case slugs', async () => {
    const html = await loadFixture('league-table-mixed-div-1.html');
    const rows = parseDivisionsDropdown(html);
    for (const r of rows) {
      expect(r.slug).toMatch(/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/);
    }
    expect(rows.find((r) => r.modeId === 8)?.slug).toBe('mens-division-1');
  });

  it('skips options without a numeric value (placeholders)', () => {
    const html = `
      <select name="season_subNav_my_division">
        <option id="0">select a division...</option>
        <option value="8">Mens Division 1</option>
      </select>
    `;
    expect(parseDivisionsDropdown(html)).toHaveLength(1);
  });

  it('skips options whose text does not start with Mens/Ladies/Mixed', () => {
    const html = `
      <select name="season_subNav_my_division">
        <option value="99">Tournament Cup</option>
        <option value="8">Mens Division 1</option>
      </select>
    `;
    const rows = parseDivisionsDropdown(html);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.observedName).toBe('Mens Division 1');
  });
});
