// AC7, AC8, AC18: the signed-in client (fetch mocked, fake timers). No network.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createBuyerSearch } from '../../server/reddit/index.ts';
import type { BuyerQuery, BuyerSearchOutput } from '../../server/reddit/index.ts';
import { createRedditClient, userAgent } from '../../server/reddit/client.ts';
import { searchVenues } from '../../server/venues/index.ts';
import { CLIENT_ID, config, fakeFetch, json, listing, SECRET, settle, TOKEN, tokenResponse } from './helpers.ts';

const rtx: BuyerQuery = {
  item: 'RTX 3080 (barely used)',
  windowDays: 30,
  delivery: 'both',
  context: searchVenues({ item: 'RTX 3080 (barely used)', delivery: 'both', window: 30 }).context,
};
const BASIC = `Basic ${Buffer.from(`${CLIENT_ID}:${SECRET}`).toString('base64')}`;

beforeEach(() => {
  vi.useFakeTimers({ now: Date.UTC(2026, 10, 25, 12) });
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('token (AC7)', () => {
  it('asks for an app-only token with Basic auth and grant_type=client_credentials', async () => {
    const fake = fakeFetch();
    const search = createBuyerSearch({ config: config(), version: '1.2.3', fetch: fake.fetch });
    await settle(search(rtx));
    expect(fake.tokens()).toHaveLength(1);
    const [token] = fake.tokens();
    expect(fake.calls[0]).toBe(token);
    expect(token!.method).toBe('POST');
    expect(token!.headers.authorization).toBe(BASIC);
    expect(token!.headers['content-type']).toBe('application/x-www-form-urlencoded');
    expect(token!.body).toBe('grant_type=client_credentials');
  });

  it('reuses the token on a second search', async () => {
    const fake = fakeFetch();
    const search = createBuyerSearch({ config: config(), version: '1.2.3', fetch: fake.fetch });
    await settle(search(rtx));
    await vi.advanceTimersByTimeAsync(60_000);
    await settle(search(rtx));
    expect(fake.tokens()).toHaveLength(1);
    expect(fake.searches().length).toBeGreaterThanOrEqual(4);
  });

  it('fetches a new token 60 s before expires_in', async () => {
    const fake = fakeFetch({ onToken: () => tokenResponse(TOKEN, 3600) });
    const search = createBuyerSearch({ config: config(), version: '1.2.3', fetch: fake.fetch });
    await settle(search(rtx));
    const issued = fake.tokens()[0]!.at;

    await vi.advanceTimersByTimeAsync(issued + 3_530_000 - Date.now());
    await settle(search(rtx));
    expect(fake.tokens()).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(issued + 3_540_000 - Date.now());
    await settle(search(rtx));
    expect(fake.tokens()).toHaveLength(2);
  });

  it('a 401 on a search drops the token, fetches a new one once and retries once', async () => {
    let tokenCount = 0;
    let first = true;
    const fake = fakeFetch({
      onToken: () => tokenResponse(`${TOKEN}-${++tokenCount}`),
      onSearch: () => {
        if (first) {
          first = false;
          return new Response('', { status: 401 });
        }
        return json(listing([{ id: 'p1', title: 'WTB RTX 3080' }]));
      },
    });
    const search = createBuyerSearch({ config: config(), version: '1.2.3', fetch: fake.fetch });
    const out = await settle(search(rtx));
    expect(out.buyers.status).toBe('ok');
    expect(out.notices).toEqual([]);
    expect(fake.tokens()).toHaveLength(2);
    const [s1, retry] = fake.searches();
    expect(retry!.url).toBe(s1!.url);
    expect(s1!.headers.authorization).toBe(`bearer ${TOKEN}-1`);
    expect(retry!.headers.authorization).toBe(`bearer ${TOKEN}-2`);
    expect(fake.searches()).toHaveLength(rtx.context.subreddits.length + 2);
  });

  it('a second 401 gives "Reddit rejected the app credentials (HTTP 401)"', async () => {
    const fake = fakeFetch({ onSearch: () => new Response('', { status: 401 }) });
    const search = createBuyerSearch({ config: config(), version: '1.2.3', fetch: fake.fetch });
    const out = await settle(search(rtx));
    expect(out.buyers).toMatchObject({ status: 'unavailable', reason: 'Reddit rejected the app credentials (HTTP 401)' });
    expect(fake.tokens()).toHaveLength(2);
    expect(fake.searches()).toHaveLength(2);
  });

  it.each([
    ['a 401', () => new Response('', { status: 401 }), 'Reddit sign-in failed (Reddit rejected the app credentials (HTTP 401))'],
    ['a 403', () => new Response('<html>', { status: 403 }), 'Reddit sign-in failed (Reddit blocked the request (HTTP 403))'],
    ['a 503', () => new Response('', { status: 503 }), 'Reddit sign-in failed (Reddit returned HTTP 503)'],
    ['no access_token', () => json({ error: 'invalid_grant' }), 'Reddit sign-in failed (Unexpected response from Reddit)'],
    ['HTML', () => new Response('<html></html>', { status: 200 }), 'Reddit sign-in failed (Unexpected response from Reddit)'],
    [
      'a network error',
      () => Promise.reject(new TypeError('fetch failed')),
      "Reddit sign-in failed (Couldn't reach Reddit)",
    ],
  ])('token failure (%s) -> unavailable, no search request', async (_name, onToken, reason) => {
    const fake = fakeFetch({ onToken });
    const search = createBuyerSearch({ config: config(), version: '1.2.3', fetch: fake.fetch });
    const out = await settle(search(rtx));
    expect(out.buyers).toMatchObject({ status: 'unavailable', reason, posts: [] });
    expect(out.buyers.links.length).toBeGreaterThan(0);
    expect(fake.searches()).toHaveLength(0);
  });

  it('a token request that never answers gives the timeout reason after 10 s', async () => {
    const fake = fakeFetch({ onToken: () => new Promise<Response>(() => undefined) });
    const search = createBuyerSearch({ config: config(), version: '1.2.3', fetch: fake.fetch });
    const started = Date.now();
    const out = await settle(search(rtx));
    expect(out.buyers.reason).toBe('Reddit sign-in failed (Reddit did not answer within 10 s)');
    expect(Date.now() - started).toBeLessThan(11_000);
  });
});

describe('a shared token request and the deadline', () => {
  const URL_A = 'https://oauth.reddit.com/search?q=a';

  /** A client whose token has expired and whose limiter has just been used. */
  async function primedClient(fake: ReturnType<typeof fakeFetch>) {
    const client = createRedditClient({ reddit: config().reddit, version: '1.2.3', fetch: fake.fetch });
    await settle(client.search(URL_A, new AbortController().signal));
    await vi.advanceTimersByTimeAsync(2_000); // past expiresAt (61 s - 60 s margin)
    return client;
  }

  it('is not sent when every search waiting for it has hit its deadline', async () => {
    const fake = fakeFetch({ onToken: () => tokenResponse(TOKEN, 61) });
    const client = await primedClient(fake);
    const sent = fake.calls.length;
    const a = new AbortController();
    const b = new AbortController();
    const pending = Promise.all([client.search(URL_A, a.signal), client.search(URL_A, b.signal)]);
    a.abort();
    b.abort();
    const outcomes = await settle(pending);
    expect(outcomes.map((o) => o.ok)).toEqual([false, false]);
    expect(outcomes.map((o) => (o.ok ? '' : o.reason))).toEqual([
      'Reddit did not answer within 25 s',
      'Reddit did not answer within 25 s',
    ]);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(fake.calls.length).toBe(sent);
  });

  it('is still sent for a search that is still running', async () => {
    const fake = fakeFetch({ onToken: () => tokenResponse(TOKEN, 61) });
    const client = await primedClient(fake);
    const a = new AbortController();
    const b = new AbortController();
    const pending = Promise.all([client.search(URL_A, a.signal), client.search(URL_A, b.signal)]);
    a.abort();
    const [outA, outB] = await settle(pending);
    expect(outA!.ok).toBe(false);
    expect(outB!.ok).toBe(true);
    expect(fake.tokens()).toHaveLength(2);
  });

  it('no search starts once its signal has aborted', async () => {
    const fake = fakeFetch();
    const client = createRedditClient({ reddit: config().reddit, version: '1.2.3', fetch: fake.fetch });
    const a = new AbortController();
    a.abort();
    const out = await settle(client.search(URL_A, a.signal));
    expect(out).toEqual({ ok: false, reason: 'Reddit did not answer within 25 s', stop: true });
    expect(fake.calls).toHaveLength(0);
  });
});

describe('search requests (AC7)', () => {
  it('"RTX 3080" searches site-wide and r/hardwareswap on oauth.reddit.com with the bearer token', async () => {
    expect(rtx.context.subreddits[0]).toBe('hardwareswap');
    const fake = fakeFetch();
    const search = createBuyerSearch({ config: config(), version: '1.2.3', fetch: fake.fetch });
    await settle(search(rtx));
    const searches = fake.searches();
    expect(searches.length).toBe(1 + rtx.context.subreddits.length);
    const urls = searches.map((c) => new URL(c.url));
    expect(urls[0]!.href.startsWith('https://oauth.reddit.com/search?')).toBe(true);
    expect(urls[0]!.searchParams.get('q')).toBe('(WTB OR ISO OR "looking for") RTX 3080');
    expect(urls[1]!.pathname).toBe('/r/hardwareswap/search');
    expect(urls[1]!.searchParams.get('q')).toBe('RTX 3080');
    expect(urls[1]!.searchParams.get('restrict_sr')).toBe('1');
    for (const [i, url] of urls.entries()) {
      expect(url.origin).toBe('https://oauth.reddit.com');
      expect(url.searchParams.get('sort')).toBe('new');
      expect(url.searchParams.get('t')).toBe('month');
      expect(url.searchParams.get('limit')).toBe('100');
      expect(url.searchParams.get('type')).toBe('link');
      expect(url.searchParams.get('raw_json')).toBe('1');
      expect(decodeURIComponent(url.search)).not.toContain('[');
      expect(searches[i]!.method).toBe('GET');
      expect(searches[i]!.headers.authorization).toBe(`bearer ${TOKEN}`);
    }
  });

  it.each([
    [7, 'week'],
    [30, 'month'],
    [90, 'year'],
  ] as const)('window %d -> t=%s', async (windowDays, t) => {
    const fake = fakeFetch();
    const search = createBuyerSearch({ config: config(), version: '1.2.3', fetch: fake.fetch });
    await settle(search({ ...rtx, windowDays }));
    for (const call of fake.searches()) expect(new URL(call.url).searchParams.get('t')).toBe(t);
  });

  it('makes at most 4 search requests', async () => {
    const fake = fakeFetch();
    const search = createBuyerSearch({ config: config(), version: '1.2.3', fetch: fake.fetch });
    await settle(search({ ...rtx, context: { subreddits: ['a1', 'b2', 'c3', 'd4', 'e5'] } }));
    expect(fake.searches()).toHaveLength(4);
    expect(fake.searches().map((c) => new URL(c.url).pathname)).toEqual([
      '/search',
      '/r/a1/search',
      '/r/b2/search',
      '/r/c3/search',
    ]);
  });

  it('returns the buyer posts of every request, deduplicated, newest first', async () => {
    const now = Math.floor(Date.now() / 1000);
    const fake = fakeFetch({
      onSearch: (call) =>
        new URL(call.url).pathname === '/search'
          ? json(listing([
              { id: 'a', title: 'WTB RTX 3080', created_utc: now - 300 },
              { id: 'seller', title: '[USA-CA] [H] RTX 3080 [W] PayPal', created_utc: now - 100 },
            ]))
          : json(listing([
              { id: 'a', title: 'WTB RTX 3080', created_utc: now - 300 },
              { id: 'b', title: '[USA-CA] [H] PayPal [W] RTX 3080', created_utc: now - 200 },
            ])),
    });
    const search = createBuyerSearch({ config: config(), version: '1.2.3', fetch: fake.fetch });
    const out = await settle(search(rtx));
    expect(out.buyers).toMatchObject({ status: 'ok', term: 'RTX 3080', windowDays: 30 });
    expect(out.buyers.reason).toBeUndefined();
    expect(out.buyers.posts.map((p) => p.id)).toEqual(['b', 'a']);
  });
});

describe('User-Agent (AC8)', () => {
  it('names the Reddit user when REDDIT_USERNAME is set', async () => {
    const fake = fakeFetch();
    const search = createBuyerSearch({ config: config({ username: 'tester' }), version: '1.2.3', fetch: fake.fetch });
    await settle(search(rtx));
    for (const call of fake.calls) {
      expect(call.headers['user-agent']).toBe(`${process.platform}:sellscout:1.2.3 (by /u/tester)`);
    }
  });

  it('says "(local tool)" without a username', async () => {
    const fake = fakeFetch();
    const search = createBuyerSearch({ config: config({ username: '' }), version: '1.2.3', fetch: fake.fetch });
    await settle(search(rtx));
    for (const call of fake.calls) {
      expect(call.headers['user-agent']).toBe(`${process.platform}:sellscout:1.2.3 (local tool)`);
    }
  });

  it('formats the platform, version and username', () => {
    expect(userAgent('0.1.0', 'someone', 'linux')).toBe('linux:sellscout:0.1.0 (by /u/someone)');
    expect(userAgent('0.1.0', '', 'win32')).toBe('win32:sellscout:0.1.0 (local tool)');
  });
});

describe('secrets stay out of results and logs (AC18)', () => {
  const sentinels = [SECRET, CLIENT_ID, TOKEN, Buffer.from(`${CLIENT_ID}:${SECRET}`).toString('base64')];

  function captureConsole(): unknown[] {
    const logged: unknown[] = [];
    for (const method of ['log', 'info', 'warn', 'error', 'debug', 'trace'] as const) {
      vi.spyOn(console, method).mockImplementation((...args: unknown[]) => {
        logged.push(...args);
      });
    }
    return logged;
  }

  function expectClean(out: BuyerSearchOutput, logged: unknown[]): void {
    const texts = [JSON.stringify(out), out.notices.join('\n'), logged.map(String).join('\n')];
    for (const text of texts) for (const sentinel of sentinels) expect(text).not.toContain(sentinel);
  }

  it.each([
    ['success', {}],
    ['token failure', { onToken: () => new Response('', { status: 401 }) }],
    ['token network error', { onToken: () => Promise.reject(new TypeError(`fetch failed ${SECRET}`)) }],
    ['search failure', { onSearch: () => new Response(`<html>${TOKEN}</html>`, { status: 500 }) }],
    ['search network error', { onSearch: () => Promise.reject(new Error(`bearer ${TOKEN}`)) }],
    ['search 401', { onSearch: () => new Response('', { status: 401 }) }],
  ] as const)('%s', async (_name, handlers) => {
    const logged = captureConsole();
    const fake = fakeFetch(handlers);
    const search = createBuyerSearch({ config: config(), version: '1.2.3', fetch: fake.fetch });
    const out = await settle(search(rtx));
    expectClean(out, logged);
    expect(logged).toEqual([]);
  });
});
