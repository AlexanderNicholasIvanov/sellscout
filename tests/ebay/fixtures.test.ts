// Run 3 AC11: fixture mode answers eBay from the in-repo data through the real parsing, with no
// token and no outbound fetch. These are the "Fixture data agreement" values the e2e tests assert.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readConfig } from '../../server/config.ts';
import { DESK_ITEMS, KEYBOARD_CATEGORIES, KEYBOARD_ITEMS } from '../../server/ebay/fixtures/items.ts';
import { createEbaySearch } from '../../server/ebay/index.ts';
import type { EbaySearchFn } from '../../server/ebay/index.ts';
import { installFetchGuard } from '../../server/fetch-guard.ts';
import { createBuyerSearch } from '../../server/reddit/index.ts';
import { createSearchService } from '../../server/search.ts';
import { searchVenues } from '../../server/venues/index.ts';
import { settle } from './helpers.ts';

function fixtureSearch(env: Record<string, string> = {}): { search: EbaySearchFn; fetchSpy: ReturnType<typeof vi.fn> } {
  const fetchSpy = vi.fn<typeof globalThis.fetch>(() => Promise.reject(new Error('options.fetch must not be called')));
  const config = readConfig({ SELLSCOUT_FIXTURES: '1', EBAY_CLIENT_ID: 'SENTINEL-EBAY-ID', EBAY_CLIENT_SECRET: 'SENTINEL-EBAY-SECRET', ...env });
  return { search: createEbaySearch({ config, fetch: fetchSpy }), fetchSpy };
}

const original = globalThis.fetch;
let restore: (() => void) | undefined;
let globalSpy: ReturnType<typeof vi.fn<typeof globalThis.fetch>>;

beforeEach(() => {
  vi.useFakeTimers({ now: Date.UTC(2026, 10, 26, 12) });
  // Any global fetch at all fails the test: fixture mode sends nothing.
  globalSpy = vi.fn<typeof globalThis.fetch>(() => Promise.reject(new Error('global fetch must not be called')));
  globalThis.fetch = globalSpy;
});
afterEach(() => {
  restore?.();
  restore = undefined;
  globalThis.fetch = original;
  vi.useRealTimers();
});

