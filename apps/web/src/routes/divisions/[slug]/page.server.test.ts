import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('$lib/server/db', () => ({ getDb: () => ({}) }));
vi.mock('@ctl/data', () => ({
  getDivisionTable: vi.fn(),
  listFixturesByDivision: vi.fn(),
  getRankingsByDivision: vi.fn(),
}));

import { load } from './+page.server.js';
import { getDivisionTable, listFixturesByDivision, getRankingsByDivision } from '@ctl/data';

const ev = (slug: string) => ({ params: { slug } }) as never;

describe('division load', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('throws 404 when the division is unknown', async () => {
    vi.mocked(getDivisionTable).mockResolvedValue(null);
    await expect(load(ev('nope'))).rejects.toMatchObject({ status: 404 });
  });

  it('returns table, fixtures and rankings for a known division', async () => {
    vi.mocked(getDivisionTable).mockResolvedValue({
      division: { id: 8, slug: 'mens-1', name: 'Mens Division 1', group: 'Mens', seasonId: 1 },
      rows: [],
    });
    vi.mocked(listFixturesByDivision).mockResolvedValue([]);
    vi.mocked(getRankingsByDivision).mockResolvedValue([]);
    const result = await load(ev('mens-1'));
    expect(result.table.division.slug).toBe('mens-1');
    expect(vi.mocked(listFixturesByDivision)).toHaveBeenCalledWith({}, 8);
    expect(vi.mocked(getRankingsByDivision)).toHaveBeenCalledWith({}, 8);
  });
});
