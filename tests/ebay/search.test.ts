// Run 3 AC4, AC7, AC8, AC9: disabled, the result, the category venue, failures, timeouts and
// secrets never leaking (fetch injected, fake timers).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readConfig } from '../../server/config.ts';
import { createEbaySearch, EBAY_DEADLINE_MS } from '../../server/ebay/index.ts';
import type { EbayQuery } from '../../server/ebay/index.ts';
import { createSearchService } from '../../server/search.ts';
import type { BuyersResult } from '../../server/types.ts';
import { searchVenues } from '../../server/venues/index.ts';
import {
  EBAY_TOKEN,
  ebayConfig,
  fakeEbayFetch,
  hang,
  item,
  json,
  searchBody,
  SENTINELS,
  settle,
  tokenResponse,
} from './helpers.ts';
import type { Call, Responder } from './helpers.ts';

const query: EbayQuery = { item: 'mechanical keyboard', delivery: 'both' };
const SEARCH_URL = 'https://www.ebay.com/sch/i.html?_nkw=mechanical%20keyboard';
const KEYBOARD_REFINEMENT = {
  dominantCategoryId: '33963',
  categoryDistributions: [
    { categoryId: '33963', categoryName: 'Keyboards & Keypads', matchCount: 7 },
    { categoryId: '58058', categoryName: 'Computers/Tablets & Networking', matchCount: 1 },
  ],
};

