// Shared fakes for the Reddit tests: listing JSON, configs and a recording fetch. No network.
import { vi } from 'vitest';
import type { AppConfig } from '../../server/config.ts';

export const SECRET = 'SENTINEL-SECRET-123';
export const CLIENT_ID = 'SENTINEL-ID-456';
export const TOKEN = 'SENTINEL-TOKEN-789';

export interface PostData {
  id: string; title: string; selftext?: string; subreddit?: string; author?: string;
  created_utc?: number; score?: number; num_comments?: number; permalink?: string;
  over_18?: boolean; stickied?: boolean;
}

export const nowSec = (): number => Math.floor(Date.now() / 1000);

export function child(post: PostData): { kind: 't3'; data: Required<PostData> } {
  const subreddit = post.subreddit ?? 'hardwareswap';
  return {
    kind: 't3',
    data: {
      selftext: '',
      subreddit,
      author: 'someone',
      created_utc: nowSec() - 3600,
      score: 1,
      num_comments: 0,
      permalink: `/r/${subreddit}/comments/${post.id}/slug/`,
      over_18: false,
      stickied: false,
      ...post,
    },
  };
}

export function listing(posts: PostData[] = []): unknown {
  return { kind: 'Listing', data: { children: posts.map(child) } };
}

export function config(overrides: Partial<AppConfig['reddit']> & { fixtures?: boolean; fixtureDelayMs?: number } = {}): AppConfig {
  const { fixtures = false, fixtureDelayMs = 0, ...reddit } = overrides;
  return {
    port: null,
    fixtures,
    fixtureDelayMs,
    reddit: { clientId: CLIENT_ID, clientSecret: SECRET, username: 'tester', ...reddit },
    ebay: { clientId: '', clientSecret: '' },
  };
}

export const noKeys = (): AppConfig => config({ clientId: '', clientSecret: '', username: '' });

export function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });
}

export const tokenResponse = (token = TOKEN, expiresIn = 86_400): Response =>
  json({ access_token: token, token_type: 'bearer', expires_in: expiresIn, scope: '*' });

export interface Call {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string;
  at: number;
  signal: AbortSignal | undefined;
}

export type Responder = (call: Call) => Response | Promise<Response>;

/**
 * A fetch that records every call and answers token requests with a token and search requests
 * through `onSearch` (default: an empty listing). Override `onToken` for token failures.
 */
export function fakeFetch(opts: { onSearch?: Responder; onToken?: Responder } = {}): {
  fetch: typeof globalThis.fetch;
  calls: Call[];
  searches: () => Call[];
  tokens: () => Call[];
} {
  const calls: Call[] = [];
  const fetchFn: typeof globalThis.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const headers: Record<string, string> = {};
    new Headers(init?.headers).forEach((value, key) => {
      headers[key] = value;
    });
    const call: Call = {
      url,
      method: init?.method ?? 'GET',
      headers,
      body: typeof init?.body === 'string' ? init.body : '',
      at: Date.now(),
      signal: init?.signal ?? undefined,
    };
    calls.push(call);
    if (url === 'https://www.reddit.com/api/v1/access_token') return (opts.onToken ?? (() => tokenResponse()))(call);
    return (opts.onSearch ?? (() => json(listing())))(call);
  };
  return {
    fetch: fetchFn,
    calls,
    searches: () => calls.filter((c) => c.url.startsWith('https://oauth.reddit.com/')),
    tokens: () => calls.filter((c) => c.url === 'https://www.reddit.com/api/v1/access_token'),
  };
}

/** A response that never comes; rejects like real fetch when the request is aborted. */
export function hang(call: Call): Promise<Response> {
  return new Promise((_, reject) => {
    call.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true });
  });
}

/** Advances fake timers in 50 ms steps until `promise` settles (at most `maxMs`). */
export async function settle<T>(promise: Promise<T>, maxMs = 120_000): Promise<T> {
  let done = false;
  promise.then(
    () => (done = true),
    () => (done = true),
  );
  for (let elapsed = 0; elapsed < maxMs && !done; elapsed += 50) await vi.advanceTimersByTimeAsync(50);
  return promise;
}
