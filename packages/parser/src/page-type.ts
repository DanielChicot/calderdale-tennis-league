export type ShellPageType = 'clubs-directory' | 'league-table' | 'player-rankings' | 'season-nav';
export type FragmentType = 'fixtures-and-results' | 'club-contacts' | 'club-location' | 'match-card';
export type PageType = ShellPageType | FragmentType;

const SHELL_HOST = 'www.calderdale.tennis-league.org';
const FRAGMENT_HOST = 'www.ludus-online.com';

export const detectShellPageType = (url: string): ShellPageType => {
  const u = new URL(url);
  if (u.host !== SHELL_HOST) {
    throw new Error(`detectShellPageType: not a shell URL: ${url}`);
  }
  const params = u.searchParams;
  const nav = params.get('navButtonSelect');
  const dirMode = params.get('directory_mode');
  const tabIndex = params.get('tabIndex');

  if (u.search === '') return 'season-nav';
  if (nav === 'Directory' && dirMode?.startsWith('Clubs/Teams')) return 'clubs-directory';
  if (nav?.startsWith('Summer') || nav?.startsWith('Winter')) {
    if (tabIndex === '0') return 'league-table';
    if (tabIndex === '4') return 'player-rankings';
  }
  throw new Error(`detectShellPageType: cannot classify ${url}`);
};

export const detectFragmentType = (url: string): FragmentType => {
  const u = new URL(url);
  if (u.host !== FRAGMENT_HOST) {
    throw new Error(`detectFragmentType: not a fragment URL: ${url}`);
  }
  const path = u.pathname;
  if (path === '/displayResults.php') return 'fixtures-and-results';
  if (path === '/displayContacts.php') return 'club-contacts';
  if (path === '/displayLocations.php') return 'club-location';
  if (/^\/result_card_\d+\.php$/.test(path)) return 'match-card';
  throw new Error(`detectFragmentType: cannot classify ${url}`);
};

export const detectPageType = (url: string): PageType => {
  const host = new URL(url).host;
  if (host === SHELL_HOST) return detectShellPageType(url);
  if (host === FRAGMENT_HOST) return detectFragmentType(url);
  throw new Error(`detectPageType: unknown host: ${host}`);
};
