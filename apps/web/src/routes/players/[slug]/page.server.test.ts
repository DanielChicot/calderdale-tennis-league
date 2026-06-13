import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('$lib/server/db', () => ({ getDb: () => ({}) }));
vi.mock('@ctl/data', () => ({ getPlayerProfile: vi.fn() }));

import { load } from './+page.server.js';
import { getPlayerProfile } from '@ctl/data';

const ev = (slug: string) => ({ params: { slug } }) as never;

describe('player load', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('throws 404 when the player is unknown', async () => {
    vi.mocked(getPlayerProfile).mockResolvedValue(null);
    await expect(load(ev('nope'))).rejects.toMatchObject({ status: 404 });
  });

  it('returns the profile for a known slug', async () => {
    vi.mocked(getPlayerProfile).mockResolvedValue({
      player: { slug: 'me', name: 'Me Player' }, club: { slug: 'c', name: 'C' },
      rankings: [], matchHistory: [],
    });
    const result = await load(ev('me'));
    expect(result.profile.player.name).toBe('Me Player');
    expect(vi.mocked(getPlayerProfile)).toHaveBeenCalledWith({}, 'me');
  });
});
