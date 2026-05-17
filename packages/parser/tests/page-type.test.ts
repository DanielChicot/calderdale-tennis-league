import { describe, it, expect } from 'vitest';
import { detectPageType } from '../src/page-type.js';

describe('detectPageType', () => {
  it('detects clubs directory by query params', () => {
    const url = 'https://www.calderdale.tennis-league.org/?navButtonSelect=Directory&directory_mode=Clubs/Teams&directory_stage=:View%20List';
    expect(detectPageType(url)).toBe('clubs-directory');
  });

  it('detects league table from tabIndex=0 on a season page', () => {
    const url = 'https://www.calderdale.tennis-league.org/?navButtonSelect=Summer%202026&tabIndex=0';
    expect(detectPageType(url)).toBe('league-table');
  });

  it('detects player rankings from tabIndex=4 on a season page', () => {
    const url = 'https://www.calderdale.tennis-league.org/?navButtonSelect=Summer%202026&tabIndex=4';
    expect(detectPageType(url)).toBe('player-rankings');
  });

  it('throws for unknown URLs', () => {
    expect(() => detectPageType('https://www.calderdale.tennis-league.org/?random=true')).toThrow();
  });
});
