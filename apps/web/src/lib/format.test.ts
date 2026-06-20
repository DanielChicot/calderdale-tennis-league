import { describe, it, expect } from 'vitest';
import { formatDate, formatScore, groupByDivisionGroup } from './format.js';

describe('formatDate', () => {
  it('formats an ISO date as a UK day-month-year string', () => {
    expect(formatDate('2026-04-23')).toBe('Thu 23 Apr 2026');
  });
  it('returns the input unchanged when not a date', () => {
    expect(formatDate('not-a-date')).toBe('not-a-date');
  });
});

describe('formatScore', () => {
  it('pads to 2 decimal places', () => {
    expect(formatScore('509.7')).toBe('509.70');
    expect(formatScore('537.26')).toBe('537.26');
    expect(formatScore('48')).toBe('48.00');
  });
  it('returns the input unchanged when not a number', () => {
    expect(formatScore('n/a')).toBe('n/a');
  });
});

describe('groupByDivisionGroup', () => {
  it('groups in Mens, Ladies, Mixed order and drops empty groups', () => {
    const result = groupByDivisionGroup([
      { group: 'Mixed', slug: 'mx1' },
      { group: 'Mens', slug: 'm1' },
      { group: 'Mens', slug: 'm2' },
    ]);
    expect(result.map((g) => g.group)).toEqual(['Mens', 'Mixed']);
    expect(result[0]?.items.map((i) => i.slug)).toEqual(['m1', 'm2']);
  });
});
