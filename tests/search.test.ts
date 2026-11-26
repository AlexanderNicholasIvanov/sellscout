import { afterEach, describe, expect, it, vi } from 'vitest';
import { buyerTerm } from '../server/reddit/index.ts';
import { buyerLinks } from '../server/reddit/links.ts';
import type { BuyerQuery, BuyerSearchFn } from '../server/reddit/index.ts';
import { createSearchService } from '../server/search.ts';
import type { BuyersResult, SearchInput } from '../server/types.ts';
import { searchVenues } from '../server/venues/index.ts';
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
    const search = createSearchService({ venues: searchVenues, buyers: buyers.fn });
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
    const search = createSearchService({ venues: searchVenues, buyers: recordingBuyers().fn });
    const result = await search({ item: 'RTX 3080', location: 'Seattle', delivery: 'both', window: 30 });
    expect(Object.keys(result).sort()).toEqual(['buyers', 'ebay', 'notices', 'plan', 'venues']);
    expect(result).not.toHaveProperty('context');
  });

  it('puts the buyer notices after the venue notices', async () => {
    const search = createSearchService({
      venues: searchVenues,
      buyers: recordingBuyers(['Some Reddit searches failed; results may be incomplete']).fn,
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
      const search = createSearchService({ venues: searchVenues, buyers });
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
    const search = createSearchService({ venues: searchVenues, buyers: recordingBuyers().fn });
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
