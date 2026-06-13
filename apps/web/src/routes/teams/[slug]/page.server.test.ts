import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('$lib/server/db', () => ({ getDb: () => ({}) }));
vi.mock('@ctl/data', () => ({ getTeam: vi.fn() }));

import { load } from './+page.server.js';
import { getTeam } from '@ctl/data';

const ev = (slug: string) => ({ params: { slug } }) as never;

describe('team load', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('throws 404 when the team is unknown', async () => {
    vi.mocked(getTeam).mockResolvedValue(null);
    await expect(load(ev('nope'))).rejects.toMatchObject({ status: 404 });
  });

  it('returns the team for a known slug', async () => {
    vi.mocked(getTeam).mockResolvedValue({
      slug: 'cragg-vale-a', name: 'Cragg Vale A',
      club: { slug: 'cragg-vale', name: 'Cragg Vale' }, division: { slug: 'mens-1', name: 'Mens Division 1' },
      contacts: [], fixtures: [], squad: [],
    });
    const result = await load(ev('cragg-vale-a'));
    expect(result.team.name).toBe('Cragg Vale A');
    expect(vi.mocked(getTeam)).toHaveBeenCalledWith({}, 'cragg-vale-a');
  });
});
