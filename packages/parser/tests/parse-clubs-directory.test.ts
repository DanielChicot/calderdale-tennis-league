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

    expect(clubs.length).toBe(18);
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

  it('assigns deterministic positive ids across repeated calls', async () => {
    const html = await loadFixture('clubs-directory.html');
    const first = parseClubsDirectory(html);
    const second = parseClubsDirectory(html);

    expect(first.map((c) => c.id)).toEqual(second.map((c) => c.id));
    expect(first.map((c) => c.slug)).toEqual(second.map((c) => c.slug));

    const ids = first.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.every((id) => Number.isInteger(id) && id > 0)).toBe(true);
  });

  it('captures clubs whose names contain an ampersand', async () => {
    const html = await loadFixture('clubs-directory.html');
    const clubs = parseClubsDirectory(html);
    const names = clubs.map((c) => c.name);
    expect(names).toContain('Elland Cricket, Athletic & Bowling Club');
    expect(names).toContain('Huddersfield Lawn Tennis & Squash Club');
    expect(names).toContain('Oakfield Tennis & Bowling Club Ltd');
    expect(names).toContain('Sowerby Tennis & Bowling Club');
  });
});
