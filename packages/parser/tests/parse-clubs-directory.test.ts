import { describe, it, expect } from 'vitest';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { parseClubsDirectory } from '../src/parse-clubs-directory.js';
import { Club } from '@ctl/domain';

const __dirname = dirname(fileURLToPath(import.meta.url));

const loadFixture = async (name: string) =>
  readFile(resolve(__dirname, '../../../fixtures', name), 'utf8');

describe('parseClubsDirectory', () => {
  it('extracts every club listed in the fixture', async () => {
    const html = await loadFixture('clubs-directory.html');
    const clubs = parseClubsDirectory(html);

    expect(clubs.length).toBeGreaterThan(10);
    for (const c of clubs) {
      expect(() => Club.parse(c)).not.toThrow();
    }
  });

  it('includes Cragg Vale Tennis Club with a kebab-case slug', async () => {
    const html = await loadFixture('clubs-directory.html');
    const clubs = parseClubsDirectory(html);
    const cv = clubs.find((c) => c.name === 'Cragg Vale Tennis Club');
    expect(cv).toBeDefined();
    expect(cv?.slug).toBe('cragg-vale-tennis-club');
  });

  it('assigns deterministic positive ids', async () => {
    const html = await loadFixture('clubs-directory.html');
    const clubs = parseClubsDirectory(html);
    const ids = clubs.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.every((id) => Number.isInteger(id) && id > 0)).toBe(true);
  });
});
