const USER_AGENT =
  'CalderdaleLeagueMirror/0.2 (contact: dan.chicot@gmail.com; non-affiliated personal mirror)';

type FetchLike = typeof fetch;

export type FetchHtmlOptions = {
  fetch?: FetchLike;
  headers?: Record<string, string>;
};

export const fetchHtml = async (url: string, options: FetchHtmlOptions = {}): Promise<string> => {
  const f = options.fetch ?? fetch;
  const res = await f(url, {
    headers: { 'User-Agent': USER_AGENT, ...(options.headers ?? {}) },
    redirect: 'follow',
  });
  if (res.status !== 200) {
    throw new Error(`fetchHtml: ${res.status} for ${url}`);
  }
  return res.text();
};
