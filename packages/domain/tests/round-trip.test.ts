import { describe, it, expect } from 'vitest';
import { Club, Division, Ranking, Fixture, Result, Rubber, MatchCard } from '../src/index.js';

describe('domain round-trip (parse → serialise → re-parse)', () => {
  it('Club survives JSON round-trip', () => {
    const original: Club = {
      id: 1,
      slug: 'halifax-queens',
      name: 'Halifax Queens',
      location: { lat: 53.7, lng: -1.86 },
    };
    const reparsed = Club.parse(JSON.parse(JSON.stringify(original)));
    expect(reparsed).toEqual(original);
  });

  it('Division enforces group enum', () => {
    expect(() =>
      Division.parse({ id: 1, slug: 'd', name: 'D', group: 'Junior', seasonId: 1 }),
    ).toThrow();
  });

  it('Ranking rejects negative rubbers', () => {
    expect(() =>
      Ranking.parse({
        playerId: 1,
        divisionId: 1,
        rank: 1,
        rubbersWon: -1,
        rubbersPlayed: 0,
        gamesWon: 0,
        gamesPlayed: 0,
        rankingScore: 0,
        movement: 'same',
      }),
    ).toThrow();
  });

  it('Fixture rejects unknown status', () => {
    expect(() =>
      Fixture.parse({
        id: 1,
        date: '2026-05-15',
        homeTeamId: 1,
        awayTeamId: 2,
        divisionId: 1,
        status: 'in-progress',
      }),
    ).toThrow();
  });

  it('Result accepts no matchCard (e.g. before result entry)', () => {
    const r: Result = { fixtureId: 1, homeScore: 0, awayScore: 0 };
    expect(Result.parse(JSON.parse(JSON.stringify(r)))).toEqual(r);
  });

  it('Rubber requires at least one set', () => {
    expect(() =>
      Rubber.parse({ homePlayerIds: [1], awayPlayerIds: [2], sets: [] }),
    ).toThrow();
  });

  it('Rubber rejects mismatched singles/doubles sides', () => {
    expect(() =>
      Rubber.parse({
        homePlayerIds: [1],
        awayPlayerIds: [2, 3],
        sets: [{ home: 6, away: 3 }],
      }),
    ).toThrow();
  });

  it('MatchCard with valid Rubber survives JSON round-trip', () => {
    const original: MatchCard = {
      fixtureId: 1,
      rubbers: [
        {
          homePlayerIds: [1, 2],
          awayPlayerIds: [3, 4],
          sets: [
            { home: 6, away: 3 },
            { home: 6, away: 4 },
          ],
        },
      ],
    };
    const reparsed = MatchCard.parse(JSON.parse(JSON.stringify(original)));
    expect(reparsed).toEqual(original);
  });
});
