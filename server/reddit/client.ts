// The signed-in Reddit transport: app-only OAuth token, rate limiter, 401 re-token + retry.
// The client secret and the token stay in this closure: they are never logged or returned.
import type { RedditConfig } from '../config.ts';
import { coolDownReason, REASON, send, signInFailed, statusReason } from './http.ts';
import type { HttpResult, SearchOutcome, Transport } from './http.ts';
import { readListing } from './http.ts';
import { createLimiter } from './limiter.ts';
import type { Limiter } from './limiter.ts';

export const TOKEN_URL = 'https://www.reddit.com/api/v1/access_token';
/** A token is used until this long before it expires. */
export const TOKEN_MARGIN_MS = 60_000;
const DEFAULT_EXPIRES_IN_S = 3600;

/** `<platform>:sellscout:<version> (by /u/<username>)`, or `(local tool)` without a username. */
export function userAgent(version: string, username: string, platform: string = process.platform): string {
  return `${platform}:sellscout:${version} ${username ? `(by /u/${username})` : '(local tool)'}`;
}

export interface RedditClientOptions {
  reddit: RedditConfig;
  version: string;
  fetch: typeof globalThis.fetch;
}

type TokenResult = { ok: true; token: string } | { ok: false; reason: string };

export interface RedditClient extends Transport {
  limiter: Limiter;
}

export function createRedditClient(options: RedditClientOptions): RedditClient {
  const { reddit, version } = options;
  // Late-bound: never capture globalThis.fetch (the fixture-mode guard is installed after imports).
  const fetchFn: typeof globalThis.fetch = (input, init) => options.fetch(input, init);
  const agent = userAgent(version, reddit.username);
  const basic = `Basic ${Buffer.from(`${reddit.clientId}:${reddit.clientSecret}`).toString('base64')}`;
  const limiter = createLimiter();
  const noAbort = new AbortController().signal;

  let cached: { token: string; expiresAt: number } | undefined;
  /** The shared token request, and the signals of every search waiting for it. */
  let pending: { promise: Promise<TokenResult>; waiters: AbortSignal[] } | undefined;

  async function requestToken(waiters: AbortSignal[]): Promise<TokenResult> {
    let startedAt = Date.now();
    const result = await limiter.run(async (): Promise<HttpResult> => {
      // Queued behind the limiter: not sent once every search waiting for it has hit its deadline.
      if (waiters.every((signal) => signal.aborted)) return { ok: false, reason: REASON.deadline };
      startedAt = Date.now();
      return send(
        fetchFn,
        TOKEN_URL,
        {
          method: 'POST',
          headers: {
            Authorization: basic,
            'Content-Type': 'application/x-www-form-urlencoded',
            'User-Agent': agent,
          },
          body: 'grant_type=client_credentials',
        },
        noAbort,
      );
    });
    if (!result.ok) return result;
    const { status, headers, json } = result.response;
    limiter.observe(status, headers);
    if (status < 200 || status > 299) return { ok: false, reason: statusReason(status) };
    const body = typeof json === 'object' && json !== null ? (json as Record<string, unknown>) : {};
    const token = body.access_token;
    if (typeof token !== 'string' || token === '') return { ok: false, reason: REASON.unexpected };
    const expiresIn =
      typeof body.expires_in === 'number' && Number.isFinite(body.expires_in) && body.expires_in > 0
        ? body.expires_in
        : DEFAULT_EXPIRES_IN_S;
    cached = { token, expiresAt: startedAt + expiresIn * 1000 - TOKEN_MARGIN_MS };
    return { ok: true, token };
  }

  /** The cached token while it is fresh; otherwise one token request shared by every waiting search. */
  function getToken(signal: AbortSignal): Promise<TokenResult> {
    if (cached && Date.now() < cached.expiresAt) return Promise.resolve({ ok: true, token: cached.token });
    cached = undefined;
    if (!pending) {
      const waiters: AbortSignal[] = [];
      const promise = requestToken(waiters).finally(() => {
        pending = undefined;
      });
      pending = { promise, waiters };
    }
    pending.waiters.push(signal);
    return pending.promise;
  }

  /** A token for this search, or the outcome that ends it (deadline or sign-in failure). */
  async function tokenFor(signal: AbortSignal): Promise<{ token: string } | SearchOutcome> {
    if (signal.aborted) return { ok: false, reason: REASON.deadline, stop: true };
    const token = await getToken(signal);
    if (signal.aborted) return { ok: false, reason: REASON.deadline, stop: true };
    return token.ok ? { token: token.token } : { ok: false, reason: signInFailed(token.reason), stop: true };
  }

  /** One search request, queued behind the limiter; skipped when aborted or cooling down. */
  function searchOnce(url: string, token: string, signal: AbortSignal): Promise<HttpResult | { skipped: string }> {
    return limiter.run(async () => {
      const left = limiter.coolDownLeftMs();
      if (left > 0) return { skipped: coolDownReason(left) };
      if (signal.aborted) return { skipped: REASON.deadline };
      return send(
        fetchFn,
        url,
        { method: 'GET', headers: { Authorization: `bearer ${token}`, 'User-Agent': agent } },
        signal,
      );
    });
  }

  async function search(url: string, signal: AbortSignal): Promise<SearchOutcome> {
    const left = limiter.coolDownLeftMs();
    if (left > 0) return { ok: false, reason: coolDownReason(left), stop: true };

    let token = await tokenFor(signal);
    if (!('token' in token)) return token;

    let result = await searchOnce(url, token.token, signal);
    if ('skipped' in result) return { ok: false, reason: result.skipped, stop: true };
    if (result.ok && result.response.status === 401) {
      limiter.observe(401, result.response.headers);
      // A 401 drops the cached token, fetches a new one once and retries this request once.
      cached = undefined;
      // The deadline may have passed while the 401 came in: then no new token is asked for.
      token = await tokenFor(signal);
      if (!('token' in token)) return token;
      result = await searchOnce(url, token.token, signal);
      if ('skipped' in result) return { ok: false, reason: result.skipped, stop: true };
    }

    const stop = result.ok ? limiter.observe(result.response.status, result.response.headers) : false;
    const listing = readListing(result);
    if (listing.ok) return { ok: true, children: listing.children, stop };
    // Credentials that are still rejected after the retry will not work for the next request either.
    const rejected = result.ok && result.response.status === 401;
    return { ok: false, reason: listing.reason, stop: stop || rejected };
  }

  return { search, limiter };
}
