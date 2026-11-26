import { afterEach, describe, expect, it, vi } from 'vitest';
import { buyerTerm } from '../server/reddit/index.ts';
import { buyerLinks } from '../server/reddit/links.ts';
import type { BuyerQuery, BuyerSearchFn } from '../server/reddit/index.ts';
import { createSearchService, EBAY_SEARCH_FAILED } from '../server/search.ts';
import type { EbaySearchFn, EbaySearchOutput } from '../server/ebay/index.ts';
import type { BuyersResult, SearchInput, Venue } from '../server/types.ts';
import { searchVenues } from '../server/venues/index.ts';
import { disabledEbay } from './ebay/helpers.ts';
import { json, listenApp, postSearch } from './server/helpers.ts';
import type { TestApp } from './server/helpers.ts';

const okBuyers = (query: BuyerQuery): BuyersResult => ({
  status: 'ok',
  term: query.item,
  windowDays: query.windowDays,
  posts: [],
  links: [{ label: 'Search Reddit for buyers', url: 'https://www.reddit.com/search/?q=x' }],
});

function recordingBuyers(notices: string[] = []): { fn: BuyerSearchFn; calls: BuyerQuery[] } {
  const calls: BuyerQuery[] = [];
  const fn: BuyerSearchFn = async (query) => {
    calls.push(query);
    return { buyers: okBuyers(query), notices };
  };
  return { fn, calls };
}

let app: TestApp | undefined;
afterEach(async () => {
  await app?.close();
  app = undefined;
  vi.restoreAllMocks();
});

describe('createSearchService', () => {
  it('runs the venue search, then the buyer search with the venue context', async () => {
    const buyers = recordingBuyers();
    const search = createSearchService({ venues: searchVenues, buyers: buyers.fn, ebay: disabledEbay() });
    const input: SearchInput = { item: 'RTX 3080', location: 'Seattle', delivery: 'local', window: 7 };
    const result = await search(input);

    const { context, ...venueResult } = searchVenues(input);
    expect(buyers.calls).toEqual([{ item: 'RTX 3080', windowDays: 7, delivery: 'local', context }]);
    expect(buyers.calls[0]?.context.subreddits[0]).toBe('hardwareswap');
    expect(buyers.calls[0]?.context.craigslist).toBe('seattle');
    expect(result).toEqual({
      ...venueResult,
      buyers: okBuyers(buyers.calls[0] as BuyerQuery),
      ebay: { status: 'disabled', term: 'RTX 3080', listings: [], searchUrl: 'https://www.ebay.com/sch/i.html?_nkw=RTX%203080' },
    });
  });

  it('never puts the context in the output (AC5)', async () => {
    const search = createSearchService({ venues: searchVenues, buyers: recordingBuyers().fn, ebay: disabledEbay() });
    const result = await search({ item: 'RTX 3080', location: 'Seattle', delivery: 'both', window: 30 });
    expect(Object.keys(result).sort()).toEqual(['buyers', 'ebay', 'notices', 'plan', 'venues']);
    expect(result).not.toHaveProperty('context');
  });

  it('puts the buyer notices after the venue notices', async () => {
    const search = createSearchService({
      venues: searchVenues,
      buyers: recordingBuyers(['Some Reddit searches failed; results may be incomplete']).fn,
      ebay: disabledEbay(),
    });
    const result = await search({ item: 'asdfgh', location: 'Nowhereville', delivery: 'both', window: 30 });
    expect(result.notices).toEqual([
      'No specialist boards matched "asdfgh". Try more specific words (brand, model, type).',
      `Couldn't match "Nowhereville" to a city; local links are generic.`,
      'Some Reddit searches failed; results may be incomplete',
    ]);
  });

  describe('a failing buyer search', () => {
    const failures: [string, BuyerSearchFn][] = [
      ['throws', () => {
        throw new Error('boom in buyer search');
      }],
      ['rejects', async () => {
        throw new Error('boom in buyer search');
      }],
    ];

    it.each(failures)('that %s gives the unexpected-failure buyers and still returns venues', async (_label, buyers) => {
      const stderr = vi.spyOn(console, 'error').mockImplementation(() => {});
      const search = createSearchService({ venues: searchVenues, buyers, ebay: disabledEbay() });
      const input: SearchInput = {
        item: '  RTX   3080 private item ',
        location: 'Seattle',
        delivery: 'both',
        window: 90,
      };
      const result = await search(input);

      const venueResult = searchVenues(input);
      expect(result.venues.length).toBeGreaterThan(0);
      expect(result.venues).toEqual(venueResult.venues);
      expect(result.plan).toEqual(venueResult.plan);
      expect(result.notices).toEqual(venueResult.notices);
      expect(result.buyers).toEqual({
        status: 'unavailable',
        reason: 'Reddit search failed unexpectedly',
        term: buyerTerm(input.item),
        windowDays: 90,
        posts: [],
        links: buyerLinks(buyerTerm(input.item), 90, 'both', venueResult.context),
      });
      expect(result.buyers.links.map((link) => link.url)).toContain(
        'https://seattle.craigslist.org/search/waa?query=RTX%203080%20private%20item',
      );

      expect(stderr).toHaveBeenCalledTimes(1);
      expect(stderr.mock.calls[0]).toHaveLength(1);
      const logged = String(stderr.mock.calls[0]?.[0]);
      expect(logged).toContain('boom in buyer search');
      expect(logged).toMatch(/^Error: boom in buyer search\n\s+at /);
      expect(logged).not.toContain('private item');
      expect(logged).not.toContain('Seattle');
    });

    it('logs a placeholder for a non-error value', async () => {
      const stderr = vi.spyOn(console, 'error').mockImplementation(() => {});
      const search = createSearchService({
        venues: searchVenues,
        buyers: async () => Promise.reject('private item text'),
        ebay: disabledEbay(),
      });
      const result = await search({ item: 'bike', delivery: 'both', window: 30 });
      expect(result.buyers.status).toBe('unavailable');
      expect(stderr).toHaveBeenCalledTimes(1);
      expect(stderr.mock.calls.flat().join(' ')).not.toContain('private item text');
    });
  });
});

