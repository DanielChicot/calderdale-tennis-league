import { describe, it, expect, vi } from 'vitest';
import { createScrapeHttpClient } from '../src/http-client.js';

const makeResponse = (init: { status: number; body?: string; lastModified?: string }) => ({
  status: init.status,
  text: async () => init.body ?? '',
  headers: new Headers(init.lastModified ? { 'last-modified': init.lastModified } : undefined),
});

describe('createScrapeHttpClient', () => {
  it('returns changed on first fetch', async () => {
    const fakeFetch = vi.fn(async () => makeResponse({ status: 200, body: '<html/>', lastModified: 'Mon' }));
    const client = createScrapeHttpClient({ fetch: fakeFetch as any, rateLimitMs: 0 });
    const r = await client.fetchPage('https://example.test/page');
    expect(r.kind).toBe('changed');
    if (r.kind === 'changed') {
      expect(r.html).toBe('<html/>');
      expect(r.lastModified).toBe('Mon');
      expect(r.contentHash).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it('sends If-Modified-Since when prior.lastModified provided', async () => {
    const fakeFetch = vi.fn(async () => makeResponse({ status: 304 }));
    const client = createScrapeHttpClient({ fetch: fakeFetch as any, rateLimitMs: 0 });
    await client.fetchPage('https://example.test/page', { lastModified: 'Mon, 01 Jan 2026 00:00:00 GMT' });
    const calls = fakeFetch.mock.calls as unknown[][];
    const init = calls[0]?.[1] as RequestInit;
    expect(new Headers(init.headers).get('If-Modified-Since')).toBe('Mon, 01 Jan 2026 00:00:00 GMT');
  });

  it('reports unchanged on 304', async () => {
    const fakeFetch = vi.fn(async () => makeResponse({ status: 304 }));
    const client = createScrapeHttpClient({ fetch: fakeFetch as any, rateLimitMs: 0 });
    const r = await client.fetchPage('https://example.test/page', { lastModified: 'Mon' });
    expect(r.kind).toBe('unchanged');
    expect(r.status).toBe(304);
  });

  it('reports unchanged on 200 with matching content hash', async () => {
    const fakeFetch = vi.fn(async () => makeResponse({ status: 200, body: '<same/>' }));
    const client = createScrapeHttpClient({ fetch: fakeFetch as any, rateLimitMs: 0 });
    const first = await client.fetchPage('https://example.test/page');
    expect(first.kind).toBe('changed');
    const hash = first.kind === 'changed' ? first.contentHash : '';
    const second = await client.fetchPage('https://example.test/page', { contentHash: hash });
    expect(second.kind).toBe('unchanged');
  });

  it('retries on 503 then succeeds', async () => {
    const fakeFetch = vi
      .fn()
      .mockResolvedValueOnce(makeResponse({ status: 503 }))
      .mockResolvedValueOnce(makeResponse({ status: 200, body: '<ok/>' }));
    const client = createScrapeHttpClient({
      fetch: fakeFetch as any,
      rateLimitMs: 0,
      maxRetries: 2,
    });
    const r = await client.fetchPage('https://example.test/page');
    expect(r.kind).toBe('changed');
    expect(fakeFetch).toHaveBeenCalledTimes(2);
  });

  it('throws after max retries exhausted', async () => {
    const fakeFetch = vi.fn(async () => makeResponse({ status: 503 }));
    const client = createScrapeHttpClient({
      fetch: fakeFetch as any,
      rateLimitMs: 0,
      maxRetries: 2,
    });
    await expect(client.fetchPage('https://example.test/page')).rejects.toThrow(/503/);
  });

  it('rate-limits subsequent calls', async () => {
    const fakeFetch = vi.fn(async () => makeResponse({ status: 200, body: '<a/>' }));
    let nowVal = 0;
    const now = () => nowVal;
    const client = createScrapeHttpClient({
      fetch: fakeFetch as any,
      rateLimitMs: 1000,
      now,
    });
    const sleeps: number[] = [];
    vi.spyOn(global, 'setTimeout').mockImplementation((cb: any, ms?: number) => {
      const delay = ms ?? 0;
      sleeps.push(delay);
      nowVal += delay;
      cb();
      return 0 as any;
    });
    await client.fetchPage('https://example.test/a');
    await client.fetchPage('https://example.test/b');
    expect(sleeps[sleeps.length - 1]).toBe(1000);
    vi.restoreAllMocks();
  });

  it('sends a polite User-Agent', async () => {
    const fakeFetch = vi.fn(async () => makeResponse({ status: 200, body: '<a/>' }));
    const client = createScrapeHttpClient({ fetch: fakeFetch as any, rateLimitMs: 0 });
    await client.fetchPage('https://example.test/a');
    const calls = fakeFetch.mock.calls as unknown[][];
    const init = calls[0]?.[1] as RequestInit;
    expect(new Headers(init.headers).get('User-Agent')).toMatch(/CalderdaleLeagueMirror/);
  });
});
