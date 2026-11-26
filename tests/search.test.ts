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
import { readConfig } from '../server/config.ts';
import { catalog } from '../server/data/catalog.ts';
import { createPlanner } from '../server/claude/planner.ts';
import type { ClaudePicks, Planner } from '../server/claude/types.ts';
import type { EbayQuery } from '../server/ebay/index.ts';
import { createBuyerSearch } from '../server/reddit/index.ts';
import {
  CLAUDE_KEY,
  errorBody,
  hangUntilAborted,
  jsonResponse,
  messageBody,
  recordingFetch,
  sdkClient,
  spyConsole,
  textBlock,
} from './claude/helpers.ts';
import type { Answer } from './claude/helpers.ts';

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

// Run 4: the Claude plan comes first, its picks steer the venues and its term both searches; any
// failure gives the catalog result plus one notice.
const PICKS: ClaudePicks = { categoryIds: ['keyboards'], searchTerm: 'Keychron Q1', subreddits: ['MechanicalKeyboards'] };
const okPlanner = (picks: ClaudePicks = PICKS): Planner => async () => ({ ok: true, picks });

function recordingEbay(): { fn: EbaySearchFn; calls: EbayQuery[] } {
  const calls: EbayQuery[] = [];
  return {
    fn: async (query) => {
      calls.push(query);
      return okEbay(query.term ?? buyerTerm(query.item));
    },
    calls,
  };
}

describe('with Claude picks (run 4 AC7, AC8)', () => {
  const input: SearchInput = { item: 'my clicky board', location: 'Seattle', delivery: 'both', window: 30 };

  it('the venues use the picks, and Reddit and eBay receive picks.searchTerm', async () => {
    const buyers = recordingBuyers();
    const ebay = recordingEbay();
    const search = createSearchService({ venues: searchVenues, buyers: buyers.fn, ebay: ebay.fn, planner: okPlanner() });
    const result = await search(input);

    const venueResult = searchVenues(input, PICKS);
    expect(result.plan).toEqual(venueResult.plan);
    expect(result.plan.source).toBe('claude');
    expect(result.plan.searchTerm).toBe('my clicky board');
    expect(result.venues).toEqual(venueResult.venues);
    expect(result.venues.map((v) => v.id).slice(0, 2)).toEqual(['r-mechmarket', 'ai-r-mechanicalkeyboards']);
    expect(buyers.calls).toEqual([{ item: input.item, windowDays: 30, delivery: 'both', context: venueResult.context, term: 'Keychron Q1' }]);
    expect(ebay.calls).toEqual([{ item: input.item, delivery: 'both', term: 'Keychron Q1' }]);
    expect(result.ebay.term).toBe('Keychron Q1');
    expect(result.notices).toEqual([]);
  });

  it('the real Reddit and eBay searches report the Claude term (disabled: links only)', async () => {
    const search = createSearchService({
      venues: searchVenues,
      buyers: createBuyerSearch({ config: readConfig({}), version: '1.2.3', fetch: vi.fn<typeof globalThis.fetch>() }),
      ebay: disabledEbay(),
      planner: okPlanner(),
    });
    const result = await search(input);
    expect(result.buyers.term).toBe('Keychron Q1');
    expect(result.buyers.links[0]?.url).toContain('Keychron%20Q1');
    expect(result.ebay).toEqual({
      status: 'disabled',
      term: 'Keychron Q1',
      listings: [],
      searchUrl: 'https://www.ebay.com/sch/i.html?_nkw=Keychron%20Q1',
    });
  });

  it('without a planner Reddit and eBay get no term (buyerTerm(item) as before) and the plan is the catalog one', async () => {
    const buyers = recordingBuyers();
    const ebay = recordingEbay();
    const result = await createSearchService({ venues: searchVenues, buyers: buyers.fn, ebay: ebay.fn })(input);
    expect(buyers.calls[0]).not.toHaveProperty('term');
    expect(ebay.calls).toEqual([{ item: input.item, delivery: 'both' }]);
    expect(result.ebay.term).toBe(buyerTerm(input.item));
    expect(result.plan.source).toBe('catalog');
    expect(result.notices).toEqual(searchVenues(input).notices);
  });

  it('a failing buyer or eBay search falls back to the Claude term', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const search = createSearchService({
      venues: searchVenues,
      buyers: async () => {
        throw new Error('buyers down');
      },
      ebay: async () => {
        throw new Error('ebay down');
      },
      planner: okPlanner(),
    });
    const result = await search(input);
    expect(result.buyers.term).toBe('Keychron Q1');
    expect(result.buyers.links[0]?.url).toContain('Keychron%20Q1');
    expect(result.ebay).toMatchObject({ term: 'Keychron Q1', searchUrl: 'https://www.ebay.com/sch/i.html?_nkw=Keychron%20Q1' });
  });

  it('plans first: nothing else starts until the plan is done, then Reddit and eBay run together', async () => {
    const events: string[] = [];
    const planDone = deferred<void>();
    const planner: Planner = async () => {
      events.push('plan:start');
      await planDone.promise;
      events.push('plan:end');
      return { ok: true, picks: PICKS };
    };
    const search = createSearchService({
      venues: (venueInput, picks) => {
        events.push(`venues:${picks ? 'picks' : 'none'}`);
        return searchVenues(venueInput, picks);
      },
      buyers: async (query) => {
        events.push('buyers:start');
        return { buyers: okBuyers(query), notices: [] };
      },
      ebay: async (query) => {
        events.push('ebay:start');
        return okEbay(query.term ?? '');
      },
      planner,
    });
    const pending = search(input);
    await new Promise((r) => setTimeout(r, 0));
    expect(events).toEqual(['plan:start']);
    planDone.resolve();
    await pending;
    expect(events).toEqual(['plan:start', 'plan:end', 'venues:picks', 'buyers:start', 'ebay:start']);
  });
});