describe('POST /api/search through the service (AC5)', () => {
  it('sends no context to the browser', async () => {
    const search = createSearchService({ venues: searchVenues, buyers: recordingBuyers().fn, ebay: disabledEbay() });
    app = await listenApp({ search });
    const res = await postSearch(app.port, { item: 'RTX 3080', location: 'Seattle', delivery: 'local' });
    expect(res.status).toBe(200);
    const body = json(res) as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(['buyers', 'ebay', 'notices', 'plan', 'venues']);
    expect(res.body).not.toContain('"context"');
    expect(res.body).not.toContain('"subreddits"');
    expect(app.calls).toEqual([{ item: 'RTX 3080', location: 'Seattle', delivery: 'local', window: 30 }]);
  });
});

interface Deferred<T> { promise: Promise<T>; resolve: (value: T) => void }
function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

const okEbay = (term: string): EbaySearchOutput => ({
  ebay: { status: 'ok', term, listings: [], searchUrl: `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(term)}` },
});

describe('the buyer and eBay searches run concurrently (run 3 AC10)', () => {
  it('both start before either finishes', async () => {
    const events: string[] = [];
    const buyersDone = deferred<void>();
    const ebayDone = deferred<void>();
    const buyers: BuyerSearchFn = async (query) => {
      events.push('buyers:start');
      await buyersDone.promise;
      events.push('buyers:end');
      return { buyers: okBuyers(query), notices: [] };
    };
    const ebay: EbaySearchFn = async (query) => {
      events.push('ebay:start');
      await ebayDone.promise;
      events.push('ebay:end');
      return okEbay(query.item);
    };
    const search = createSearchService({ venues: searchVenues, buyers, ebay });
    let finished = false;
    const pending = search({ item: 'bike', delivery: 'both', window: 30 }).then((result) => {
      finished = true;
      return result;
    });
    await new Promise((r) => setTimeout(r, 0));
    expect(events).toEqual(['buyers:start', 'ebay:start']);

    // eBay finishing first does not finish the search: it waits for the slower of the two.
    ebayDone.resolve();
    await new Promise((r) => setTimeout(r, 0));
    expect(events).toEqual(['buyers:start', 'ebay:start', 'ebay:end']);
    expect(finished).toBe(false);

    buyersDone.resolve();
    const result = await pending;
    expect(events).toEqual(['buyers:start', 'ebay:start', 'ebay:end', 'buyers:end']);
    expect(result.ebay.status).toBe('ok');
    expect(result.buyers.status).toBe('ok');
  });

  it('passes only the item and the delivery to the eBay search', async () => {
    const calls: unknown[] = [];
    const search = createSearchService({
      venues: searchVenues,
      buyers: recordingBuyers().fn,
      ebay: async (query) => {
        calls.push(query);
        return okEbay(query.item);
      },
    });
    await search({ item: 'RTX 3080', location: 'Seattle', delivery: 'local', window: 7 });
    expect(calls).toEqual([{ item: 'RTX 3080', delivery: 'local' }]);
  });

  it('puts the category venue right after the ebay venue, keeping every other venue', async () => {
    const input: SearchInput = { item: 'RTX 3080', delivery: 'both', window: 30 };
    const category: Venue = {
      id: 'ebay-category',
      name: 'eBay - Graphics Cards',
      kind: 'marketplace',
      url: 'https://www.ebay.com/sch/i.html?_nkw=RTX%203080&_sacat=27386',
      ships: true,
      local: false,
      tips: [],
      why: ['eBay category for "RTX 3080"'],
      categoryIds: [],
    };
    const search = createSearchService({
      venues: searchVenues,
      buyers: recordingBuyers().fn,
      ebay: async (query) => ({ ...okEbay(query.item), categoryVenue: category }),
    });
    const result = await search(input);
    const base = searchVenues(input).venues;
    const at = base.findIndex((v) => v.id === 'ebay');
    expect(at).toBeGreaterThanOrEqual(0);
    expect(result.venues).toEqual([...base.slice(0, at + 1), category, ...base.slice(at + 1)]);
  });
});

