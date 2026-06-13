import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('$lib/server/db', () => ({ getDb: () => ({}) }));
vi.mock('@ctl/data', () => ({
  getCurrentSeason: vi.fn(),
  listSeasons: vi.fn(),
  listDivisions: vi.fn(),
}));

import { load } from './+page.server.js';
import { getCurrentSeason, listSeasons, listDivisions } from '@ctl/data';

describe('home load', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('returns null season + empty groups when no current season', async () => {
    vi.mocked(getCurrentSeason).mockResolvedValue(null);
    vi.mocked(listSeasons).mockResolvedValue([]);
    const result = await load({} as never);
    expect(result.currentSeason).toBeNull();
    expect(result.groups).toEqual([]);
  });

  it('groups the current season divisions Mens/Ladies/Mixed', async () => {
    vi.mocked(getCurrentSeason).mockResolvedValue({ id: 1, slug: 'summer-2026', name: 'Summer 2026', current: true });
    vi.mocked(listSeasons).mockResolvedValue([{ id: 1, slug: 'summer-2026', name: 'Summer 2026', current: true }]);
    vi.mocked(listDivisions).mockResolvedValue([
      { id: 10, slug: 'mens-1', name: 'Mens Division 1', group: 'Mens', seasonId: 1 },
      { id: 11, slug: 'ladies-1', name: 'Ladies Division 1', group: 'Ladies', seasonId: 1 },
    ]);
    const result = await load({} as never);
    expect(result.currentSeason?.slug).toBe('summer-2026');
    expect(result.groups.map((g) => g.group)).toEqual(['Mens', 'Ladies']);
    expect(vi.mocked(listDivisions)).toHaveBeenCalledWith({}, 1);
  });
});
