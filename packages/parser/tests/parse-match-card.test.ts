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
});
