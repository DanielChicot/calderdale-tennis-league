import { afterAll, beforeAll, beforeEach, describe, it, expect, vi } from 'vitest';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { and, eq, sql } from 'drizzle-orm';
import { startDb, stopDb, getDb } from './setup.js';
import { createOrchestrator } from '../src/orchestrator.js';
import { schema } from '@ctl/db';

const fixtureHtml = (name: string) =>
  readFile(resolve(__dirname, '../../../fixtures', name), 'utf8');

describe('orchestrator modes', () => {
  beforeAll(async () => {
    await startDb();
  }, 120_000);
  afterAll(async () => {
    await stopDb();
  });
  beforeEach(async () => {
    await getDb().execute(
      sql`TRUNCATE seasons, divisions, clubs, club_aliases, teams, team_contacts, players, player_aliases, fixtures, results, match_cards, rubbers, set_scores, rankings, standings, scrape_runs RESTART IDENTITY CASCADE`,
    );
  });

  it('runCurrent populates seasons, clubs, divisions, teams, fixtures, standings, rankings, match cards, contacts, locations', async () => {
    const seasonNav = await fixtureHtml('season-nav.html');
    const clubsDir = await fixtureHtml('clubs-directory.html');
    const leagueTablePost = await fixtureHtml('league-table-mens-div-1-post.html');
    const fixturesAndResults = await fixtureHtml('fixtures-and-results-mens-div-1.html');
    const playerRankings = await fixtureHtml('player-rankings-mens.html');
    const matchCard = await fixtureHtml('match-card-sample.html');
    const clubContacts = await fixtureHtml('club-contacts-sample.html');
    const clubLocation = await fixtureHtml('club-location-sample.html');

    const http = {
      fetchPage: vi.fn(async (url: string, prior?: { contentHash?: string }) => {
        if (url === 'https://www.calderdale.tennis-league.org/') {
          return { kind: 'changed' as const, status: 200, html: seasonNav, contentHash: 'home' };
        }
        if (url.includes('navButtonSelect=Directory')) {
          return { kind: 'changed' as const, status: 200, html: clubsDir, contentHash: 'clubs' };
        }
        if (url.includes('tabIndex=0')) {
          // divisions-discovery uses the same GET URL. Service it with the POST fixture
          // since the fixture also contains the divisions <select> dropdown.
          return { kind: 'changed' as const, status: 200, html: leagueTablePost, contentHash: `disc:${url}`.slice(0, 64) };
        }
        if (url.includes('displayResults.php')) {
          return { kind: 'changed' as const, status: 200, html: fixturesAndResults, contentHash: `fr:${url}`.slice(0, 64) };
        }
        if (url.includes('result_card_')) {
          const hash = `mc:${url}`.slice(0, 64);
          // Honour content-hash dedup for card URLs so the e2e exercises the
          // ignorePrior path: without it, a re-ingested card whose page is
          // unchanged would return 'unchanged' and never be rewritten.
          if (prior?.contentHash === hash) {
            return { kind: 'unchanged' as const, status: 200, contentHash: hash };
          }
          return { kind: 'changed' as const, status: 200, html: matchCard, contentHash: hash };
        }
        if (url.includes('displayContacts.php')) {
          return { kind: 'changed' as const, status: 200, html: clubContacts, contentHash: `cc:${url}`.slice(0, 64) };
        }
        if (url.includes('displayLocations.php')) {
          return { kind: 'changed' as const, status: 200, html: clubLocation, contentHash: `cl:${url}`.slice(0, 64) };
        }
        return { kind: 'changed' as const, status: 200, html: '<html></html>', contentHash: `ot:${url}`.slice(0, 64) };
      }),
      fetchPagePost: vi.fn(async (url: string, body: string) => {
        if (url.includes('index.php') && url.includes('tabIndex=0')) {
          return { kind: 'changed' as const, status: 200, html: leagueTablePost, contentHash: `ltp:${body}`.slice(0, 64) };
        }
        if (url.includes('index.php') && url.includes('tabIndex=4')) {
          // Per-group rankings POSTs — all three groups get the Mens fixture; the
          // handler maps each group's digits onto that group's real divisions.
          return { kind: 'changed' as const, status: 200, html: playerRankings, contentHash: `pr:${body}`.slice(0, 64) };
        }
        return { kind: 'changed' as const, status: 200, html: '<html></html>', contentHash: `pst:${url}`.slice(0, 64) };
      }),
    };
    const orch = createOrchestrator(getDb(), http);
    const report = await orch.runCurrent();

    expect(report.currentSeasonId).toBeGreaterThan(0);

    const db = getDb();
    const seasons = await db.select().from(schema.seasons);
    expect(seasons.filter((s) => s.current)).toHaveLength(1);

    const divisions = await db.select().from(schema.divisions);
    expect(divisions).toHaveLength(9);

    const teamsWithUpstream = await db
      .select()
      .from(schema.teams)
      .where(sql`upstream_team_id IS NOT NULL`);
    // The Mens Div 1 fixture has 10 team-handler entries; the same fixture is served for
    // every division's league-table-post, so all matching teams (one per league-table
    // walk) get their upstream_team_id set.
    expect(teamsWithUpstream.length).toBeGreaterThanOrEqual(10);

    const standingsRows = await db.select().from(schema.standings);
    expect(standingsRows.length).toBeGreaterThanOrEqual(10);
    for (const s of standingsRows) {
      expect(s.position).toBeGreaterThanOrEqual(1);
      expect(s.divisionId).toBeGreaterThan(0);
      expect(s.teamId).toBeGreaterThan(0);
    }

    // At least one division must have all 10 standings rows present. Test serves the same
    // 10-team Mens Div 1 fixture to every division, so subsequent walks fail on the
    // upstream_team_id partial-unique index — but the first division must succeed cleanly.
    const firstDivId = divisions[0]!.id;
    const firstDivStandings = standingsRows.filter((s) => s.divisionId === firstDivId);
    expect(firstDivStandings).toHaveLength(10);
    const positions = firstDivStandings.map((s) => s.position).sort((a, b) => a - b);
    expect(positions).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);

    const players = await db.select().from(schema.players);
    expect(players.length).toBeGreaterThanOrEqual(200);

    const rankingsRows = await db.select().from(schema.rankings);
    expect(rankingsRows.length).toBeGreaterThanOrEqual(200);
    for (const r of rankingsRows) {
      expect(r.rank).toBeGreaterThanOrEqual(1);
      expect(r.playerId).toBeGreaterThan(0);
      expect(r.divisionId).toBeGreaterThan(0);
    }

    // Every group's rankings step must have landed rows — a single group clearing
    // the >=200 floor must not mask the other two groups silently failing.
    const divisionGroupById = new Map(divisions.map((d) => [d.id, d.group]));
    const groupsWithRankings = new Set(rankingsRows.map((r) => divisionGroupById.get(r.divisionId)));
    expect(groupsWithRankings).toEqual(new Set(['Mens', 'Ladies', 'Mixed']));

    const cards = await db.select().from(schema.matchCards);
    expect(cards.length).toBeGreaterThan(0);

    const rubberRows = await db.select().from(schema.rubbers);
    // Sample card parses to exactly 9 rubbers, each pair 2v2.
    expect(rubberRows.length).toBe(cards.length * 9);
    for (const r of rubberRows) {
      expect(r.homePlayerIds).toHaveLength(2);
      expect(r.awayPlayerIds).toHaveLength(2);
    }

    const setRows = await db.select().from(schema.setScores);
    expect(setRows.length).toBe(cards.length * 9);   // 1 set per rubber in the sample
    for (const s of setRows) {
      expect(Number.isInteger(s.homeScore)).toBe(true);
      expect(Number.isInteger(s.awayScore)).toBe(true);
    }

    const clubsWithUpstream = await db
      .select()
      .from(schema.clubs)
      .where(sql`upstream_club_id IS NOT NULL`);
    expect(clubsWithUpstream.length).toBeGreaterThanOrEqual(15);

    const contactRows = await db.select().from(schema.teamContacts);
    expect(contactRows.length).toBeGreaterThan(0);
    for (const c of contactRows) {
      expect(c.name.length).toBeGreaterThan(0);
      expect(c.teamId).toBeGreaterThan(0);
    }

    const clubsWithPostcode = await db
      .select()
      .from(schema.clubs)
      .where(sql`postcode IS NOT NULL`);
    expect(clubsWithPostcode.length).toBeGreaterThan(0);

    // Self-healing + only-missing: delete one card, re-run, exactly one card refetch.
    const cardFetches = () =>
      (http.fetchPage.mock.calls as unknown[][]).filter(
        (c) => typeof c[0] === 'string' && (c[0] as string).includes('result_card_'),
      ).length;
    const fetchesAfterFirstRun = cardFetches();
    expect(fetchesAfterFirstRun).toBe(cards.length);   // one fetch per missing card

    await db.delete(schema.matchCards).where(eq(schema.matchCards.id, cards[0]!.id));
    await orch.runCurrent();

    expect(cardFetches()).toBe(fetchesAfterFirstRun + 1);   // only the deleted card refetched
    const cardsAfter = await db.select().from(schema.matchCards);
    expect(cardsAfter.length).toBe(cards.length);           // restored

    // Contacts handler idempotency: the mock always returns 'changed' for contacts
    // URLs, so the handler RAN again on the second runCurrent — if the delete-before-
    // insert were missing, the count would double here.
    const contactsAfterSecondRun = await db.select().from(schema.teamContacts);
    expect(contactsAfterSecondRun.length).toBe(contactRows.length);

    // Spot-check: rank 1 in Mens Division 1 is the fixture's leader.
    const mensDiv1 = divisions.find((d) => d.slug === 'mens-division-1');
    expect(mensDiv1).toBeDefined();
    const [top] = await db
      .select({ name: schema.players.name, rank: schema.rankings.rank })
      .from(schema.rankings)
      .innerJoin(schema.players, eq(schema.players.id, schema.rankings.playerId))
      .where(and(eq(schema.rankings.divisionId, mensDiv1!.id), eq(schema.rankings.rank, 1)));
    expect(top?.name).toBe('James Hodgson');

    const fixtures = await db.select().from(schema.fixtures);
    expect(fixtures.length).toBeGreaterThan(0);
  });
});
