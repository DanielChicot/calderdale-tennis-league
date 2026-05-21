import { describe, it, expect } from 'vitest';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseClubContacts } from '../src/parse-club-contacts.js';

const loadFixture = async (name: string) =>
  readFile(resolve(__dirname, '../../../fixtures', name), 'utf8');

describe('parseClubContacts', () => {
  it('extracts at least one contact row', async () => {
    const html = await loadFixture('club-contacts-sample.html');
    const rows = parseClubContacts(html);
    expect(rows.length).toBeGreaterThan(0);
  });

  it('every contact has a name', async () => {
    const html = await loadFixture('club-contacts-sample.html');
    const rows = parseClubContacts(html);
    for (const r of rows) {
      expect(r.name.length).toBeGreaterThan(0);
    }
  });

  it('optional fields are typed correctly when present', async () => {
    const html = await loadFixture('club-contacts-sample.html');
    const rows = parseClubContacts(html);
    for (const r of rows) {
      if (r.email !== undefined) expect(r.email).toMatch(/@/);
      if (r.phone !== undefined) expect(r.phone.length).toBeGreaterThan(0);
      if (r.role !== undefined) expect(r.role.length).toBeGreaterThan(0);
    }
  });

  it('extracts exactly 4 contacts including Becky Devereux', async () => {
    const html = await loadFixture('club-contacts-sample.html');
    const rows = parseClubContacts(html);
    expect(rows.length).toBe(4);
    const becky = rows.find((r) => r.name === 'Becky Devereux');
    expect(becky).toBeDefined();
  });
});
