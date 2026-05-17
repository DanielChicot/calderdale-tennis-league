import { describe, it, expect } from 'vitest';
import { slugify, parseIntStrict, parseScore } from '../src/helpers.js';

describe('slugify', () => {
  it('lowercases and dashes spaces', () => {
    expect(slugify('Halifax Queens')).toBe('halifax-queens');
  });
  it('strips punctuation', () => {
    expect(slugify("Cragg Vale (1st team)")).toBe('cragg-vale-1st-team');
  });
  it('collapses repeated dashes', () => {
    expect(slugify('A  --  B')).toBe('a-b');
  });
});

describe('parseIntStrict', () => {
  it('parses pure integer', () => {
    expect(parseIntStrict('42')).toBe(42);
  });
  it('throws on non-integer', () => {
    expect(() => parseIntStrict('4.2')).toThrow();
    expect(() => parseIntStrict('abc')).toThrow();
    expect(() => parseIntStrict('')).toThrow();
  });
});

describe('parseScore', () => {
  it('parses "6-3" as { home: 6, away: 3 }', () => {
    expect(parseScore('6-3')).toEqual({ home: 6, away: 3 });
  });
  it('throws on malformed', () => {
    expect(() => parseScore('6:3')).toThrow();
  });
});
