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

  it('preserves decimal rubbersWon (half-points exist)', async () => {
    const html = await loadFixture('player-rankings-mixed-div-1.html');
    const rows = parsePlayerRankings(html);
    const someDecimal = rows.find((r) => !Number.isInteger(r.rubbersWon));
    expect(someDecimal).toBeDefined();
  });

  it('parses the full Mens group POST fixture (261 rows)', async () => {
    const html = await loadFixture('player-rankings-mens.html');
    const rows = parsePlayerRankings(html);
    expect(rows).toHaveLength(261);
    expect(rows.every((r, i) => r.rank === i + 1)).toBe(true);
  });

  it('Mens fixture: primaryDivision spans MD1..MD4 and nothing else', async () => {
    const html = await loadFixture('player-rankings-mens.html');
    const rows = parsePlayerRankings(html);
    const divisions = new Set(rows.map((r) => r.primaryDivision));
    expect(divisions).toEqual(new Set(['MD1', 'MD2', 'MD3', 'MD4']));
  });

  it('Mens fixture: locks in the rank-1 row values', async () => {
    const html = await loadFixture('player-rankings-mens.html');
    const rows = parsePlayerRankings(html);
    expect(rows[0]).toEqual({
      rank: 1,
      playerName: 'James Hodgson',
      clubName: 'Akroydon',
      primaryDivision: 'MD1',
      rubbersWon: 13,
      rubbersPlayed: 14,
      gamesWon: 183,
      gamesPlayed: 297,
      rankingScore: 509.7,
      movement: 'up',
    });
  });

  it('Mens fixture: every row has a clubName (no null clubs in this group)', async () => {
    const html = await loadFixture('player-rankings-mens.html');
    const rows = parsePlayerRankings(html);
    expect(rows.every((r) => r.clubName !== null)).toBe(true);
  });
});
