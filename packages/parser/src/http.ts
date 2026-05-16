import { fetch as undiciFetch } from 'undici';

const USER_AGENT =
  'CalderdaleLeagueMirror/0.1 (contact: dan.chicot@gmail.com; non-affiliated personal mirror)';

type FetchLike = (url: string, init?: RequestInit) => Promise<{
  status: number;
  text(): Promise<string>;
  headers: Headers;
}>;

export type FetchHtmlOptions = {
  fetch?: FetchLike;
  headers?: Record<string, string>;
};

export const fetchHtml = async (url: string, options: FetchHtmlOptions = {}): Promise<string> => {
  const f = (options.fetch ?? (undiciFetch as unknown as FetchLike));
  const res = await f(url, {
    headers: { 'User-Agent': USER_AGENT, ...(options.headers ?? {}) },
    redirect: 'follow',
  });
  if (res.status !== 200) {
    throw new Error(`fetchHtml: ${res.status} for ${url}`);
  }
  return res.text();
};
