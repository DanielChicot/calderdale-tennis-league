import {
  detectPageType,
  fetchHtml,
  parseClubsDirectory,
  parseLeagueTable,
  parsePlayerRankings,
  parseSeasonNav,
  parseFixturesAndResults,
  parseMatchCard,
  parseClubContacts,
  parseClubLocation,
  type PageType,
} from '@ctl/parser';

const dispatch = (pageType: PageType, html: string): unknown => {
  switch (pageType) {
    case 'clubs-directory': return parseClubsDirectory(html);
    case 'league-table': return parseLeagueTable(html);
    case 'player-rankings': return parsePlayerRankings(html);
    case 'season-nav': return parseSeasonNav(html);
    case 'fixtures-and-results': return parseFixturesAndResults(html);
    case 'match-card': return parseMatchCard(html);
    case 'club-contacts': return parseClubContacts(html);
    case 'club-location': return parseClubLocation(html);
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
  process.stdout.write(JSON.stringify(dispatch(pageType, html), null, 2) + '\n');
};

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
