import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('$lib/server/db', () => ({ getDb: () => ({}) }));
vi.mock('@ctl/data', () => ({ getClubDetail: vi.fn() }));

import { load } from './+page.server.js';
import { getClubDetail } from '@ctl/data';

const ev = (slug: string) => ({ params: { slug } }) as never;

describe('club load', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('throws 404 when the club is unknown', async () => {
    vi.mocked(getClubDetail).mockResolvedValue(null);
    await expect(load(ev('nope'))).rejects.toMatchObject({ status: 404 });
  });

  it('returns the club for a known slug', async () => {
    vi.mocked(getClubDetail).mockResolvedValue({
      slug: 'cragg-vale', name: 'Cragg Vale', address: 'Hinchcliffe Arms', postcode: 'HX7 5TA',
      lat: '53.7', lng: '-2.0', teams: [],
    });
    const result = await load(ev('cragg-vale'));
    expect(result.club.postcode).toBe('HX7 5TA');
    expect(vi.mocked(getClubDetail)).toHaveBeenCalledWith({}, 'cragg-vale');
  });
});
