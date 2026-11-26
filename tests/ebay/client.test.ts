// Run 3 AC5, AC6: the application token and the search request (fetch injected, fake timers).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createEbaySearch } from '../../server/ebay/index.ts';
import type { EbayQuery } from '../../server/ebay/index.ts';
import { createSearchService } from '../../server/search.ts';
import { createBuyerSearch } from '../../server/reddit/index.ts';
import { readConfig } from '../../server/config.ts';
import { searchVenues } from '../../server/venues/index.ts';
import { EBAY_ID, EBAY_SECRET, EBAY_TOKEN, ebayConfig, fakeEbayFetch, item, json, searchBody, settle, tokenResponse } from './helpers.ts';

const query: EbayQuery = { item: 'Mechanical keyboard (barely used)', delivery: 'both' };
const BASIC = `Basic ${Buffer.from(`${EBAY_ID}:${EBAY_SECRET}`).toString('base64')}`;
const START = Date.UTC(2026, 10, 26, 12);

beforeEach(() => {
  vi.useFakeTimers({ now: START });
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('token (AC5)', () => {
  it('POSTs client credentials with Basic auth, the form body and the api_scope', async () => {
    const fake = fakeEbayFetch();
    const search = createEbaySearch({ config: ebayConfig(), fetch: fake.fetch });
    const out = await settle(search(query));
    expect(out.ebay.status).toBe('ok');
    expect(fake.tokens()).toHaveLength(1);
    const [token] = fake.tokens();
    expect(fake.calls[0]).toBe(token);
    expect(token!.url).toBe('https://api.ebay.com/identity/v1/oauth2/token');
    expect(token!.method).toBe('POST');
    expect(token!.headers.authorization).toBe(BASIC);
    expect(token!.headers['content-type']).toBe('application/x-www-form-urlencoded');
    expect(token!.body).toBe('grant_type=client_credentials&scope=https%3A%2F%2Fapi.ebay.com%2Foauth%2Fapi_scope');
    const form = new URLSearchParams(token!.body);
    expect(form.get('grant_type')).toBe('client_credentials');
    expect(form.get('scope')).toBe('https://api.ebay.com/oauth/api_scope');
  });

  it('caches the token across searches', async () => {
    const fake = fakeEbayFetch();
    const search = createEbaySearch({ config: ebayConfig(), fetch: fake.fetch });
    await settle(search(query));
    await vi.advanceTimersByTimeAsync(30 * 60_000);
    await settle(search(query));
    await settle(search({ item: 'desk', delivery: 'ship' }));
    expect(fake.tokens()).toHaveLength(1);
    expect(fake.searches()).toHaveLength(3);
    for (const call of fake.searches()) expect(call.headers.authorization).toBe(`Bearer ${EBAY_TOKEN}`);
  });

  it('fetches a new token 60 s before expires_in runs out (fake clock)', async () => {
    let n = 0;
    const fake = fakeEbayFetch({ onToken: () => tokenResponse(`${EBAY_TOKEN}-${++n}`, 7200) });
    const search = createEbaySearch({ config: ebayConfig(), fetch: fake.fetch });
    await settle(search(query));
    const issued = fake.tokens()[0]!.at;

    await vi.advanceTimersByTimeAsync(issued + 7_139_000 - Date.now());
    await settle(search(query));
    expect(fake.tokens()).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(issued + 7_140_000 - Date.now());
    await settle(search(query));
    expect(fake.tokens()).toHaveLength(2);
    expect(fake.searches().map((c) => c.headers.authorization)).toEqual([
      `Bearer ${EBAY_TOKEN}-1`,
      `Bearer ${EBAY_TOKEN}-1`,
      `Bearer ${EBAY_TOKEN}-2`,
    ]);
  });

  it('uses an injected clock for the expiry', async () => {
    let clock = 1_000_000;
    const fake = fakeEbayFetch({ onToken: () => tokenResponse(EBAY_TOKEN, 600) });
    const search = createEbaySearch({ config: ebayConfig(), fetch: fake.fetch, now: () => clock });
    await settle(search(query));
    clock += 539_999;
    await settle(search(query));
    expect(fake.tokens()).toHaveLength(1);
    clock += 1;
    await settle(search(query));
    expect(fake.tokens()).toHaveLength(2);
  });

  it('assumes about 7200 s when expires_in is missing', async () => {
    const fake = fakeEbayFetch({ onToken: () => json({ access_token: EBAY_TOKEN }) });
    const search = createEbaySearch({ config: ebayConfig(), fetch: fake.fetch });
    await settle(search(query));
    await vi.advanceTimersByTimeAsync(7_000_000);
    await settle(search(query));
    expect(fake.tokens()).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(200_000);
    await settle(search(query));
    expect(fake.tokens()).toHaveLength(2);
  });

  it('3 concurrent searches share one token request', async () => {
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const fake = fakeEbayFetch({
      onToken: async () => {
        await gate;
        return tokenResponse();
      },
    });
    const search = createEbaySearch({ config: ebayConfig(), fetch: fake.fetch });
    const all = Promise.all([search(query), search(query), search({ item: 'desk', delivery: 'ship' })]);
    await vi.advanceTimersByTimeAsync(100);
    expect(fake.tokens()).toHaveLength(1);
    expect(fake.searches()).toHaveLength(0);
    release!();
    const outs = await settle(all);
    expect(outs.map((o) => o.ebay.status)).toEqual(['ok', 'ok', 'ok']);
    expect(fake.tokens()).toHaveLength(1);
    expect(fake.searches()).toHaveLength(3);
  });

  it('a failed token request is not cached: the next search asks again', async () => {
    let n = 0;
    const fake = fakeEbayFetch({ onToken: () => (++n === 1 ? new Response('', { status: 500 }) : tokenResponse()) });
    const search = createEbaySearch({ config: ebayConfig(), fetch: fake.fetch });
    expect((await settle(search(query))).ebay).toMatchObject({ status: 'unavailable', reason: 'eBay returned HTTP 500' });
    expect((await settle(search(query))).ebay.status).toBe('ok');
    expect(fake.tokens()).toHaveLength(2);
  });

  it('a 401 on the search drops the token, fetches a new one once and retries once', async () => {
    let n = 0;
    let first = true;
    const fake = fakeEbayFetch({
      onToken: () => tokenResponse(`${EBAY_TOKEN}-${++n}`),
      onSearch: () => {
        if (first) {
          first = false;
          return new Response('', { status: 401 });
        }
        return json(searchBody([item('a', '10')]));
      },
    });
    const search = createEbaySearch({ config: ebayConfig(), fetch: fake.fetch });
    const out = await settle(search(query));
    expect(out.ebay.status).toBe('ok');
    expect(out.ebay.listings.map((l) => l.id)).toEqual(['a']);
    expect(fake.calls.map((c) => (c.url.includes('oauth2/token') ? 'token' : 'search'))).toEqual(['token', 'search', 'token', 'search']);
    expect(fake.searches().map((c) => c.headers.authorization)).toEqual([`Bearer ${EBAY_TOKEN}-1`, `Bearer ${EBAY_TOKEN}-2`]);

    // The new token is cached.
    await settle(search(query));
    expect(fake.tokens()).toHaveLength(2);
  });

  it('a 401 after the retry gives "eBay rejected the app keys (HTTP 401)" with no third try', async () => {
    const fake = fakeEbayFetch({ onSearch: () => new Response('', { status: 401 }) });
    const search = createEbaySearch({ config: ebayConfig(), fetch: fake.fetch });
    const out = await settle(search(query));
    expect(out.ebay).toEqual({
      status: 'unavailable',
      reason: 'eBay rejected the app keys (HTTP 401)',
      term: 'Mechanical keyboard',
      listings: [],
      searchUrl: 'https://www.ebay.com/sch/i.html?_nkw=Mechanical%20keyboard',
    });
    expect(fake.tokens()).toHaveLength(2);
    expect(fake.searches()).toHaveLength(2);
  });
});

describe('search request (AC6)', () => {
  it('sends the exact URL, params and headers', async () => {
    const fake = fakeEbayFetch();
    const search = createEbaySearch({ config: ebayConfig(), fetch: fake.fetch });
    await settle(search(query));
    const [call] = fake.searches();
    expect(call!.method).toBe('GET');
    expect(call!.url).toBe(
      'https://api.ebay.com/buy/browse/v1/item_summary/search?q=Mechanical%20keyboard&limit=50' +
        '&filter=buyingOptions%3A%7BFIXED_PRICE%7D&fieldgroups=MATCHING_ITEMS%2CCATEGORY_REFINEMENTS',
    );
    const url = new URL(call!.url);
    expect(url.origin + url.pathname).toBe('https://api.ebay.com/buy/browse/v1/item_summary/search');
    expect([...url.searchParams.keys()]).toEqual(['q', 'limit', 'filter', 'fieldgroups']);
    expect(url.searchParams.get('q')).toBe('Mechanical keyboard');
    expect(url.searchParams.get('limit')).toBe('50');
    expect(url.searchParams.get('filter')).toBe('buyingOptions:{FIXED_PRICE}');
    expect(url.searchParams.get('fieldgroups')).toBe('MATCHING_ITEMS,CATEGORY_REFINEMENTS');
    expect(call!.headers.authorization).toBe(`Bearer ${EBAY_TOKEN}`);
    expect(call!.headers['x-ebay-c-marketplace-id']).toBe('EBAY_US');
    expect(call!.headers.accept).toBe('application/json');
    expect(call!.body).toBe('');
  });

  it('the term is buyerTerm(item) and is encoded', async () => {
    const fake = fakeEbayFetch();
    const search = createEbaySearch({ config: ebayConfig(), fetch: fake.fetch });
    const out = await settle(search({ item: 'AT&T phone #2 - like new, boxed', delivery: 'ship' }));
    expect(out.ebay.term).toBe('AT&T phone #2');
    expect(new URL(fake.searches()[0]!.url).searchParams.get('q')).toBe('AT&T phone #2');
    expect(out.ebay.searchUrl).toBe('https://www.ebay.com/sch/i.html?_nkw=AT%26T%20phone%20%232');
  });

  it('the location never appears in any URL, header or body, and delivery is never sent', async () => {
    const fake = fakeEbayFetch({ onSearch: () => json(searchBody([item('a', '10'), item('b', '20'), item('c', '30')])) });
    const search = createSearchService({
      venues: searchVenues,
      buyers: createBuyerSearch({ config: readConfig({}), version: '1.2.3', fetch: fake.fetch }),
      ebay: createEbaySearch({ config: ebayConfig(), fetch: fake.fetch }),
    });
    const result = await settle(search({ item: 'RTX 3080', location: 'Seattle, WA 98101', delivery: 'both', window: 30 }));
    expect(result.ebay.status).toBe('ok');
    expect(fake.calls.length).toBe(2);
    for (const call of fake.calls) {
      const text = [call.url, decodeURIComponent(call.url), JSON.stringify(call.headers), call.body].join('\n').toLowerCase();
      for (const word of ['seattle', '98101', 'wa 9', 'both', 'ship', 'local']) expect(text).not.toContain(word);
    }
  });
});
