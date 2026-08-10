// The visitor's claimed player identity, stored client-side only in a
// first-party cookie. A LIST so "follow teammates" can arrive later without
// a cookie migration — v1 reads only the first entry.
export const ME_COOKIE = 'ctl_me';

export type Identity = { slug: string; name: string };

// Never throws: any malformed/legacy cookie is treated as "not identified".
export const parseMeCookie = (raw: string | undefined): Identity[] => {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    const players = (parsed as { players?: unknown } | null)?.players;
    if (!Array.isArray(players)) return [];
    return players.filter(
      (p): p is Identity =>
        typeof p === 'object' && p !== null &&
        typeof (p as Record<string, unknown>).slug === 'string' &&
        typeof (p as Record<string, unknown>).name === 'string',
    ).map((p) => ({ slug: p.slug, name: p.name }));
  } catch {
    return [];
  }
};

export const serializeMeCookie = (identities: Identity[]): string =>
  JSON.stringify({ players: identities.map(({ slug, name }) => ({ slug, name })) });

// Not HttpOnly: this is the visitor's own device state, clearable client-side.
export const ME_COOKIE_OPTS = {
  path: '/',
  maxAge: 60 * 60 * 24 * 365,
  sameSite: 'lax',
  httpOnly: false,
} as const;
