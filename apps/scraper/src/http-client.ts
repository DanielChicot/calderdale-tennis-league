import { createHash } from 'node:crypto';

// Capture the real setTimeout before any test mock can replace global.setTimeout.
// This ensures the AbortController timeout uses the native timer and is not
// intercepted by vi.spyOn(global, 'setTimeout') in the rate-limit test.
const nativeSetTimeout = setTimeout;
const nativeClearTimeout = clearTimeout;

const USER_AGENT_DEFAULT =
  'CalderdaleLeagueMirror/0.2 (contact: dan.chicot@gmail.com; non-affiliated personal mirror)';

type FetchLike = typeof fetch;

export type PriorFetch = {
  lastModified?: string;
  contentHash?: string;
};

export type FetchResult =
  | { kind: 'changed'; status: number; html: string; lastModified?: string; contentHash: string }
  | { kind: 'unchanged'; status: number; contentHash?: string };

export type ScrapeHttpOptions = {
  userAgent?: string;
  rateLimitMs?: number;
  requestTimeoutMs?: number;
  maxRetries?: number;
  fetch?: FetchLike;
  now?: () => number;
};

export type ScrapeHttpClient = {
  fetchPage: (url: string, prior?: PriorFetch) => Promise<FetchResult>;
};

const sha256 = (s: string): string => createHash('sha256').update(s).digest('hex');

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

const RETRIABLE_STATUSES = new Set([502, 503, 504]);
const BACKOFF_MS = [2_000, 4_000, 8_000];

export const createScrapeHttpClient = (options: ScrapeHttpOptions = {}): ScrapeHttpClient => {
  const userAgent = options.userAgent ?? USER_AGENT_DEFAULT;
  const rateLimitMs = options.rateLimitMs ?? 1_000;
  const requestTimeoutMs = options.requestTimeoutMs ?? 30_000;
  const maxRetries = options.maxRetries ?? 3;
  const f = options.fetch ?? fetch;
  const now = options.now ?? (() => Date.now());

  let lastFetchAt = 0;

  const respectRateLimit = async () => {
    const elapsed = now() - lastFetchAt;
    if (elapsed < rateLimitMs) {
      await sleep(rateLimitMs - elapsed);
    }
    lastFetchAt = now();
  };

  const requestOnce = async (
    url: string,
    headers: Record<string, string>,
  ): Promise<{ status: number; html: string; headers: Headers }> => {
    const controller = new AbortController();
    const timeout = nativeSetTimeout(() => controller.abort(), requestTimeoutMs);
    try {
      const res = await f(url, { headers, redirect: 'follow', signal: controller.signal });
      const text = await res.text();
      return { status: res.status, html: text, headers: res.headers };
    } finally {
      nativeClearTimeout(timeout);
    }
  };

  const fetchWithRetries = async (url: string, headers: Record<string, string>) => {
    let attempt = 0;
    let lastErr: unknown;
    while (attempt <= maxRetries) {
      await respectRateLimit();
      try {
        const result = await requestOnce(url, headers);
        if (RETRIABLE_STATUSES.has(result.status) && attempt < maxRetries) {
          await sleep(BACKOFF_MS[attempt] ?? BACKOFF_MS[BACKOFF_MS.length - 1]!);
          attempt++;
          continue;
        }
        if (result.status >= 400 && result.status !== 304) {
          throw new Error(`fetchPage: ${result.status} for ${url}`);
        }
        return result;
      } catch (err) {
        lastErr = err;
        if (attempt >= maxRetries) throw err;
        await sleep(BACKOFF_MS[attempt] ?? BACKOFF_MS[BACKOFF_MS.length - 1]!);
        attempt++;
      }
    }
    throw lastErr ?? new Error('fetchWithRetries: unreachable');
  };

  const fetchPage = async (url: string, prior?: PriorFetch): Promise<FetchResult> => {
    const headers: Record<string, string> = { 'User-Agent': userAgent };
    if (prior?.lastModified) headers['If-Modified-Since'] = prior.lastModified;

    const { status, html, headers: responseHeaders } = await fetchWithRetries(url, headers);

    if (status === 304) {
      return { kind: 'unchanged', status };
    }

    const contentHash = sha256(html);
    if (prior?.contentHash && prior.contentHash === contentHash) {
      return { kind: 'unchanged', status, contentHash };
    }

    const lastModified = responseHeaders.get('last-modified');
    return {
      kind: 'changed',
      status,
      html,
      ...(lastModified !== null ? { lastModified } : {}),
      contentHash,
    };
  };

  return { fetchPage };
};
