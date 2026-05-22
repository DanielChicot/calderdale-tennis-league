type ScraperArgs =
  | { mode: 'current' }
  | { mode: 'season'; seasonSlug: string }
  | { mode: 'backfill' };

export const parseArgs = (argv: string[]): ScraperArgs => {
  if (argv.length === 0) return { mode: 'current' };
  for (const arg of argv) {
    if (arg === '--backfill') return { mode: 'backfill' };
    const seasonMatch = /^--season=(.+)$/.exec(arg);
    if (seasonMatch) return { mode: 'season', seasonSlug: seasonMatch[1]! };
    if (arg === '--season') throw new Error('--season requires a value, e.g. --season=summer-2024');
    throw new Error(`Unknown argument: ${arg}`);
  }
  return { mode: 'current' };
};

const main = async () => {
  const args = parseArgs(process.argv.slice(2));
  const { runCurrent } = await import('./modes/current.js');
  const { runSeason } = await import('./modes/season.js');
  const { runBackfill } = await import('./modes/backfill.js');

  switch (args.mode) {
    case 'current':
      await runCurrent();
      break;
    case 'season':
      await runSeason(args.seasonSlug);
      break;
    case 'backfill':
      await runBackfill();
      break;
  }
};

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
