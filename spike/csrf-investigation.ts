import { fetch } from 'undici';

const BASE = 'https://www.calderdale.tennis-league.org/';
const UA = 'CalderdaleLeagueMirror-spike/0.1 (contact: dan.chicot@gmail.com)';

const probe = async (label: string, url: string, init: RequestInit = {}) => {
  const res = await fetch(url, {
    ...init,
    headers: { 'User-Agent': UA, ...(init.headers ?? {}) },
    redirect: 'manual',
  });
  const body = await res.text();
  console.log(
    `[${label}] status=${res.status} length=${body.length} hasLeagueTable=${body.includes('League Table')}`,
  );
  return { status: res.status, body, headers: res.headers };
};

const main = async () => {
  // 1. Bare URL with no token at all
  await probe('no-token', `${BASE}?navButtonSelect=Summer%202026`);

  // 2. URL with refreshProtectionCode=0 (seen in the wild)
  await probe(
    'token-zero',
    `${BASE}?navButtonSelect=Summer%202026&refreshProtectionCode=0`,
  );

  // 3. Warm-up: fetch home, capture cookies, replay with cookie
  const home = await probe('warmup-home', BASE);
  const cookie = home.headers.get('set-cookie');
  if (cookie) {
    await probe(
      'warmup-replay',
      `${BASE}?navButtonSelect=Summer%202026`,
      { headers: { Cookie: cookie } },
    );
  }
};

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