describe('the fixture data agreement (AC11)', () => {
  it('the raw data: 8 keyboard items in order, then the two that are skipped', () => {
    expect(KEYBOARD_ITEMS.map((i) => i.itemId)).toEqual(['fx_eb1', 'fx_eb2', 'fx_eb3', 'fx_eb4', 'fx_eb5', 'fx_eb6', 'fx_eb7', 'fx_eb8']);
    expect(KEYBOARD_ITEMS[6]?.price?.currency).toBe('GBP');
    expect(KEYBOARD_ITEMS[7]?.price).toBeUndefined();
    expect(KEYBOARD_CATEGORIES).toEqual([
      { categoryId: '33963', categoryName: 'Keyboards & Keypads', matchCount: 7 },
      { categoryId: '58058', categoryName: 'Computers/Tablets & Networking', matchCount: 1 },
    ]);
    expect(DESK_ITEMS.every((i) => i.price?.currency === 'USD')).toBe(true);
  });

  it('"mechanical keyboard" -> 6 listings, the range and the category venue', async () => {
    const { search, fetchSpy } = fixtureSearch();
    const out = await settle(search({ item: 'mechanical keyboard', delivery: 'both' }));
    expect(out.ebay.status).toBe('ok');
    expect(out.ebay.term).toBe('mechanical keyboard');
    expect(out.ebay.searchUrl).toBe('https://www.ebay.com/sch/i.html?_nkw=mechanical%20keyboard');
    expect(out.ebay.listings.map((l) => l.id)).toEqual(['fx_eb1', 'fx_eb2', 'fx_eb3', 'fx_eb4', 'fx_eb5', 'fx_eb6']);
    expect(out.ebay.listings.map((l) => l.price)).toEqual([50, 80, 100, 120, 150, 400]);
    for (const listing of out.ebay.listings) {
      expect(listing.title).toContain('mechanical keyboard');
      expect(listing.url).toBe(`https://www.ebay.com/itm/${listing.id}`);
    }
    expect(out.ebay.listings.filter((l) => l.condition === '').map((l) => l.id)).toEqual(['fx_eb3']);
    expect(out.ebay.priceRange).toEqual({ count: 6, p25: 85, median: 110, p75: 142.5 });
    expect(out.categoryVenue).toEqual({
      id: 'ebay-category',
      name: 'eBay - Keyboards & Keypads',
      kind: 'marketplace',
      url: 'https://www.ebay.com/sch/i.html?_nkw=mechanical%20keyboard&_sacat=33963',
      ships: true,
      local: false,
      tips: [],
      why: ['eBay category for "mechanical keyboard"'],
      categoryIds: [],
    });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(globalSpy).not.toHaveBeenCalled();
  });

  it('a term containing "mechanical keyboard" in any case gets the same items', async () => {
    const { search } = fixtureSearch();
    const out = await settle(search({ item: 'Vintage Mechanical Keyboard, boxed', delivery: 'ship' }));
    expect(out.ebay.listings).toHaveLength(6);
    expect(out.categoryVenue?.url).toBe('https://www.ebay.com/sch/i.html?_nkw=Vintage%20Mechanical%20Keyboard&_sacat=33963');
  });

  it('"desk" -> 2 listings, no range', async () => {
    const { search } = fixtureSearch();
    const out = await settle(search({ item: 'standing desk', delivery: 'both' }));
    expect(out.ebay.status).toBe('ok');
    expect(out.ebay.listings).toHaveLength(2);
    expect(out.ebay).not.toHaveProperty('priceRange');
  });

  it('any other term -> 0 listings, status ok', async () => {
    const { search } = fixtureSearch();
    const out = await settle(search({ item: 'zorblax widget', delivery: 'both' }));
    expect(out).toEqual({
      ebay: { status: 'ok', term: 'zorblax widget', listings: [], searchUrl: 'https://www.ebay.com/sch/i.html?_nkw=zorblax%20widget' },
    });
  });

  it.each([
    ['ebay-401 widget', 'eBay rejected the app keys (HTTP 401)'],
    ['ebay-403 widget', 'eBay refused the request (HTTP 403)'],
    ['ebay-429 widget', 'eBay rate limit reached (HTTP 429)'],
    ['ebay-500 widget', 'eBay returned HTTP 500'],
    ['ebay-timeout widget', 'eBay took too long to answer'],
    ['ebay-html widget', 'eBay returned an unexpected response'],
    ['mechanical keyboard ebay-429', 'eBay rate limit reached (HTTP 429)'],
  ])('%s -> unavailable: %s', async (itemText, reason) => {
    const { search, fetchSpy } = fixtureSearch();
    const out = await settle(search({ item: itemText, delivery: 'both' }));
    expect(out.ebay).toMatchObject({ status: 'unavailable', reason, listings: [] });
    expect(out.ebay).not.toHaveProperty('priceRange');
    expect(out).not.toHaveProperty('categoryVenue');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('waits SELLSCOUT_FIXTURE_DELAY_MS before answering', async () => {
    const { search } = fixtureSearch({ SELLSCOUT_FIXTURE_DELAY_MS: '1500' });
    let done = false;
    const promise = search({ item: 'mechanical keyboard', delivery: 'both' }).then((out) => {
      done = true;
      return out;
    });
    await vi.advanceTimersByTimeAsync(1_400);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(200);
    expect((await promise).ebay.listings).toHaveLength(6);
  });

  it('with the fixture-mode fetch guard installed, the whole service still answers and sends nothing', async () => {
    restore = installFetchGuard();
    const config = readConfig({ SELLSCOUT_FIXTURES: '1' });
    const lateFetch = vi.fn<typeof globalThis.fetch>((input, init) => globalThis.fetch(input, init));
    const search = createSearchService({
      venues: searchVenues,
      buyers: createBuyerSearch({ config, version: '1.2.3', fetch: lateFetch }),
      ebay: createEbaySearch({ config, fetch: lateFetch }),
    });
    const result = await settle(search({ item: 'mechanical keyboard', delivery: 'both', window: 30 }));
    expect(result.ebay.status).toBe('ok');
    expect(result.ebay.priceRange).toEqual({ count: 6, p25: 85, median: 110, p75: 142.5 });
    expect(result.buyers.status).toBe('ok');
    const ids = result.venues.map((v) => v.id);
    expect(ids.indexOf('ebay-category')).toBe(ids.indexOf('ebay') + 1);
    expect(lateFetch).not.toHaveBeenCalled();
    expect(globalSpy).not.toHaveBeenCalled();
    // The guard itself blocks eBay hosts.
    await expect(globalThis.fetch('https://api.ebay.com/identity/v1/oauth2/token')).rejects.toThrow(
      'Outbound request blocked in fixture mode: https://api.ebay.com/identity/v1/oauth2/token',
    );
  });
});
