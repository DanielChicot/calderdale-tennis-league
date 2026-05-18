import { describe, it, expect } from 'vitest';
import {
  detectPageType,
  detectShellPageType,
  detectFragmentType,
} from '../src/page-type.js';

describe('detectShellPageType', () => {
  it('detects clubs directory', () => {
    const url = 'https://www.calderdale.tennis-league.org/?navButtonSelect=Directory&directory_mode=Clubs/Teams&directory_stage=:View%20List';
    expect(detectShellPageType(url)).toBe('clubs-directory');
  });

  it('detects league table from tabIndex=0', () => {
    expect(detectShellPageType('https://www.calderdale.tennis-league.org/?navButtonSelect=Summer%202026&tabIndex=0')).toBe('league-table');
  });

  it('detects player rankings from tabIndex=4', () => {
    expect(detectShellPageType('https://www.calderdale.tennis-league.org/?navButtonSelect=Summer%202026&tabIndex=4')).toBe('player-rankings');
  });

  it('detects season nav from a bare home URL', () => {
    expect(detectShellPageType('https://www.calderdale.tennis-league.org/')).toBe('season-nav');
  });

  it('throws for unknown shell URLs', () => {
    expect(() => detectShellPageType('https://www.calderdale.tennis-league.org/?random=true')).toThrow();
  });
});

describe('detectFragmentType', () => {
  it('detects displayResults', () => {
    expect(detectFragmentType('https://www.ludus-online.com/displayResults.php?modeID=3&seasonID=20')).toBe('fixtures-and-results');
  });

  it('detects displayContacts', () => {
    expect(detectFragmentType('https://www.ludus-online.com/displayContacts.php?team_id=42')).toBe('club-contacts');
  });

  it('detects displayLocations', () => {
    expect(detectFragmentType('https://www.ludus-online.com/displayLocations.php?Mode=html&club_id=42')).toBe('club-location');
  });

  it('detects result_card', () => {
    expect(detectFragmentType('https://www.ludus-online.com/result_card_3.php?fixture_id=999')).toBe('match-card');
  });

  it('throws for unknown fragment URLs', () => {
    expect(() => detectFragmentType('https://www.ludus-online.com/random.php')).toThrow();
  });
});

describe('detectPageType (dispatcher)', () => {
  it('routes shell URLs to detectShellPageType', () => {
    expect(detectPageType('https://www.calderdale.tennis-league.org/?navButtonSelect=Summer%202026&tabIndex=0')).toBe('league-table');
  });

  it('routes ludus-online URLs to detectFragmentType', () => {
    expect(detectPageType('https://www.ludus-online.com/displayResults.php?modeID=3&seasonID=20')).toBe('fixtures-and-results');
  });
});
