import { describe, it, expect } from 'vitest';
import { slugify, parseIntStrict, parseScore, parseDecimalStrict, parseFraction } from '../src/helpers.js';

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

describe('parseDecimalStrict', () => {
  it('parses integers', () => {
    expect(parseDecimalStrict('42')).toBe(42);
    expect(parseDecimalStrict('0')).toBe(0);
  });
  it('parses half-points', () => {
    expect(parseDecimalStrict('2.5')).toBe(2.5);
    expect(parseDecimalStrict('33.5')).toBe(33.5);
  });
  it('parses negatives', () => {
    expect(parseDecimalStrict('-5')).toBe(-5);
  });
  it('throws on non-decimal', () => {
    expect(() => parseDecimalStrict('abc')).toThrow();
    expect(() => parseDecimalStrict('1.2.3')).toThrow();
    expect(() => parseDecimalStrict('1e10')).toThrow();
    expect(() => parseDecimalStrict('')).toThrow();
  });
});

describe('parseFraction', () => {
  it('parses simple fractions', () => {
    expect(parseFraction('4/18')).toEqual({ num: 4, denom: 18 });
    expect(parseFraction('0/1')).toEqual({ num: 0, denom: 1 });
  });
  it('tolerates whitespace around slash', () => {
    expect(parseFraction('4 / 18')).toEqual({ num: 4, denom: 18 });
  });
  it('throws on malformed', () => {
    expect(() => parseFraction('4-18')).toThrow();
    expect(() => parseFraction('4/')).toThrow();
    expect(() => parseFraction('')).toThrow();
  });
});
