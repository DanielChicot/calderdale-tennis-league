import { describe, it, expect } from 'vitest';
import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseFixturesAndResults } from '../src/parse-fixtures-and-results.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const loadFixture = async (name: string) =>
  readFile(resolve(__dirname, '../../../fixtures', name), 'utf8');

describe('parseFixturesAndResults', () => {
  it('extracts at least one fixture', async () => {
    const html = await loadFixture('fixtures-and-results-mens-div-1.html');
    const rows = parseFixturesAndResults(html);
    expect(rows.length).toBeGreaterThan(0);
  });

  it('every row has ISO date and both team names', async () => {
    const html = await loadFixture('fixtures-and-results-mens-div-1.html');
    const rows = parseFixturesAndResults(html);
    for (const r of rows) {
      expect(r.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(r.homeTeamName.length).toBeGreaterThan(0);
      expect(r.awayTeamName.length).toBeGreaterThan(0);
    }
  });

  it('classifies status using known FixtureStatus values', async () => {
    const html = await loadFixture('fixtures-and-results-mens-div-1.html');
    const rows = parseFixturesAndResults(html);
    const allowed = new Set([
      'scheduled', 'completed', 'postponed', 'unfinished',
      'rearranged-postponed', 'rearranged-unfinished',
      'rubbers-conceded', 'match-conceded',
    ]);
    for (const r of rows) {
      expect(allowed.has(r.status)).toBe(true);
    }
  });

  it('played fixtures expose a fixtureRef (id + result card path)', async () => {
    const html = await loadFixture('fixtures-and-results-mens-div-1.html');
    const rows = parseFixturesAndResults(html);
    const played = rows.filter((r) => r.status === 'completed');
    expect(played.length).toBeGreaterThan(0);
    for (const r of played) {
      expect(r.fixtureRef).toBeDefined();
      expect(typeof r.fixtureRef?.id).toBe('number');
      expect(r.fixtureRef?.id).toBeGreaterThan(0);
      expect(r.fixtureRef?.resultCardUrl).toMatch(/^https:\/\/www\.ludus-online\.com\/result_card_\d+\.php\?fixture_id=\d+/);
    }
  });

  it('played fixtures expose score', async () => {
    const html = await loadFixture('fixtures-and-results-mens-div-1.html');
    const rows = parseFixturesAndResults(html);
    const played = rows.filter((r) => r.status === 'completed');
    expect(played.length).toBeGreaterThan(0);
    for (const r of played) {
      expect(r.score?.home).toBeTypeOf('number');
      expect(r.score?.away).toBeTypeOf('number');
    }
  });

  it('at least one played fixture has a half-score', async () => {
    const html = await loadFixture('fixtures-and-results-mens-div-1.html');
    const rows = parseFixturesAndResults(html);
    const played = rows.filter((r) => r.status === 'completed');
    const hasHalfScore = played.some(
      (r) => (r.score!.home % 1 !== 0) || (r.score!.away % 1 !== 0),
    );
    expect(hasHalfScore).toBe(true);
  });

  it('classifies "MC" rows as match-conceded', async () => {
    const html = await loadFixture('fixtures-and-results-mens-div-1.html');
    const rows = parseFixturesAndResults(html);
    const conceded = rows.filter((r) => r.status === 'match-conceded');
    expect(conceded.length).toBeGreaterThan(0);
  });

  it('classifies "<n>RC" rows as rubbers-conceded', async () => {
    const html = await loadFixture('fixtures-and-results-mens-div-1.html');
    const rows = parseFixturesAndResults(html);
    const conceded = rows.filter((r) => r.status === 'rubbers-conceded');
    expect(conceded.length).toBeGreaterThan(0);
  });
});
