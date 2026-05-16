import { fetch as undiciFetch } from 'undici';

const USER_AGENT =
  'CalderdaleLeagueMirror/0.1 (contact: dan.chicot@gmail.com; non-affiliated personal mirror)';

type FetchLike = (url: string | URL, init?: RequestInit) => Promise<{
  status: number;
  text(): Promise<string>;
  headers: Headers;
}>;

export type FetchHtmlOptions = {
  fetch?: FetchLike;
  /**
   * Additional request headers, merged on top of the default polite User-Agent.
   * Passing a 'User-Agent' here overrides the default.
   */
  headers?: Record<string, string>;
};

export const fetchHtml = async (url: string, options: FetchHtmlOptions = {}): Promise<string> => {
  const f = options.fetch ?? undiciFetch;
  const res = await f(url, {
    headers: { 'User-Agent': USER_AGENT, ...(options.headers ?? {}) },
    redirect: 'follow',
  });
  const body = await res.text();
  if (res.status !== 200) {
    const snippet = body.slice(0, 200).replace(/\s+/g, ' ').trim();
    throw new Error(`fetchHtml: ${res.status} for ${url} — ${snippet}`);
  }
  return body;
};
