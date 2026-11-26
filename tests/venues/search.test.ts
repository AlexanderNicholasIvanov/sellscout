import { afterEach, describe, expect, it, vi } from 'vitest';
import { catalog } from '../../server/data/catalog.ts';
import { createSearch, searchVenues } from '../../server/venues/index.ts';
import { mostSpecific } from '../../server/venues/search.ts';
import type { Delivery, SearchInput } from '../../server/types.ts';
import { fixtureCatalog, fixtureMetros } from './fixtures.ts';

const generalIds = new Set(catalog.venues.filter((v) => v.general).map((v) => v.id));

afterEach(() => {
  vi.restoreAllMocks();
});

describe('no category match (AC10)', () => {
  it('"asdfgh" returns only general venues and exactly the no-match notice', () => {
    const result = searchVenues({ item: 'asdfgh', delivery: 'both', window: 30 });
    expect(result.venues.length).toBe(generalIds.size);
    for (const venue of result.venues) {
      expect(generalIds.has(venue.id), venue.id).toBe(true);
      expect(venue.why).toEqual(['Sells almost anything']);
    }
    expect(result.notices).toEqual([
      'No specialist boards matched "asdfgh". Try more specific words (brand, model, type).',
    ]);
    expect(result.plan).toEqual({ source: 'catalog', categories: [], searchTerm: 'asdfgh' });
  });

  it('uses the collapsed search term in the notice', () => {
    const result = searchVenues({ item: '  qwerty   zxcv ', delivery: 'both', window: 30 });
    expect(result.notices).toEqual([
      'No specialist boards matched "qwerty zxcv". Try more specific words (brand, model, type).',
    ]);
  });

  it('keeps the general venues after the specialists when categories match', () => {
    const { venues, notices } = searchVenues({ item: 'mechanical keyboard', delivery: 'both', window: 30 });
    expect(notices).toEqual([]);
    const firstGeneral = venues.findIndex((v) => generalIds.has(v.id));
    expect(firstGeneral).toBeGreaterThan(0);
    expect(venues.slice(firstGeneral).every((v) => generalIds.has(v.id))).toBe(true);
    expect(venues.filter((v) => generalIds.has(v.id)).length).toBe(generalIds.size);
  });
});

describe('delivery filter (AC11)', () => {
  const run = (delivery: Delivery, item = 'two cameras, a guitar and a sofa') =>
    searchVenues({ item, delivery, window: 30 }).venues;

  it('ship drops venues that do not ship', () => {
    const venues = run('ship');
    expect(venues.length).toBeGreaterThan(0);
    expect(venues.filter((v) => !v.ships)).toEqual([]);
  });

  it('local drops venues that are not local', () => {
    const venues = run('local');
    expect(venues.length).toBeGreaterThan(0);
    expect(venues.filter((v) => !v.local)).toEqual([]);
  });

  it('both is the union of ship and local, in the same order', () => {
    const both = run('both').map((v) => v.id);
    const ship = new Set(run('ship').map((v) => v.id));
    const local = new Set(run('local').map((v) => v.id));
    expect(both.length).toBeGreaterThan(ship.size);
    expect(both.length).toBeGreaterThan(local.size);
    expect(new Set(both)).toEqual(new Set([...ship, ...local]));
  });

  it('applies to the fixture catalog exactly', () => {
    const search = createSearch({ catalog: fixtureCatalog, metros: fixtureMetros });
    const item = 'mechanical keyboard camera';
    expect(search({ item, delivery: 'ship', window: 30 }).venues.map((v) => v.id)).toEqual(
      ['kb-a', 'kb-b', 'music-sub', 'ebay', 'facebook-marketplace'],
    );
    expect(search({ item, delivery: 'local', window: 30 }).venues.map((v) => v.id)).toEqual(
      ['kb-b', 'photo-shop', 'craigslist', 'facebook-marketplace'],
    );
  });
});

