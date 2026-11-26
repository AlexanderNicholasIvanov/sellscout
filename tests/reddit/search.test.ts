// AC6, AC10, AC11, AC15: disabled, failures, the 25 s deadline, location never sent.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createBuyerSearch, NOTICE_DEADLINE, NOTICE_PARTIAL } from '../../server/reddit/index.ts';
import type { BuyerQuery } from '../../server/reddit/index.ts';
import { createSearchService } from '../../server/search.ts';
import { searchVenues } from '../../server/venues/index.ts';
import { disabledEbay } from '../ebay/helpers.ts';
import { config, fakeFetch, hang, json, listing, noKeys, settle } from './helpers.ts';
import type { Responder } from './helpers.ts';

const query: BuyerQuery = {
  item: 'RTX 3080',
  windowDays: 30,
  delivery: 'both',
  context: { subreddits: ['hardwareswap', 'homelabsales'], craigslist: 'seattle' },
};

beforeEach(() => {
  vi.useFakeTimers({ now: Date.UTC(2026, 10, 25, 12) });
});
afterEach(() => {
  vi.useRealTimers();
});

describe('disabled (AC6)', () => {
  it.each([
    ['no keys', noKeys()],
    ['only the client id', config({ clientSecret: '' })],
    ['only the secret', config({ clientId: '' })],
  ])('%s -> disabled, no request, links present', async (_name, cfg) => {
    const fetchSpy = vi.fn<typeof globalThis.fetch>();
    const search = createBuyerSearch({ config: cfg, version: '1.2.3', fetch: fetchSpy });
    const out = await search(query);
    expect(out).toEqual({
      buyers: {
        status: 'disabled',
        term: 'RTX 3080',
        windowDays: 30,
        posts: [],
        links: [
          expect.objectContaining({ label: 'Search Reddit for buyers' }),
          expect.objectContaining({ label: 'Search r/hardwareswap' }),
          expect.objectContaining({ label: 'Search r/homelabsales' }),
          { label: "Craigslist 'wanted' posts", url: 'https://seattle.craigslist.org/search/waa?query=RTX%203080' },
        ],
      },
      notices: [],
    });
    expect('reason' in out.buyers).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('failures (AC10)', () => {
  const service = (onSearch: Responder) => {
    const fake = fakeFetch({ onSearch });
    const buyers = createBuyerSearch({ config: config(), version: '1.2.3', fetch: fake.fetch });
    return { fake, search: createSearchService({ venues: searchVenues, buyers, ebay: disabledEbay() }) };
  };

  it.each([
    ['403', () => new Response('<html>blocked</html>', { status: 403, headers: { 'Content-Type': 'text/html' } }), 'Reddit blocked the request (HTTP 403)'],
    ['429', () => new Response('', { status: 429 }), 'Reddit rate limit reached (HTTP 429)'],
    ['500', () => new Response('oops', { status: 500 }), 'Reddit returned HTTP 500'],
    ['502 JSON', () => json({ error: 'bad gateway' }, 502), 'Reddit returned HTTP 502'],
    ['a network error', () => Promise.reject(new TypeError('fetch failed')), "Couldn't reach Reddit"],
    ['an HTML body', () => new Response('<!doctype html><html></html>', { status: 200 }), 'Unexpected response from Reddit'],
    ['JSON without data.children', () => json({ kind: 'Listing', data: {} }), 'Unexpected response from Reddit'],
    ['JSON that is an array', () => json([]), 'Unexpected response from Reddit'],
    ['children that is not an array', () => json({ data: { children: {} } }), 'Unexpected response from Reddit'],
  ] as const)('%s -> unavailable with its reason; venues still returned', async (_name, onSearch, reason) => {
    const { search } = service(onSearch);
    const result = await settle(search({ item: 'RTX 3080', delivery: 'both', window: 30 }));
    expect(result.buyers).toMatchObject({ status: 'unavailable', reason, term: 'RTX 3080', posts: [] });
    expect(result.buyers.links.length).toBeGreaterThan(0);
    expect(result.venues.length).toBeGreaterThan(0);
  });

  it('a request that never answers -> "Reddit did not answer within 10 s" after 10 s', async () => {
    const fake = fakeFetch({ onSearch: hang });
    const search = createBuyerSearch({ config: config(), version: '1.2.3', fetch: fake.fetch });
    const out = await settle(search({ ...query, context: { subreddits: [] } }));
    expect(out.buyers).toMatchObject({ status: 'unavailable', reason: 'Reddit did not answer within 10 s' });
    const [call] = fake.searches();
    expect(call!.signal?.aborted).toBe(true);
    expect(Date.now() - call!.at).toBeGreaterThanOrEqual(10_000);
    expect(Date.now() - call!.at).toBeLessThan(10_200);
  });

  it('times out even when fetch ignores the abort signal', async () => {
    const fake = fakeFetch({ onSearch: () => new Promise<Response>(() => undefined) });
    const search = createBuyerSearch({ config: config(), version: '1.2.3', fetch: fake.fetch });
    const out = await settle(search({ ...query, context: { subreddits: [] } }));
    expect(out.buyers.reason).toBe('Reddit did not answer within 10 s');
  });

  it('the first failure gives the reason when every request fails', async () => {
    let n = 0;
    const fake = fakeFetch({ onSearch: () => new Response('', { status: ++n === 1 ? 500 : 403 }) });
    const search = createBuyerSearch({ config: config(), version: '1.2.3', fetch: fake.fetch });
    const out = await settle(search(query));
    expect(out.buyers).toMatchObject({ status: 'unavailable', reason: 'Reddit returned HTTP 500' });
    expect(out.notices).toEqual([]);
  });

  it('one failure among several -> ok + "Some Reddit searches failed" notice', async () => {
    const fake = fakeFetch({
      onSearch: (call) =>
        new URL(call.url).pathname === '/r/homelabsales/search'
          ? new Response('', { status: 500 })
          : json(listing([{ id: 'p1', title: 'WTB RTX 3080' }])),
    });
    const search = createBuyerSearch({ config: config(), version: '1.2.3', fetch: fake.fetch });
    const out = await settle(search(query));
    expect(out.buyers.status).toBe('ok');
    expect(out.buyers.reason).toBeUndefined();
    expect(out.buyers.posts.map((p) => p.id)).toEqual(['p1']);
    expect(out.notices).toEqual([NOTICE_PARTIAL]);
    expect(NOTICE_PARTIAL).toBe('Some Reddit searches failed; results may be incomplete');
  });

  it('ok with no buyer posts has no notice', async () => {
    const search = createBuyerSearch({ config: config(), version: '1.2.3', fetch: fakeFetch().fetch });
    const out = await settle(search(query));
    expect(out).toMatchObject({ buyers: { status: 'ok', posts: [] }, notices: [] });
  });
});

describe('25 s deadline (AC11)', () => {
  it('returns what finished, with the notice, when the deadline cuts the search short', async () => {
    const fake = fakeFetch({
      onSearch: (call) =>
        new URL(call.url).pathname === '/search' ? json(listing([{ id: 'p1', title: 'WTB RTX 3080' }])) : hang(call),
    });
    const search = createBuyerSearch({ config: config(), version: '1.2.3', fetch: fake.fetch });
    const started = Date.now();
    const out = await settle(search({ ...query, context: { subreddits: ['a1', 'b2', 'c3'] } }));
    expect(Date.now() - started).toBeGreaterThanOrEqual(25_000);
    expect(Date.now() - started).toBeLessThan(25_200);
    expect(out.buyers.status).toBe('ok');
    expect(out.buyers.posts.map((p) => p.id)).toEqual(['p1']);
    expect(out.notices).toContain(NOTICE_DEADLINE);
    expect(NOTICE_DEADLINE).toBe('Reddit took longer than 25 s; showing what finished');
  });

  it('is unavailable "Reddit did not answer within 25 s" when nothing finished', async () => {
    const fake = fakeFetch({ onSearch: hang });
    const search = createBuyerSearch({ config: config(), version: '1.2.3', fetch: fake.fetch });
    const started = Date.now();
    const out = await settle(search({ ...query, context: { subreddits: ['a1', 'b2', 'c3'] } }));
    expect(Date.now() - started).toBeLessThan(25_200);
    expect(out.buyers).toMatchObject({ status: 'unavailable', reason: 'Reddit did not answer within 25 s', posts: [] });
    expect(out.notices).toEqual([]);
    // Nothing is sent after the search has returned.
    const sent = fake.calls.length;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fake.calls.length).toBe(sent);
  });
});

describe('nothing is sent after the deadline', () => {
  it('a 401 at about 24.8 s asks for no new token once the search has returned', async () => {
    // site-wide hangs (10.5 s), a1 hangs (21 s), b2 is sent at 21.5 s and gets a 401 at 24.8 s.
    const fake = fakeFetch({
      onSearch: (call) =>
        new URL(call.url).pathname === '/r/b2/search'
          ? new Promise<Response>((resolve) => setTimeout(() => resolve(new Response('', { status: 401 })), 3_300))
          : hang(call),
    });
    const search = createBuyerSearch({ config: config(), version: '1.2.3', fetch: fake.fetch });
    const started = Date.now();
    const out = await settle(search({ ...query, context: { subreddits: ['a1', 'b2', 'c3'] } }));
    const b2 = fake.searches().find((c) => c.url.includes('/r/b2/'));
    expect(b2!.at - started).toBeGreaterThan(21_000);
    expect(b2!.at - started + 3_300).toBeLessThan(25_000);
    expect(out.buyers).toMatchObject({ status: 'unavailable', reason: 'Reddit did not answer within 25 s' });

    const sent = fake.calls.length;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fake.calls.length).toBe(sent);
    expect(fake.tokens()).toHaveLength(1);
  });
});

describe('the location never leaves (AC15)', () => {
  it('no request URL, header or body contains anything from "Seattle"', async () => {
    const fake = fakeFetch({ onSearch: () => json(listing([{ id: 'p1', title: 'WTB RTX 3080' }])) });
    const buyers = createBuyerSearch({ config: config(), version: '1.2.3', fetch: fake.fetch });
    const search = createSearchService({ venues: searchVenues, buyers, ebay: disabledEbay() });
    const result = await settle(search({ item: 'RTX 3080', location: 'Seattle', delivery: 'both', window: 30 }));
    expect(result.buyers.status).toBe('ok');
    // The metro was matched: it is used for the Craigslist link only.
    expect(result.buyers.links.at(-1)?.url).toBe('https://seattle.craigslist.org/search/waa?query=RTX%203080');
    expect(fake.calls.length).toBeGreaterThan(1);
    for (const call of fake.calls) {
      const text = [call.url, decodeURIComponent(call.url), JSON.stringify(call.headers), call.body].join('\n');
      expect(text.toLowerCase()).not.toContain('seattle');
    }
  });
});
