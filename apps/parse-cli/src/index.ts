import {
  detectPageType,
  fetchHtml,
  parseClubsDirectory,
  parseLeagueTable,
  parsePlayerRankings,
  type PageType,
} from '@ctl/parser';

const dispatch = (pageType: PageType, html: string): unknown => {
  switch (pageType) {
    case 'clubs-directory':
      return parseClubsDirectory(html);
    case 'league-table':
      return parseLeagueTable(html);
    case 'player-rankings':
      return parsePlayerRankings(html);
  }
};

const main = async () => {
  const url = process.argv[2];
  if (!url) {
    console.error('Usage: pnpm parse <url>');
    process.exit(1);
  }
  const pageType = detectPageType(url);
  const html = await fetchHtml(url);
  const result = dispatch(pageType, html);
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
};

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
