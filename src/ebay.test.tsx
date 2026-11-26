// Run 3: the eBay money / range text helpers, the eBay chip and the ebay part of isSearchResult.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { isSearchResult, search } from './api.ts';
import { ebayNoListingsText, ebaySearchedText, money, priceRangeText, statusChips } from './format.ts';

describe('eBay format helpers', () => {
  it('formats US dollars with a thousands separator and two decimals', () => {
    expect(money(1234.56)).toBe('$1,234.56');
    expect(money(85)).toBe('$85.00');
    expect(money(142.5)).toBe('$142.50');
    expect(money(0.99)).toBe('$0.99');
    expect(money(1_000_000)).toBe('$1,000,000.00');
    // A value with more than two decimals is rounded to cents.
    expect(money(19.999)).toBe('$20.00');
  });

  it('writes the asking-price range line', () => {
    expect(priceRangeText({ count: 6, p25: 85, median: 110, p75: 142.5 })).toBe(
      'Asking prices of 6 active listings (not sold prices): $85.00 to $142.50, median $110.00',
    );
    expect(priceRangeText({ count: 12, p25: 999.5, median: 1234.56, p75: 2500 })).toBe(
      'Asking prices of 12 active listings (not sold prices): $999.50 to $2,500.00, median $1,234.56',
    );
  });

  it('writes the searched and no-listings lines', () => {
    expect(ebaySearchedText('mechanical keyboard')).toBe(
      'Searched eBay for "mechanical keyboard" (fixed-price listings in US dollars)',
    );
    expect(ebayNoListingsText('asdfgh')).toBe('No fixed-price eBay listings found for "asdfgh".');
  });

  it('puts the eBay chip after Reddit and before "Fixture data"', () => {
    expect(statusChips({ redditAuth: false, fixtures: false, ebay: true })).toEqual([
      'Reddit: off (no keys)',
      'eBay: on',
    ]);
    expect(statusChips({ redditAuth: true, fixtures: false, ebay: true })).toEqual(['Reddit: on', 'eBay: on']);
    expect(statusChips({ redditAuth: false, fixtures: false, ebay: false })).toEqual([
      'Reddit: off (no keys)',
      'eBay: off (no keys)',
    ]);
    expect(statusChips({ redditAuth: false, fixtures: true, ebay: false })).toEqual([
      'Reddit: fixture',
      'eBay: fixture',
      'Fixture data',
    ]);
  });
});

describe('isSearchResult: the ebay object', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const plan = { source: 'catalog', categories: [], searchTerm: 'tv' };
  const buyers = { status: 'disabled', term: 'tv', windowDays: 30, posts: [], links: [] };
  const listing = { id: 'v1|1|0', title: 'Sony TV', price: 199.99, condition: 'Used', url: 'https://www.ebay.com/itm/1' };
  const range = { count: 3, p25: 150, median: 199.99, p75: 250 };
  const ebay = {
    status: 'ok',
    term: 'tv',
    listings: [listing],
    priceRange: range,
    searchUrl: 'https://www.ebay.com/sch/i.html?_nkw=tv',
  };
  const body = (e: unknown) => ({ plan, venues: [], buyers, ebay: e, notices: [] });
  const omit = (obj: Record<string, unknown>, key: string) => {
    const copy = { ...obj };
    delete copy[key];
    return copy;
  };

  it('accepts a well-formed ebay object in every status', () => {
    expect(isSearchResult(body(ebay))).toBe(true);
    const noRange = omit(ebay, 'priceRange');
    expect(isSearchResult(body(noRange))).toBe(true);
    expect(isSearchResult(body({ ...noRange, listings: [] }))).toBe(true);
    expect(isSearchResult(body({ ...noRange, listings: [{ ...listing, condition: '' }] }))).toBe(true);
    expect(isSearchResult(body({ ...noRange, status: 'unavailable', reason: 'x', listings: [] }))).toBe(true);
    expect(isSearchResult(body({ ...noRange, status: 'disabled', listings: [] }))).toBe(true);
  });

  const bad: [string, unknown][] = [
    ['a missing ebay object', undefined],
    ['a null ebay object', null],
    ['a string ebay object', 'ok'],
    ['status "Ok"', { ...ebay, status: 'Ok' }],
    ['a numeric status', { ...ebay, status: 1 }],
    ['a numeric reason', { ...ebay, status: 'unavailable', reason: 429 }],
    ['a missing term', omit(ebay, 'term')],
    ['a null term', { ...ebay, term: null }],
    ['a missing searchUrl', omit(ebay, 'searchUrl')],
    ['a numeric searchUrl', { ...ebay, searchUrl: 1 }],
    ['listings not an array', { ...ebay, listings: {} }],
    ['missing listings', omit(ebay, 'listings')],
    ['a null listing', { ...ebay, listings: [null] }],
    ['a string listing', { ...ebay, listings: ['x'] }],
    ...Object.keys(listing).map((key): [string, unknown] => [
      `a listing without ${key}`,
      { ...ebay, listings: [omit(listing, key)] },
    ]),
    ['a listing with a string price', { ...ebay, listings: [{ ...listing, price: '199.99' }] }],
    ['a listing with a null price (NaN in JSON)', { ...ebay, listings: [{ ...listing, price: null }] }],
    ['a listing with a numeric id', { ...ebay, listings: [{ ...listing, id: 1 }] }],
    ['a listing with a null condition', { ...ebay, listings: [{ ...listing, condition: null }] }],
    ['a null priceRange', { ...ebay, priceRange: null }],
    ['a string priceRange', { ...ebay, priceRange: '$1 to $2' }],
    ...Object.keys(range).map((key): [string, unknown] => [
      `a priceRange without ${key}`,
      { ...ebay, priceRange: omit(range, key) },
    ]),
    ['a priceRange with a string median', { ...ebay, priceRange: { ...range, median: '110' } }],
  ];

  it.each(bad)('%s: isSearchResult is false and search() throws', async (_label, e) => {
    expect(isSearchResult(body(e))).toBe(false);
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(body(e)), { status: 200 })));
    await expect(search({ item: 'tv', delivery: 'both', window: 30 })).rejects.toThrow(
      'Unexpected response from server',
    );
  });

  it('rejects non-finite numbers that bypass JSON', () => {
    expect(isSearchResult(body({ ...ebay, listings: [{ ...listing, price: Number.NaN }] }))).toBe(false);
    expect(isSearchResult(body({ ...ebay, listings: [{ ...listing, price: Infinity }] }))).toBe(false);
    expect(isSearchResult(body({ ...ebay, priceRange: { ...range, p75: Infinity } }))).toBe(false);
  });
});
