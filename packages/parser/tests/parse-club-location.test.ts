import { describe, it, expect } from 'vitest';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseClubLocation } from '../src/parse-club-location.js';

const loadFixture = async (name: string) =>
  readFile(resolve(__dirname, '../../../fixtures', name), 'utf8');

describe('parseClubLocation', () => {
  it('returns a single location record', async () => {
    const html = await loadFixture('club-location-sample.html');
    const loc = parseClubLocation(html);
    expect(loc).toBeDefined();
  });

  it('postcode if present matches UK format', async () => {
    const html = await loadFixture('club-location-sample.html');
    const loc = parseClubLocation(html);
    if (loc.postcode !== undefined) {
      expect(loc.postcode).toMatch(/^[A-Z]{1,2}\d{1,2}[A-Z]?\s*\d[A-Z]{2}$/i);
    }
  });

  it('coordinates if present are within valid ranges', async () => {
    const html = await loadFixture('club-location-sample.html');
    const loc = parseClubLocation(html);
    if (loc.lat !== undefined && loc.lng !== undefined) {
      expect(loc.lat).toBeGreaterThanOrEqual(-90);
      expect(loc.lat).toBeLessThanOrEqual(90);
      expect(loc.lng).toBeGreaterThanOrEqual(-180);
      expect(loc.lng).toBeLessThanOrEqual(180);
    }
  });

  it('extracts the correct postcode HX7 5TA from the Cragg Vale fixture', async () => {
    const html = await loadFixture('club-location-sample.html');
    const loc = parseClubLocation(html);
    expect(loc.postcode).toBe('HX7 5TA');
  });

  it('does not confuse the contact row for location data', async () => {
    const html = await loadFixture('club-location-sample.html');
    const loc = parseClubLocation(html);
    // The contact name "Ellis Ward" must not leak into the address field
    expect(loc.address).not.toContain('Ellis Ward');
  });
});
