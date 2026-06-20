import { describe, it, expect } from 'vitest';
import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseMatchCard } from '../src/parse-match-card.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const loadFixture = async (name: string) =>
  readFile(resolve(__dirname, '../../../fixtures', name), 'utf8');

describe('parseMatchCard', () => {
  it('extracts at least one rubber', async () => {
    const html = await loadFixture('match-card-sample.html');
    const card = parseMatchCard(html);
    expect(card.rubbers.length).toBeGreaterThan(0);
  });

  it('every rubber has 1-2 players on each side', async () => {
    const html = await loadFixture('match-card-sample.html');
    const card = parseMatchCard(html);
    for (const r of card.rubbers) {
      expect(r.homePlayerNames.length).toBeGreaterThanOrEqual(1);
      expect(r.homePlayerNames.length).toBeLessThanOrEqual(2);
      expect(r.awayPlayerNames.length).toBeGreaterThanOrEqual(1);
      expect(r.awayPlayerNames.length).toBeLessThanOrEqual(2);
    }
  });

  it('rubbers preserve their order_in_card starting at 1', async () => {
    const html = await loadFixture('match-card-sample.html');
    const card = parseMatchCard(html);
    expect(card.rubbers[0]?.orderInCard).toBe(1);
    for (let i = 0; i < card.rubbers.length; i++) {
      expect(card.rubbers[i]?.orderInCard).toBe(i + 1);
    }
  });

  it('sets are non-negative integers (no half-points in set scores)', async () => {
    const html = await loadFixture('match-card-sample.html');
    const card = parseMatchCard(html);
    for (const r of card.rubbers) {
      for (const s of r.sets) {
        expect(Number.isInteger(s.home)).toBe(true);
        expect(Number.isInteger(s.away)).toBe(true);
        expect(s.home).toBeGreaterThanOrEqual(0);
        expect(s.away).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('fixture has exactly 9 rubbers (3x3 doubles grid)', async () => {
    const html = await loadFixture('match-card-sample.html');
    const card = parseMatchCard(html);
    expect(card.rubbers.length).toBe(9);
  });

  it('all rubbers in fixture are doubles (exactly 2 home + 2 away players)', async () => {
    const html = await loadFixture('match-card-sample.html');
    const card = parseMatchCard(html);
    for (const r of card.rubbers) {
      expect(r.homePlayerNames.length).toBe(2);
      expect(r.awayPlayerNames.length).toBe(2);
    }
  });

  it('extracts player names from the editable select-variant markup', async () => {
    const html = await loadFixture('match-card-two-set-rubbers.html');
    const { rubbers } = parseMatchCard(html);
    expect(rubbers.length).toBeGreaterThan(0);
    // Every rubber on this card has both pairs chosen via <option selected>.
    for (const r of rubbers) {
      expect(r.homePlayerNames.length).toBeGreaterThan(0);
      expect(r.awayPlayerNames.length).toBeGreaterThan(0);
    }
    // Fixture detail: home 1st-pair top selection is Anise Khalifa.
    const allHomeNames = rubbers.flatMap((r) => r.homePlayerNames);
    expect(allHomeNames).toContain('Anise Khalifa');
  });

  it('skips unplayed sets rendered as empty inputs (two-set rubbers)', async () => {
    const html = await loadFixture('match-card-two-set-rubbers.html');
    const { rubbers } = parseMatchCard(html);
    expect(rubbers.length).toBeGreaterThan(0);
    // No set may carry NaN or come from an empty input — every parsed set has integer games.
    for (const r of rubbers) {
      for (const s of r.sets) {
        expect(Number.isInteger(s.home)).toBe(true);
        expect(Number.isInteger(s.away)).toBe(true);
      }
    }
    // Fixture detail: rubber 1v1 went to 3 sets; rubbers 1v2, 2v1, 2v2 finished in 2.
    const threeSet = rubbers.find((r) => r.sets.length === 3);
    const twoSet = rubbers.filter((r) => r.sets.length === 2);
    expect(threeSet).toBeDefined();
    expect(twoSet.length).toBeGreaterThanOrEqual(3);
  });

  it('orients set scores onto home/away via the winning-team select (home winner)', async () => {
    // Editable variant. Fixture 3: Queens A (home) beat Huddersfield A 8-0 in
    // sets — the home pair won every set. A naive winner lookup (disabled input
    // only) would invert these, showing the 8-0 winner losing 0-6.
    const html = await loadFixture('match-card-editable.html');
    const { rubbers } = parseMatchCard(html);
    expect(rubbers[0]?.sets[0]).toEqual({ home: 6, away: 0 });
    const all = rubbers.flatMap((r) => r.sets);
    expect(all.filter((s) => s.home > s.away)).toHaveLength(8); // home won 8 sets
    expect(all.filter((s) => s.away > s.home)).toHaveLength(0); // away won none
  });

  it('orients set scores onto home/away via the winning-team select (away winner, 3 sets)', async () => {
    // Editable variant. Rubber 1v1: Todmorden D (home) lost to Huddersfield B
    // (away). winner_games stays the rubber-winner's games even in the set they
    // lost (set 2), so from the home perspective the rubber reads 4-6, 6-4, 6-10.
    const html = await loadFixture('match-card-two-set-rubbers.html');
    const { rubbers } = parseMatchCard(html);
    expect(rubbers[0]?.sets).toEqual([
      { home: 4, away: 6 },
      { home: 6, away: 4 },
      { home: 6, away: 10 },
    ]);
  });
});
