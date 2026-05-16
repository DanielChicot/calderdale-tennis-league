import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fetchHtml } from '../src/http.js';

describe('fetchHtml', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('returns body text on 200', async () => {
    const fakeFetch = vi.fn().mockResolvedValue({
      status: 200,
      text: async () => '<html>ok</html>',
      headers: new Headers(),
    });
    const html = await fetchHtml('https://example.test/page', { fetch: fakeFetch });
    expect(html).toBe('<html>ok</html>');
  });

  it('throws with status and url on non-200', async () => {
    const fakeFetch = vi.fn().mockResolvedValue({
      status: 503,
      text: async () => 'oops',
      headers: new Headers(),
    });
    await expect(fetchHtml('https://example.test/page', { fetch: fakeFetch })).rejects.toThrow(
      /503.*example\.test\/page/,
    );
  });

  it('sends a polite User-Agent', async () => {
    const fakeFetch = vi.fn().mockResolvedValue({
      status: 200,
      text: async () => '<html />',
      headers: new Headers(),
    });
    await fetchHtml('https://example.test/page', { fetch: fakeFetch });
    const init = fakeFetch.mock.calls[0]?.[1] as RequestInit;
    const headers = new Headers(init.headers);
    expect(headers.get('User-Agent')).toMatch(/CalderdaleLeagueMirror/);
  });
});
