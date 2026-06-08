import { describe, it, expect } from 'vitest';
import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseLeagueTableWithTeamIds } from '../src/parse-league-table-with-team-ids.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const loadFixture = async (name: string) =>
  readFile(resolve(__dirname, '../../../fixtures', name), 'utf8');

describe('parseLeagueTableWithTeamIds', () => {
  it('returns 10 standings rows for Mens Div 1, positions 1..10', async () => {
    const html = await loadFixture('league-table-mens-div-1-post.html');
    const { standings } = parseLeagueTableWithTeamIds(html);
    expect(standings).toHaveLength(10);
    expect(standings.map((s) => s.position)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });

  it('parses points as numbers (half-points preserved as numeric)', async () => {
    const html = await loadFixture('league-table-mens-div-1-post.html');
    const { standings } = parseLeagueTableWithTeamIds(html);
    for (const s of standings) {
      expect(Number.isFinite(s.pointsWon)).toBe(true);
      expect(Number.isFinite(s.pointsLost)).toBe(true);
      expect(s.resultsReceived).toBeGreaterThanOrEqual(0);
      expect(s.resultsTotal).toBeGreaterThan(0);
    }
  });

  it('locks in column-order: cells[3]=pointsWon, cells[2]=pointsLost (leader has more wins than losses)', async () => {
    // The position-1 team should always have more points won than lost — if the
    // mapping ever flips this test catches it.
    const html = await loadFixture('league-table-mens-div-1-post.html');
    const { standings } = parseLeagueTableWithTeamIds(html);
    const leader = standings[0]!;
    expect(leader.pointsWon).toBeGreaterThan(leader.pointsLost);
    // Belt-and-braces: assert the known leader values from the fixture.
    expect(leader.teamName).toBe('Cragg Vale A');
    expect(leader.pointsWon).toBe(48);
    expect(leader.pointsLost).toBe(10);
  });

  it('returns 10 team handlers with numeric upstreamTeamId', async () => {
    const html = await loadFixture('league-table-mens-div-1-post.html');
    const { teamHandlers } = parseLeagueTableWithTeamIds(html);
    expect(teamHandlers).toHaveLength(10);
    for (const h of teamHandlers) {
      expect(Number.isInteger(h.upstreamTeamId)).toBe(true);
      expect(h.upstreamTeamId).toBeGreaterThan(0);
      expect(h.teamName).toBe(h.teamName.trim());
      expect(h.teamName.length).toBeGreaterThan(0);
    }
  });

  it('team-name set from standings equals team-name set from team handlers', async () => {
    const html = await loadFixture('league-table-mens-div-1-post.html');
    const { standings, teamHandlers } = parseLeagueTableWithTeamIds(html);
    const fromStandings = new Set(standings.map((s) => s.teamName));
    const fromHandlers = new Set(teamHandlers.map((h) => h.teamName));
    expect(fromStandings).toEqual(fromHandlers);
  });

  it('ignores displayContact(null, ...) outside the contacts list', () => {
    // The whole-page script call `displayContact( null, 31)` should never produce a handler.
    const html = `
      <html><body>
        <script>displayContact( null, 31);</script>
        <ul><li onclick="displayContact( this, 40 )">Cragg Vale A</li></ul>
        <div id="leagueTable"><table class="leagueTable_table">
          <thead><tr></tr></thead>
          <tbody>
            <tr><td>Cragg Vale A</td><td>1/2</td><td>3</td><td>5</td><td></td></tr>
          </tbody>
        </table></div>
      </body></html>
    `;
    const { teamHandlers } = parseLeagueTableWithTeamIds(html);
    expect(teamHandlers).toEqual([{ teamName: 'Cragg Vale A', upstreamTeamId: 40 }]);
  });
});
