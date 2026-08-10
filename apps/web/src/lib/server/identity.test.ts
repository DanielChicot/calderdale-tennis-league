import { describe, it, expect } from 'vitest';
import { parseMeCookie, serializeMeCookie } from './identity';

describe('identity cookie', () => {
  it('round-trips a single identity', () => {
    const raw = serializeMeCookie([{ slug: 'jo-bloggs', name: 'Jo Bloggs' }]);
    expect(parseMeCookie(raw)).toEqual([{ slug: 'jo-bloggs', name: 'Jo Bloggs' }]);
  });

  it('returns [] for undefined, empty, non-JSON, and wrong-shape input', () => {
    expect(parseMeCookie(undefined)).toEqual([]);
    expect(parseMeCookie('')).toEqual([]);
    expect(parseMeCookie('not json')).toEqual([]);
    expect(parseMeCookie('{"players":"nope"}')).toEqual([]);
    expect(parseMeCookie('[]')).toEqual([]);
    expect(parseMeCookie('{"players":[{"slug":1}]}')).toEqual([]);
  });

  it('keeps only well-formed entries', () => {
    const raw = '{"players":[{"slug":"a","name":"A"},{"bad":true}]}';
    expect(parseMeCookie(raw)).toEqual([{ slug: 'a', name: 'A' }]);
  });
});