describe('a failing eBay search (run 3 AC10)', () => {
  const failures: [string, EbaySearchFn][] = [
    ['throws', () => {
      throw new Error('boom in ebay search');
    }],
    ['rejects', async () => {
      throw new Error('boom in ebay search');
    }],
  ];

  it.each(failures)('that %s gives "eBay search failed unexpectedly" and still returns buyers and venues', async (_label, ebay) => {
    const stderr = vi.spyOn(console, 'error').mockImplementation(() => {});
    const buyers = recordingBuyers();
    const search = createSearchService({ venues: searchVenues, buyers: buyers.fn, ebay });
    const input: SearchInput = { item: '  RTX   3080 private item ', location: 'Seattle', delivery: 'both', window: 30 };
    const result = await search(input);

    const venueResult = searchVenues(input);
    expect(result.ebay).toEqual({
      status: 'unavailable',
      reason: 'eBay search failed unexpectedly',
      term: buyerTerm(input.item),
      listings: [],
      searchUrl: 'https://www.ebay.com/sch/i.html?_nkw=RTX%203080%20private%20item',
    });
    expect(result.ebay.reason).toBe(EBAY_SEARCH_FAILED);
    expect(result.venues).toEqual(venueResult.venues);
    expect(result.venues.length).toBeGreaterThan(0);
    expect(result.buyers).toEqual(okBuyers(buyers.calls[0] as BuyerQuery));
    expect(result.notices).toEqual(venueResult.notices);

    expect(stderr).toHaveBeenCalledTimes(1);
    expect(stderr.mock.calls[0]).toHaveLength(1);
    const logged = String(stderr.mock.calls[0]?.[0]);
    expect(logged).toMatch(/^Error: boom in ebay search\n\s+at /);
    expect(logged).not.toContain('private item');
    expect(logged).not.toContain('Seattle');
  });

  it('logs a placeholder for a non-error value', async () => {
    const stderr = vi.spyOn(console, 'error').mockImplementation(() => {});
    const search = createSearchService({
      venues: searchVenues,
      buyers: recordingBuyers().fn,
      ebay: async () => Promise.reject('private item text'),
    });
    const result = await search({ item: 'bike', delivery: 'both', window: 30 });
    expect(result.ebay.status).toBe('unavailable');
    expect(stderr).toHaveBeenCalledTimes(1);
    expect(stderr.mock.calls.flat().join(' ')).not.toContain('private item text');
  });

  it('both searches failing still returns the venues', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const search = createSearchService({
      venues: searchVenues,
      buyers: async () => {
        throw new Error('buyers down');
      },
      ebay: async () => {
        throw new Error('ebay down');
      },
    });
    const result = await search({ item: 'RTX 3080', delivery: 'both', window: 30 });
    expect(result.buyers.reason).toBe('Reddit search failed unexpectedly');
    expect(result.ebay.reason).toBe('eBay search failed unexpectedly');
    expect(result.venues.length).toBeGreaterThan(0);
  });
});
