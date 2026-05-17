import { describe, it, expect } from 'vitest';
import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parsePlayerRankings } from '../src/parse-player-rankings.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const loadFixture = async (name: string) =>
  readFile(resolve(__dirname, '../../../fixtures', name), 'utf8');

describe('parsePlayerRankings', () => {
  it('extracts ranked players in DOM order', async () => {
    const html = await loadFixture('player-rankings-mixed-div-1.html');
    const rows = parsePlayerRankings(html);

    expect(rows.length).toBeGreaterThan(5);
    expect(rows[0]?.rank).toBe(1);
    expect(rows.every((r, i) => r.rank === i + 1)).toBe(true);
  });

  it('parses non-negative rubber and game stats', async () => {
    const html = await loadFixture('player-rankings-mixed-div-1.html');
    const rows = parsePlayerRankings(html);
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) {
      expect(r.rubbersWon).toBeGreaterThanOrEqual(0);
      expect(r.rubbersPlayed).toBeGreaterThanOrEqual(r.rubbersWon);
      expect(r.gamesWon).toBeGreaterThanOrEqual(0);
      expect(r.gamesPlayed).toBeGreaterThanOrEqual(r.gamesWon);
    }
  });

  it('classifies movement as up | down | same | new', async () => {
    const html = await loadFixture('player-rankings-mixed-div-1.html');
    const rows = parsePlayerRankings(html);
    const allowed = new Set(['up', 'down', 'same', 'new']);
    for (const r of rows) {
      expect(allowed.has(r.movement)).toBe(true);
    }
  });

  it('parser is deterministic across repeated calls', async () => {
    const html = await loadFixture('player-rankings-mixed-div-1.html');
    const a = parsePlayerRankings(html);
    const b = parsePlayerRankings(html);
    expect(a).toEqual(b);
  });
});
