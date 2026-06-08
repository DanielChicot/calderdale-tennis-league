import { describe, it, expect } from 'vitest';
import { buildInitialSteps, buildDivisionSteps, buildMatchCardStep, buildDivisionsDiscoveryStep } from '../src/walk-plan.js';

describe('walk plan', () => {
  it('initial steps include season-nav and clubs-directory in order', () => {
    const steps = buildInitialSteps();
    expect(steps.map((s) => s.kind)).toEqual(['season-nav', 'clubs-directory']);
  });

  it('division steps include league-table-post + fixtures + rankings for each division', () => {
    const steps = buildDivisionSteps('Summer 2026', [
      { divisionId: 1, divisionSlug: 'mens-1', upstreamModeId: 8 },
      { divisionId: 2, divisionSlug: 'mens-2', upstreamModeId: 9 },
    ]);
    expect(steps).toHaveLength(6);
    expect(steps[0]?.kind).toBe('league-table-post');
    expect(steps[1]?.kind).toBe('fixtures-and-results');
    expect(steps[2]?.kind).toBe('player-rankings');
    expect(steps[3]?.kind).toBe('league-table-post');
  });

  it('league-table-post step carries the form body for the division modeID', () => {
    const steps = buildDivisionSteps('Summer 2026', [
      { divisionId: 1, divisionSlug: 'mens-1', upstreamModeId: 8 },
    ]);
    const lt = steps[0];
    expect(lt?.kind).toBe('league-table-post');
    if (lt?.kind === 'league-table-post') {
      expect(lt.url).toContain('index.php?navButtonSelect=Summer%202026&tabIndex=0');
      expect(lt.postBody).toBe('season_subNav_mode=league&season_subNav_subMode=division&season_subNav_my_division=8&refreshProtectionCode=0');
      expect(lt.divisionId).toBe(1);
      expect(lt.modeId).toBe(8);
    }
  });

  it('match card step references fixture id and url', () => {
    const step = buildMatchCardStep(99, 'https://www.ludus-online.com/result_card_3.php?fixture_id=99');
    expect(step.kind).toBe('match-card');
    if (step.kind === 'match-card') {
      expect(step.fixtureId).toBe(99);
    }
  });

  it('divisions discovery step carries the seasonId and URL for the named season', () => {
    const step = buildDivisionsDiscoveryStep('Summer 2026', 42);
    expect(step.kind).toBe('divisions-discovery');
    if (step.kind === 'divisions-discovery') {
      expect(step.url).toContain('navButtonSelect=Summer%202026');
      expect(step.url).toContain('tabIndex=0');
      expect(step.url).toContain('refreshProtectionCode=0');
      expect(step.seasonId).toBe(42);
    }
  });
});