describe('a failing Claude plan (run 4 AC9)', () => {
  const input: SearchInput = { item: 'private item text keyboard', location: 'Seattle', delivery: 'both', window: 30 };
  const notice = (reason: string) => `Claude couldn't help with this search (${reason}); used the built-in catalog.`;

  /** The same search with Claude off: what every failure must return, plus the notice. */
  const offResult = () => createSearchService({ venues: searchVenues, buyers: recordingBuyers().fn, ebay: disabledEbay() })(input);

  const rows: [string, Answer, string][] = [
    ['timeout', hangUntilAborted, 'timed out'],
    ['network failure', () => Promise.reject(new TypeError('fetch failed')), "couldn't reach Anthropic"],
    ['401', () => jsonResponse(errorBody('authentication_error'), 401), 'API key rejected'],
    ['403', () => jsonResponse(errorBody('permission_error'), 403), 'API key rejected'],
    ['429', () => jsonResponse(errorBody('rate_limit_error'), 429), 'rate limited'],
    ['500', () => jsonResponse(errorBody('api_error'), 500), 'Anthropic returned HTTP 500'],
    ['400', () => jsonResponse(errorBody('invalid_request_error'), 400), 'Anthropic returned HTTP 400'],
    ['refusal', () => jsonResponse(messageBody([], 'refusal')), 'declined'],
    ['max_tokens', () => jsonResponse(messageBody([textBlock('{"cat')], 'max_tokens')), 'answer cut off'],
    ['no text block', () => jsonResponse(messageBody([])), 'unusable answer'],
    ['bad JSON', () => jsonResponse(messageBody([textBlock('nope')])), 'unusable answer'],
    ['invalid shape', () => jsonResponse(messageBody([textBlock('{"categoryIds":"keyboards"}')])), 'unusable answer'],
  ];

  it.each(rows)('%s -> the catalog result plus "%s"; no key or item leaks', async (_label, answer, reason) => {
    const log = spyConsole();
    const { fetch } = recordingFetch(answer);
    const planner = createPlanner({ client: sdkClient(fetch, { timeout: 50 }), model: 'claude-opus-5-5', catalog });
    const search = createSearchService({ venues: searchVenues, buyers: recordingBuyers().fn, ebay: disabledEbay(), planner });
    const result = await search(input);

    const off = await offResult();
    expect(result).toEqual({ ...off, notices: [notice(reason), ...off.notices] });
    expect(result.plan.source).toBe('catalog');
    expect(result.notices.filter((n) => n.startsWith('Claude'))).toHaveLength(1);
    const logged = log.all();
    for (const text of [logged, result.notices.join('\n')]) {
      expect(text).not.toContain(CLAUDE_KEY);
      expect(text).not.toContain('private item');
    }
    expect(JSON.stringify(result)).not.toContain(CLAUDE_KEY);
    expect(JSON.stringify(result)).not.toContain('Echo of');
  });

  it.each([
    ['an unexpected error', async () => {
      throw new TypeError('boom');
    }],
    ['a non-error value', async () => {
      throw `${CLAUDE_KEY} private item text`;
    }],
  ])('%s from the client -> "unexpected error", never rejects', async (_label, create) => {
    const log = spyConsole();
    const planner = createPlanner({ client: { beta: { messages: { create } } }, model: 'm', catalog });
    const search = createSearchService({ venues: searchVenues, buyers: recordingBuyers().fn, ebay: disabledEbay(), planner });
    const result = await search(input);
    const off = await offResult();
    expect(result).toEqual({ ...off, notices: [notice('unexpected error'), ...off.notices] });
    expect(log.all()).not.toContain(CLAUDE_KEY);
    expect(log.all()).not.toContain('private item');
  });

  it('a planner that rejects anyway -> "unexpected error", never rejects', async () => {
    const log = spyConsole();
    const planner: Planner = () => Promise.reject(new Error('planner bug'));
    const search = createSearchService({ venues: searchVenues, buyers: recordingBuyers().fn, ebay: disabledEbay(), planner });
    const result = await search(input);
    expect(result.notices[0]).toBe(notice('unexpected error'));
    expect(result.plan.source).toBe('catalog');
    expect(log.all()).not.toContain('private item');
  });

  it('the notice comes first, then the other notices unchanged', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const planner: Planner = async () => ({ ok: false, reason: 'declined' });
    const search = createSearchService({
      venues: searchVenues,
      buyers: recordingBuyers(['Some Reddit searches failed; results may be incomplete']).fn,
      ebay: disabledEbay(),
      planner,
    });
    const result = await search({ item: 'asdfgh', location: 'Nowhereville', delivery: 'both', window: 30 });
    expect(result.notices).toEqual([
      notice('declined'),
      'No specialist boards matched "asdfgh". Try more specific words (brand, model, type).',
      `Couldn't match "Nowhereville" to a city; local links are generic.`,
      'Some Reddit searches failed; results may be incomplete',
    ]);
  });
});
