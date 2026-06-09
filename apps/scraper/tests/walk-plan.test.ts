import { describe, it, expect } from 'vitest';
import { buildInitialSteps, buildDivisionSteps, buildMatchCardStep, buildDivisionsDiscoveryStep, buildPlayerRankingsStep } from '../src/walk-plan.js';

describe('walk plan', () => {
  it('initial steps include season-nav and clubs-directory in order', () => {
    const steps = buildInitialSteps();
    expect(steps.map((s) => s.kind)).toEqual(['season-nav', 'clubs-directory']);
  });

  it('division steps include league-table-post + fixtures for each division (rankings moved to per-group)', () => {
    const steps = buildDivisionSteps('Summer 2026', [
      { divisionId: 1, divisionSlug: 'mens-1', upstreamModeId: 8 },
      { divisionId: 2, divisionSlug: 'mens-2', upstreamModeId: 9 },
    ]);
    expect(steps).toHaveLength(4);
    expect(steps.map((s) => s.kind)).toEqual([
      'league-table-post',
      'fixtures-and-results',
      'league-table-post',
      'fixtures-and-results',
    ]);
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

  it('match card step builds the nested result-card URL with required params', () => {
    const step = buildMatchCardStep(5, 39, 127);
    expect(step.kind).toBe('match-card');
    if (step.kind === 'match-card') {
      expect(step.fixtureId).toBe(5);
      expect(step.url).toContain('/tennis-league/functions/results/results_cards/result_card_39.php');
      expect(step.url).toContain('fixture_id=127');
      expect(step.url).toContain('WebsiteTimeZone=Europe/London');
      expect(step.url).toContain('database=ludus3_tl_calderdale');
      expect(step.url).toContain('commonDatabase=ludus3_tennis_common');
      expect(step.url).toContain('refreshProtectionCode=0');
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

  it('player rankings step carries group, seasonId, and the form body for the sample modeID', () => {
    const step = buildPlayerRankingsStep('Summer 2026', 7, 'Mens', 8);
    expect(step.kind).toBe('player-rankings-post');
    if (step.kind === 'player-rankings-post') {
      expect(step.url).toContain('index.php?navButtonSelect=Summer%202026&tabIndex=4');
      expect(step.postBody).toBe('season_subNav_mode=league&season_subNav_subMode=division&season_subNav_my_division=8&refreshProtectionCode=0');
      expect(step.group).toBe('Mens');
      expect(step.seasonId).toBe(7);
    }
  });
});
