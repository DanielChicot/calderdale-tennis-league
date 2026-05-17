export type PageType = 'clubs-directory' | 'league-table' | 'player-rankings';

export const detectPageType = (url: string): PageType => {
  const u = new URL(url);
  const params = u.searchParams;

  const nav = params.get('navButtonSelect');
  const dirMode = params.get('directory_mode');
  const tabIndex = params.get('tabIndex');

  if (nav === 'Directory' && dirMode?.startsWith('Clubs/Teams')) {
    return 'clubs-directory';
  }
  if (nav?.startsWith('Summer') || nav?.startsWith('Winter')) {
    if (tabIndex === '0') return 'league-table';
    if (tabIndex === '4') return 'player-rankings';
  }
  throw new Error(`detectPageType: cannot classify ${url}`);
};