beforeEach(() => {
  vi.useFakeTimers({ now: Date.UTC(2026, 10, 26, 12) });
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('disabled (AC4)', () => {
  it.each([
    ['no keys', readConfig({})],
    ['only the client id', ebayConfig({ clientSecret: '' })],
    ['only the secret', ebayConfig({ clientId: '' })],
    ['Reddit keys but no eBay keys', readConfig({ REDDIT_CLIENT_ID: 'r', REDDIT_CLIENT_SECRET: 's' })],
  ])('%s -> disabled, no fetch at all, searchUrl set', async (_name, config) => {
    const fetchSpy = vi.fn<typeof globalThis.fetch>();
    const search = createEbaySearch({ config, fetch: fetchSpy });
    const out = await search(query);
    expect(out).toEqual({ ebay: { status: 'disabled', term: 'mechanical keyboard', listings: [], searchUrl: SEARCH_URL } });
    expect('reason' in out.ebay).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('the search service with no eBay keys makes no eBay request', async () => {
    const fetchSpy = vi.fn<typeof globalThis.fetch>();
    const search = createSearchService({
      venues: searchVenues,
      buyers: async (q) => ({ buyers: { status: 'disabled', term: q.item, windowDays: q.windowDays, posts: [], links: [] }, notices: [] }),
      ebay: createEbaySearch({ config: readConfig({}), fetch: fetchSpy }),
    });
    const result = await search({ item: 'mechanical keyboard', delivery: 'both', window: 30 });
    expect(result.ebay).toEqual({ status: 'disabled', term: 'mechanical keyboard', listings: [], searchUrl: SEARCH_URL });
    expect(result.venues.some((v) => v.id === 'ebay-category')).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('the ok result (AC7)', () => {
  it('lists the kept items in order with the range and the category venue', async () => {
    const items = [
      item('a', '50.00', { title: 'Keyboard A', condition: 'Used' }),
      item('gbp', '1.00', { price: { value: '1.00', currency: 'GBP' } }),
      item('b', '80.00', { condition: undefined }),
      item('c', '100.00'),
    ];
    const fake = fakeEbayFetch({ onSearch: () => json(searchBody(items, KEYBOARD_REFINEMENT)) });
    const out = await settle(createEbaySearch({ config: ebayConfig(), fetch: fake.fetch })(query));
    expect(out.ebay).toEqual({
      status: 'ok',
      term: 'mechanical keyboard',
      listings: [
        { id: 'a', title: 'Keyboard A', price: 50, condition: 'Used', url: 'https://www.ebay.com/itm/a' },
        { id: 'b', title: 'Item b', price: 80, condition: '', url: 'https://www.ebay.com/itm/b' },
        { id: 'c', title: 'Item c', price: 100, condition: 'Used', url: 'https://www.ebay.com/itm/c' },
      ],
      priceRange: { count: 3, p25: 65, median: 80, p75: 90 },
      searchUrl: SEARCH_URL,
    });
    expect(out.categoryVenue?.name).toBe('eBay - Keyboards & Keypads');
    expect(out.categoryVenue?.url).toBe('https://www.ebay.com/sch/i.html?_nkw=mechanical%20keyboard&_sacat=33963');
  });

  it('fewer than 3 kept items: listings, no range', async () => {
    const fake = fakeEbayFetch({ onSearch: () => json(searchBody([item('a', '1'), item('b', '2')])) });
    const out = await settle(createEbaySearch({ config: ebayConfig(), fetch: fake.fetch })(query));
    expect(out.ebay.status).toBe('ok');
    expect(out.ebay.listings).toHaveLength(2);
    expect(out.ebay).not.toHaveProperty('priceRange');
    expect(out).not.toHaveProperty('categoryVenue');
  });

  it.each([
    ['itemSummaries missing (eBay leaves it out for no matches)', { total: 0, limit: 50, offset: 0 }],
    ['an empty itemSummaries', { total: 0, itemSummaries: [] }],
    ['only skipped items', searchBody([item('a', '0'), item('b', '5', { itemWebUrl: 'https://evil.example/' })])],
  ])('0 kept items (%s) -> ok, no listings, no range', async (_label, body) => {
    const fake = fakeEbayFetch({ onSearch: () => json(body) });
    const out = await settle(createEbaySearch({ config: ebayConfig(), fetch: fake.fetch })(query));
    expect(out).toEqual({ ebay: { status: 'ok', term: 'mechanical keyboard', listings: [], searchUrl: SEARCH_URL } });
  });
});

describe('the category venue (AC8)', () => {
  const service = (body: unknown, buyers?: () => Promise<{ buyers: BuyersResult; notices: string[] }>) => {
    const fake = fakeEbayFetch({ onSearch: () => json(body) });
    return createSearchService({
      venues: searchVenues,
      buyers:
        buyers ??
        (async (q) => ({ buyers: { status: 'disabled', term: q.item, windowDays: q.windowDays, posts: [], links: [] }, notices: [] })),
      ebay: createEbaySearch({ config: ebayConfig(), fetch: fake.fetch }),
    });
  };
  const keyboardBody = searchBody([item('a', '10'), item('b', '20'), item('c', '30')], KEYBOARD_REFINEMENT);

  it('is placed right after the ebay venue', async () => {
    const input = { item: 'mechanical keyboard', delivery: 'both', window: 30 } as const;
    const result = await settle(service(keyboardBody)(input));
    const base = searchVenues(input).venues;
    const at = base.findIndex((v) => v.id === 'ebay');
    expect(at).toBeGreaterThanOrEqual(0);
    const ids = result.venues.map((v) => v.id);
    expect(ids).toEqual([...base.slice(0, at + 1).map((v) => v.id), 'ebay-category', ...base.slice(at + 1).map((v) => v.id)]);
    expect(result.venues[at + 1]).toMatchObject({
      name: 'eBay - Keyboards & Keypads',
      url: 'https://www.ebay.com/sch/i.html?_nkw=mechanical%20keyboard&_sacat=33963',
    });
  });

  it('is placed after ebay with delivery ship too', async () => {
    const result = await settle(service(keyboardBody)({ item: 'mechanical keyboard', delivery: 'ship', window: 30 }));
    const ids = result.venues.map((v) => v.id);
    expect(ids.indexOf('ebay-category')).toBe(ids.indexOf('ebay') + 1);
  });

  it('is absent with delivery local (no request result can add it)', async () => {
    const result = await settle(service(keyboardBody)({ item: 'mechanical keyboard', delivery: 'local', window: 30 }));
    expect(result.ebay.status).toBe('ok');
    expect(result.venues.map((v) => v.id)).not.toContain('ebay-category');
    const fake = fakeEbayFetch({ onSearch: () => json(keyboardBody) });
    const out = await settle(createEbaySearch({ config: ebayConfig(), fetch: fake.fetch })({ ...query, delivery: 'local' }));
    expect(out).not.toHaveProperty('categoryVenue');
  });

  it('is absent on a non-ok result', async () => {
    const fake = fakeEbayFetch({ onSearch: () => new Response('', { status: 500 }) });
    const out = await settle(createEbaySearch({ config: ebayConfig(), fetch: fake.fetch })(query));
    expect(out).toEqual({
      ebay: { status: 'unavailable', reason: 'eBay returned HTTP 500', term: 'mechanical keyboard', listings: [], searchUrl: SEARCH_URL },
    });
  });

  it('the service ignores a category venue that comes with a non-ok result', async () => {
    const venue = { id: 'ebay-category', name: 'eBay - X', kind: 'marketplace', url: 'https://www.ebay.com/', ships: true, local: false, tips: [], why: [], categoryIds: [] } as const;
    const search = createSearchService({
      venues: searchVenues,
      buyers: async (q) => ({ buyers: { status: 'disabled', term: q.item, windowDays: q.windowDays, posts: [], links: [] }, notices: [] }),
      ebay: async () => ({
        ebay: { status: 'unavailable', reason: 'eBay returned HTTP 500', term: 'x', listings: [], searchUrl: 'https://www.ebay.com/sch/i.html?_nkw=x' },
        categoryVenue: { ...venue, tips: [], why: [], categoryIds: [] },
      }),
    });
    const result = await search({ item: 'mechanical keyboard', delivery: 'both', window: 30 });
    expect(result.venues.map((v) => v.id)).not.toContain('ebay-category');
  });

  it('is first when there is no ebay venue', async () => {
    const venue = { id: 'ebay-category', name: 'eBay - X', kind: 'marketplace' as const, url: 'https://www.ebay.com/', ships: true, local: false, tips: [], why: [], categoryIds: [] };
    const search = createSearchService({
      venues: (input) => {
        const result = searchVenues(input);
        return { ...result, venues: result.venues.filter((v) => v.id !== 'ebay') };
      },
      buyers: async (q) => ({ buyers: { status: 'disabled', term: q.item, windowDays: q.windowDays, posts: [], links: [] }, notices: [] }),
      ebay: async () => ({
        ebay: { status: 'ok', term: 'x', listings: [], searchUrl: 'https://www.ebay.com/sch/i.html?_nkw=x' },
        categoryVenue: venue,
      }),
    });
    const result = await search({ item: 'mechanical keyboard', delivery: 'both', window: 30 });
    expect(result.venues[0]).toEqual(venue);
    expect(result.venues.filter((v) => v.id === 'ebay-category')).toHaveLength(1);
  });

  it('an invalid top category adds nothing', async () => {
    const body = searchBody([item('a', '10')], { categoryDistributions: [{ categoryId: '33963x', categoryName: 'Keyboards', matchCount: 7 }] });
    const result = await settle(service(body)({ item: 'mechanical keyboard', delivery: 'both', window: 30 }));
    expect(result.ebay.status).toBe('ok');
    expect(result.venues.map((v) => v.id)).not.toContain('ebay-category');
  });
});

describe('failures (AC9)', () => {
  const run = async (opts: { onSearch?: Responder; onToken?: Responder }) => {
    const fake = fakeEbayFetch(opts);
    const out = await settle(createEbaySearch({ config: ebayConfig(), fetch: fake.fetch })(query));
    return { out, fake };
  };
  const unavailable = (reason: string) => ({
    ebay: { status: 'unavailable', reason, term: 'mechanical keyboard', listings: [], searchUrl: SEARCH_URL },
  });

  it.each([
    ['token 400', () => json({ error: 'invalid_client' }, 400), 'eBay rejected the app keys (HTTP 400)'],
    ['token 401', () => json({ error: 'invalid_client' }, 401), 'eBay rejected the app keys (HTTP 401)'],
    ['token 403', () => new Response('', { status: 403 }), 'eBay refused the request (HTTP 403)'],
    ['token 429', () => new Response('', { status: 429 }), 'eBay rate limit reached (HTTP 429)'],
    ['token 503', () => new Response('', { status: 503 }), 'eBay returned HTTP 503'],
    ['token network error', () => Promise.reject(new TypeError('fetch failed')), "Couldn't reach eBay"],
    ['token HTML body', () => new Response('<html></html>', { status: 200 }), 'eBay returned an unexpected response'],
    ['token without access_token', () => json({ expires_in: 7200 }), 'eBay returned an unexpected response'],
    ['token with an empty access_token', () => json({ access_token: '' }), 'eBay returned an unexpected response'],
  ] as const)('%s -> its reason, no search sent', async (_name, onToken, reason) => {
    const { out, fake } = await run({ onToken });
    expect(out).toEqual(unavailable(reason));
    expect(fake.searches()).toHaveLength(0);
  });

  it.each([
    ['403', () => new Response('<html>no</html>', { status: 403 }), 'eBay refused the request (HTTP 403)'],
    ['429', () => json({ errors: [] }, 429), 'eBay rate limit reached (HTTP 429)'],
    ['500', () => new Response('oops', { status: 500 }), 'eBay returned HTTP 500'],
    ['502 JSON', () => json({ errors: [] }, 502), 'eBay returned HTTP 502'],
    ['404', () => new Response('', { status: 404 }), 'eBay returned HTTP 404'],
    ['a network error', () => Promise.reject(new TypeError('fetch failed')), "Couldn't reach eBay"],
    ['an HTML body', () => new Response('<!doctype html><html></html>', { status: 200 }), 'eBay returned an unexpected response'],
    ['an empty body', () => new Response('', { status: 200 }), 'eBay returned an unexpected response'],
    ['JSON that is an array', () => json([]), 'eBay returned an unexpected response'],
    ['JSON that is null', () => json(null), 'eBay returned an unexpected response'],
    ['JSON that is a string', () => json('items'), 'eBay returned an unexpected response'],
    ['itemSummaries that is not an array', () => json({ itemSummaries: {} }), 'eBay returned an unexpected response'],
  ] as const)('search %s -> its reason', async (_name, onSearch, reason) => {
    const { out } = await run({ onSearch });
    expect(out).toEqual(unavailable(reason));
  });

  it('a search 401 after the retry -> "eBay rejected the app keys (HTTP 401)"', async () => {
    const { out } = await run({ onSearch: () => new Response('', { status: 401 }) });
    expect(out).toEqual(unavailable('eBay rejected the app keys (HTTP 401)'));
  });

  it('a search request that never answers times out after 10 s', async () => {
    const fake = fakeEbayFetch({ onSearch: hang });
    const search = createEbaySearch({ config: ebayConfig(), fetch: fake.fetch });
    let done = false;
    const promise = search(query).then((out) => {
      done = true;
      return out;
    });
    await vi.advanceTimersByTimeAsync(9_990);
    expect(done).toBe(false);
    expect(fake.searches()).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(20);
    expect(done).toBe(true);
    expect(await promise).toEqual(unavailable('eBay took too long to answer'));
    // The timed-out request was aborted.
    expect(fake.searches()[0]!.signal?.aborted).toBe(true);
  });

  it('a token request that never answers times out after 10 s', async () => {
    const fake = fakeEbayFetch({ onToken: hang });
    const search = createEbaySearch({ config: ebayConfig(), fetch: fake.fetch });
    let done = false;
    const promise = search(query).then((out) => {
      done = true;
      return out;
    });
    await vi.advanceTimersByTimeAsync(9_990);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(20);
    expect(await promise).toEqual(unavailable('eBay took too long to answer'));
    expect(fake.searches()).toHaveLength(0);
  });

  it('the whole search has a 20 s deadline (slow token, then a slow search)', async () => {
    expect(EBAY_DEADLINE_MS).toBe(20_000);
    const slow = (ms: number, response: () => Response) => (call: Call) =>
      new Promise<Response>((resolve, reject) => {
        const timer = setTimeout(() => resolve(response()), ms);
        call.signal?.addEventListener('abort', () => {
          clearTimeout(timer);
          reject(new DOMException('aborted', 'AbortError'));
        });
      });
    // Each request stays under its own 10 s timeout, but together they pass 20 s.
    const fake = fakeEbayFetch({
      onToken: slow(9_000, () => tokenResponse()),
      onSearch: slow(9_500, () => new Response('', { status: 401 })),
    });
    const search = createEbaySearch({ config: ebayConfig(), fetch: fake.fetch });
    let done = false;
    const started = Date.now();
    const promise = search(query).then((out) => {
      done = true;
      return out;
    });
    await vi.advanceTimersByTimeAsync(19_990);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(20);
    expect(done).toBe(true);
    expect(Date.now() - started).toBeLessThanOrEqual(20_010);
    expect(await promise).toEqual(unavailable('eBay took too long to answer'));
    // token, search (401), token again, then the retry was cut by the deadline.
    expect(fake.calls.map((c) => (c.url.includes('oauth2/token') ? 'token' : 'search'))).toEqual(['token', 'search', 'token']);
    // Nothing more is sent after the deadline.
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fake.calls).toHaveLength(3);
  });
});

describe('keys and tokens never leak (AC9)', () => {
  const cases: [string, { onSearch?: Responder; onToken?: Responder }][] = [
    ['ok', { onSearch: () => json(searchBody([item('a', '1'), item('b', '2'), item('c', '3')], KEYBOARD_REFINEMENT)) }],
    ['token 401', { onToken: () => json({ error: 'invalid_client', error_description: 'SENTINEL-EBAY-SECRET' }, 401) }],
    ['search 401 twice', { onSearch: () => new Response('', { status: 401 }) }],
    ['search 500 echoing the token', { onSearch: () => json({ token: EBAY_TOKEN }, 500) }],
    ['a network error naming the token', { onSearch: () => Promise.reject(new TypeError(`fetch failed ${EBAY_TOKEN}`)) }],
    ['a timeout', { onSearch: hang }],
  ];

  it.each(cases)('%s: no sentinel in the result, the response or any console call', async (_name, opts) => {
    const spies = (['log', 'info', 'warn', 'error', 'debug', 'trace'] as const).map((method) =>
      vi.spyOn(console, method).mockImplementation(() => {}),
    );
    const fake = fakeEbayFetch(opts);
    const search = createSearchService({
      venues: searchVenues,
      buyers: async (q) => ({ buyers: { status: 'disabled', term: q.item, windowDays: q.windowDays, posts: [], links: [] }, notices: [] }),
      ebay: createEbaySearch({ config: ebayConfig(), fetch: fake.fetch }),
    });
    const result = await settle(search({ item: 'mechanical keyboard', location: 'Seattle', delivery: 'both', window: 30 }));
    const text = JSON.stringify(result);
    for (const sentinel of SENTINELS) {
      expect(text).not.toContain(sentinel);
      expect(result.ebay.reason ?? '').not.toContain(sentinel);
      for (const notice of result.notices) expect(notice).not.toContain(sentinel);
      for (const spy of spies) expect(JSON.stringify(spy.mock.calls)).not.toContain(sentinel);
    }
    expect(text).not.toContain(Buffer.from('SENTINEL-EBAY-ID:SENTINEL-EBAY-SECRET').toString('base64'));
    expect(text).not.toMatch(/Bearer|Basic /);
  });
});
