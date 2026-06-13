import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('$lib/server/db', () => ({ getDb: () => ({}) }));
vi.mock('@ctl/data', () => ({ getMatchCard: vi.fn() }));

import { load } from './+page.server.js';
import { getMatchCard } from '@ctl/data';

const ev = (id: string) => ({ params: { id } }) as never;

describe('match-card load', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('throws 404 for a non-numeric id', async () => {
    await expect(load(ev('abc'))).rejects.toMatchObject({ status: 404 });
    expect(vi.mocked(getMatchCard)).not.toHaveBeenCalled();
  });

  it('throws 404 when no card exists', async () => {
    vi.mocked(getMatchCard).mockResolvedValue(null);
    await expect(load(ev('123'))).rejects.toMatchObject({ status: 404 });
    expect(vi.mocked(getMatchCard)).toHaveBeenCalledWith({}, 123);
  });

  it('returns the card for a valid id', async () => {
    vi.mocked(getMatchCard).mockResolvedValue({
      fixture: { id: 123, date: '2026-04-23', division: { slug: 'mens-1', name: 'Mens Division 1' },
        homeTeam: { slug: 'h', name: 'H' }, awayTeam: { slug: 'a', name: 'A' }, score: { home: '6', away: '3' } },
      rubbers: [],
    });
    const result = await load(ev('123'));
    expect(result.card.fixture.id).toBe(123);
  });
});
