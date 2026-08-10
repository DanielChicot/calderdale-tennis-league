import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('$lib/server/db', () => ({ getDb: () => ({}) }));
vi.mock('@ctl/data', () => ({ searchPlayers: vi.fn() }));

import { load } from './+page.server.js';
import { searchPlayers } from '@ctl/data';

const event = (q: string | null) =>
  ({ url: new URL(`http://localhost/players${q != null ? `?q=${encodeURIComponent(q)}` : ''}`) }) as never;

describe('players search load', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('does not query for a missing or short q', async () => {
    expect(await load(event(null))).toEqual({ q: '', results: [] });
    expect(await load(event('j'))).toEqual({ q: 'j', results: [] });
    expect(vi.mocked(searchPlayers)).not.toHaveBeenCalled();
  });

  it('queries and returns results for q of 2+ chars', async () => {
    vi.mocked(searchPlayers).mockResolvedValue([
      { slug: 'jo-bloggs', name: 'Jo Bloggs', club: { slug: 'oak', name: 'Oak' } },
    ]);
    const result = await load(event('jo'));
    expect(vi.mocked(searchPlayers)).toHaveBeenCalledWith({}, 'jo');
    expect(result.results).toHaveLength(1);
    expect(result.q).toBe('jo');
  });
});
