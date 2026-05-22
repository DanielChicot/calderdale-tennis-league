import { describe, it, expect } from 'vitest';
import { parseArgs } from '../src/index.js';

describe('parseArgs', () => {
  it('defaults to current mode with no args', () => {
    expect(parseArgs([])).toEqual({ mode: 'current' });
  });

  it('parses --season=summer-2024', () => {
    expect(parseArgs(['--season=summer-2024'])).toEqual({
      mode: 'season',
      seasonSlug: 'summer-2024',
    });
  });

  it('parses --backfill', () => {
    expect(parseArgs(['--backfill'])).toEqual({ mode: 'backfill' });
  });

  it('throws when --season is passed without a value', () => {
    expect(() => parseArgs(['--season'])).toThrow(
      '--season requires a value, e.g. --season=summer-2024',
    );
  });

  it('throws on unknown flag', () => {
    expect(() => parseArgs(['--unknown'])).toThrow('Unknown argument: --unknown');
  });
});