describe('purity and robustness', () => {
  it('makes no network call during a search (AC16)', () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(() => {
      throw new Error('fetch must not be called');
    });
    searchVenues({ item: 'Sony A7 III body', location: 'Seattle', delivery: 'both', window: 30 });
    searchVenues({ item: 'asdfgh', location: 'Nowhereville', delivery: 'ship', window: 30 });
    searchVenues({ item: 'mechanical keyboard', location: '98101', delivery: 'local', window: 30 });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('builds the plan from the trimmed, collapsed item', () => {
    const { plan } = searchVenues({ item: '  Sony   A7\tIII  body \n', delivery: 'both', window: 30 });
    expect(plan.searchTerm).toBe('Sony A7 III body');
    expect(plan.source).toBe('catalog');
  });

  it('never throws on odd input', () => {
    const odd: unknown[] = [
      { item: '\uD800 lone surrogate', delivery: 'both', window: 30 },
      { item: '', delivery: 'both', window: 30 },
      { item: '((([[[*+?', location: '\\', delivery: 'both', window: 30 },
      { item: 'x'.repeat(5000), location: 'y'.repeat(5000), delivery: 'both', window: 30 },
      { item: 42, location: {}, delivery: 'sideways' },
      {},
    ];
    for (const input of odd) {
      expect(() => searchVenues(input as SearchInput)).not.toThrow();
    }
    const { venues } = searchVenues({ item: '\uD800 cameras', delivery: 'both', window: 30 });
    expect(venues.length).toBeGreaterThan(0);
  });

  it('does not let callers mutate the catalog through results', () => {
    const first = searchVenues({ item: 'mechanical keyboard', delivery: 'both', window: 30 });
    first.venues[0].tips.push('mutated');
    first.venues[0].categoryIds.push('mutated');
    const second = searchVenues({ item: 'mechanical keyboard', delivery: 'both', window: 30 });
    expect(second.venues[0].tips).not.toContain('mutated');
    expect(second.venues[0].categoryIds).not.toContain('mutated');
  });
});

describe('why lists the most specific matched keywords', () => {
  it('drops keywords contained in a longer matched keyword', () => {
    expect(mostSpecific(['sony a7', 'a7', 'a7 iii'])).toEqual(['sony a7', 'a7 iii']);
    expect(mostSpecific(['camera', 'lens'])).toEqual(['camera', 'lens']);
    // whole words only: "ram" is not inside "ramen"
    expect(mostSpecific(['ram', 'ramen'])).toEqual(['ram', 'ramen']);
  });

  it('shows no duplicate sub-keywords for "Sony A7 III body" on the real catalog', () => {
    const photo = searchVenues({ item: 'Sony A7 III body', delivery: 'both', window: 30 }).venues.find(
      (v) => v.name === 'r/photomarket',
    );
    expect(photo?.why).toContain('a7 iii');
    expect(photo?.why).not.toContain('a7');
  });
});

describe('buyer context (run 2a AC5)', () => {
  const manyCategories = 'RTX 3080 mechanical keyboard Sony A7 III camera guitar watch lego';

  it('"RTX 3080" puts r/hardwareswap first', () => {
    const { context } = searchVenues({ item: 'RTX 3080', delivery: 'both', window: 30 });
    expect(context.subreddits[0]).toBe('hardwareswap');
    for (const name of context.subreddits) expect(name).toMatch(/^\w+$/);
  });

  it('lists the matched catalog subreddits in rank order, names without r/', () => {
    const { venues, context } = searchVenues({ item: manyCategories, delivery: 'both', window: 30 });
    const ranked = venues.filter((v) => v.kind === 'subreddit').map((v) => v.name.replace(/^r\//, ''));
    expect(ranked.length).toBeGreaterThan(3);
    expect(context.subreddits).toEqual(ranked.slice(0, 3));
  });

  it('never hands over more than 3 subreddits', () => {
    for (const item of [manyCategories, 'two cameras, a guitar and a sofa', 'RTX 3080', 'asdfgh']) {
      expect(searchVenues({ item, delivery: 'both', window: 30 }).context.subreddits.length).toBeLessThanOrEqual(3);
    }
  });

  it('picks the subreddits before the delivery filter, so local still gets them', () => {
    const both = searchVenues({ item: 'mechanical keyboard', delivery: 'both', window: 30 });
    const local = searchVenues({ item: 'mechanical keyboard', delivery: 'local', window: 30 });
    expect(local.context.subreddits).toEqual(both.context.subreddits);
    expect(local.context.subreddits[0]).toBe('mechmarket');
    expect(local.venues.some((v) => v.name === 'r/mechmarket')).toBe(false);
  });

  it('gives no subreddits when nothing matches', () => {
    expect(searchVenues({ item: 'asdfgh', delivery: 'both', window: 30 }).context).toEqual({ subreddits: [] });
  });

  it("names the matched metro's Craigslist subdomain for any delivery", () => {
    for (const delivery of ['both', 'local', 'ship'] as const) {
      const { context } = searchVenues({ item: 'RTX 3080', location: 'Seattle', delivery, window: 30 });
      expect(context.craigslist).toBe('seattle');
    }
  });

  it('has no craigslist key without a location or with an unknown one', () => {
    expect(searchVenues({ item: 'RTX 3080', delivery: 'both', window: 30 }).context).not.toHaveProperty('craigslist');
    expect(
      searchVenues({ item: 'RTX 3080', location: 'Nowhereville', delivery: 'both', window: 30 }).context,
    ).not.toHaveProperty('craigslist');
  });

  it('never includes the metro subreddit', () => {
    const search = createSearch({ catalog: fixtureCatalog, metros: fixtureMetros });
    const result = search({ item: 'synth', location: 'Gotham', delivery: 'local', window: 30 });
    expect(result.venues.some((v) => v.name === 'r/GothamBuySell')).toBe(true);
    expect(result.context).toEqual({ subreddits: ['music'], craigslist: 'gotham' });
  });

  it('leaves the venue list unchanged by the window', () => {
    const at = (window: 7 | 30 | 90) => searchVenues({ item: 'RTX 3080', location: 'Seattle', delivery: 'both', window });
    expect(at(7)).toEqual(at(30));
    expect(at(90)).toEqual(at(30));
  });
});
