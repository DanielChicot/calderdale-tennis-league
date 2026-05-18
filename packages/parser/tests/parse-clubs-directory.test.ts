import { describe, it, expect } from 'vitest';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseClubsDirectory } from '../src/parse-clubs-directory.js';

const loadFixture = async (name: string) =>
  readFile(resolve(__dirname, '../../../fixtures', name), 'utf8');

describe('parseClubsDirectory', () => {
  it('extracts every club listed in the fixture as raw row types', async () => {
    const html = await loadFixture('clubs-directory.html');
    const rows = parseClubsDirectory(html);

    expect(rows.length).toBeGreaterThan(10);
    for (const row of rows) {
      expect(row.observedName).toBeTypeOf('string');
      expect(row.observedName.length).toBeGreaterThan(0);
      expect(row.slug).toMatch(/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/);
    }
  });

  it('includes the Queens club with a kebab-case slug', async () => {
    const html = await loadFixture('clubs-directory.html');
    const rows = parseClubsDirectory(html);
    const queens = rows.find((r) => /queens/i.test(r.observedName));
    expect(queens).toBeDefined();
    expect(queens?.slug).toBeTypeOf('string');
  });

  it('deduplicates by slug', async () => {
    const html = await loadFixture('clubs-directory.html');
    const rows = parseClubsDirectory(html);
    const slugs = rows.map((r) => r.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });
});
