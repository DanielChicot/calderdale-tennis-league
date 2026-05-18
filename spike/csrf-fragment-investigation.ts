const BASE = 'https://www.calderdale.tennis-league.org/';
const UA = 'CalderdaleLeagueMirror-spike/0.2 (contact: dan.chicot@gmail.com)';

type Probe = { label: string; url: string };

const probes: Probe[] = [
  // displayResults.php — confirmed in Phase 1, sanity baseline
  // No refreshProtectionCode needed (Phase 1 verified). Full param set used.
  {
    label: 'displayResults-baseline',
    url: 'https://www.ludus-online.com/tennis-league/functions/administration/league/displayResults.php?WebsiteTimeZone=Europe/London&seasonIdentifierID=2&database=ludus3_tl_calderdale&commonDatabase=ludus3_tennis_common&mode=view-division&modeID=3&daysResultsRequired=7&resultsSecretaryVerificationRequired=N',
  },
  // displayContacts.php — unverified
  // teamID=80 = Cragg Vale, Mixed Div 1 (from fragment-urls.md)
  {
    label: 'displayContacts-token-zero',
    url: 'https://www.ludus-online.com/tennis-league/functions/season/displayContacts.php?WebsiteTimeZone=Europe/London&seasonIdentifierID=2&database=ludus3_tl_calderdale&commonDatabase=ludus3_tennis_common&Mode=team&teamID=80&contactIDPrefix=seasonLeagueDivisionWebObject&refreshProtectionCode=0&user_privacy=public',
  },
  // displayLocations.php — unverified
  // locationID=197, clubID=16 = Cragg Vale TC (from fragment-urls.md)
  {
    label: 'displayLocations-token-zero',
    url: 'https://www.ludus-online.com/tennis-league/functions/season/displayLocations.php?Mode=html&WebsiteTimeZone=Europe/London&seasonIdentifierID=2&database=ludus3_tl_calderdale&commonDatabase=ludus3_tennis_common&divisionID=3&locationID=197&clubID=16&contactIDPrefix=seasonLeagueDivisionWebObject&mapPrefix=location&tennisProductPath=tennis-league&refreshProtectionCode=0&user_privacy=public',
  },
  // result_card_37.php — unverified
  // fixture_id=453 (from fragment-urls.md recommended fixture URL)
  // modeID=czoxOiIzIjs= is PHP-serialized base64 for division 3 (Mixed Div 1)
  {
    label: 'result_card-token-zero',
    url: 'https://www.ludus-online.com/tennis-league/functions/results/results_cards/result_card_37.php?WebsiteTimeZone=Europe/London&fixture_id=453&database=ludus3_tl_calderdale&commonDatabase=ludus3_tennis_common&mode=view-division&modeID=czoxOiIzIjs%3D&refreshProtectionCode=0&daysResultsRequired=7&customersOrginisationName=Calderdale+Tennis+League&customerWebsiteURL=www.calderdale.tennis-league.org',
  },
];

const probe = async ({ label, url }: Probe) => {
  const res = await fetch(url, {
    headers: { 'User-Agent': UA },
    redirect: 'manual',
  });
  const body = await res.text();
  const hasContent = body.length > 500 && !/login|sign in/i.test(body.slice(0, 1000));
  console.log(`[${label}] status=${res.status} length=${body.length} hasContent=${hasContent}`);
  // Print first 300 chars so we can sanity-check we're not getting an error page
  console.log(`  preview: ${body.slice(0, 300).replace(/\s+/g, ' ')}`);
  return { label, status: res.status, length: body.length, hasContent };
};

const main = async () => {
  const results = [];
  for (const p of probes) {
    results.push(await probe(p));
    await new Promise((r) => setTimeout(r, 1000));
  }
  console.log('\nSummary:');
  console.table(results);
};

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
