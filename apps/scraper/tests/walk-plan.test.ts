import { describe, it, expect } from 'vitest';
import { buildInitialSteps, buildDivisionSteps, buildMatchCardStep } from '../src/walk-plan.js';

describe('walk plan', () => {
  it('initial steps include season-nav and clubs-directory in order', () => {
    const steps = buildInitialSteps();
    expect(steps.map((s) => s.kind)).toEqual(['season-nav', 'clubs-directory']);
  });

  it('division steps include league-table + fixtures + rankings for each division', () => {
    const steps = buildDivisionSteps('Summer 2026', [
      { divisionId: 1, divisionSlug: 'mens-1', upstreamModeId: 1 },
      { divisionId: 2, divisionSlug: 'mens-2', upstreamModeId: 2 },
    ]);
    expect(steps).toHaveLength(6);
    expect(steps[0]?.kind).toBe('league-table');
    expect(steps[1]?.kind).toBe('fixtures-and-results');
    expect(steps[2]?.kind).toBe('player-rankings');
  });

  it('match card step references fixture id and url', () => {
    const step = buildMatchCardStep(99, 'https://www.ludus-online.com/result_card_3.php?fixture_id=99');
    expect(step.kind).toBe('match-card');
    if (step.kind === 'match-card') {
      expect(step.fixtureId).toBe(99);
    }
  });
});
