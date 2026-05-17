import { describe, it, expect } from 'vitest';
import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseLeagueTable } from '../src/parse-league-table.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const loadFixture = async (name: string) =>
  readFile(resolve(__dirname, '../../../fixtures', name), 'utf8');

describe('parseLeagueTable', () => {
  it('extracts at least 4 teams in order', async () => {
    const html = await loadFixture('league-table-mixed-div-1.html');
    const rows = parseLeagueTable(html);

    expect(rows.length).toBeGreaterThanOrEqual(4);
    expect(rows[0]?.position).toBe(1);
    expect(rows.at(-1)?.position).toBe(rows.length);
  });

  it('parses results-received as numerator/denominator', async () => {
    const html = await loadFixture('league-table-mixed-div-1.html');
    const rows = parseLeagueTable(html);
    expect(rows.length).toBeGreaterThan(0);
    const r = rows[0]!;
    expect(r.resultsReceived).toBeGreaterThanOrEqual(0);
    expect(r.resultsTotal).toBeGreaterThan(0);
    expect(r.resultsReceived).toBeLessThanOrEqual(r.resultsTotal);
  });

  it('parses points as non-negative numbers', async () => {
    const html = await loadFixture('league-table-mixed-div-1.html');
    const rows = parseLeagueTable(html);
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) {
      expect(r.pointsWon).toBeGreaterThanOrEqual(0);
      expect(r.pointsLost).toBeGreaterThanOrEqual(0);
      expect(Number.isFinite(r.pointsWon)).toBe(true);
      expect(Number.isFinite(r.pointsLost)).toBe(true);
    }
  });

  it('parser is deterministic across repeated calls', async () => {
    const html = await loadFixture('league-table-mixed-div-1.html');
    const a = parseLeagueTable(html);
    const b = parseLeagueTable(html);
    expect(a).toEqual(b);
  });
});
