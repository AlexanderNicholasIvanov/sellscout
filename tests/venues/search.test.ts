import { afterEach, describe, expect, it, vi } from 'vitest';
import { catalog } from '../../server/data/catalog.ts';
import { createSearch, searchVenues } from '../../server/venues/index.ts';
import { mostSpecific } from '../../server/venues/search.ts';
import type { Catalog, Delivery, SearchInput, Venue } from '../../server/types.ts';
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

// Run 4 "With Claude picks": a small catalog where ranking by Claude's order, by keyword score and
// by catalog order each decide something.
const pickCatalog: Catalog = {
  reviewed: '2026-11-26',
  categories: [
    { id: 'kb', name: 'Keyboards', keywords: ['keyboard', 'mechanical keyboard', 'keycap'] },
    { id: 'music', name: 'Music', keywords: ['synth', 'keyboard'] },
    { id: 'watches', name: 'Watches', keywords: ['watch'] },
    { id: 'photo', name: 'Photo', keywords: ['camera', 'lens'] },
  ],
  venues: [
    { id: 'ebay', name: 'eBay', kind: 'marketplace', url: 'https://www.ebay.com/', ships: true, local: false, tips: [], categoryIds: [], general: true },
    { id: 'r-music', name: 'r/musicswap', kind: 'subreddit', url: 'https://www.reddit.com/r/musicswap/', ships: true, local: false, tips: [], categoryIds: ['music'] },
    { id: 'watch-only', name: 'Watch shop', kind: 'marketplace', url: 'https://watch.example.com/', ships: true, local: false, tips: [], categoryIds: ['watches'] },
    { id: 'r-kb', name: 'r/kbswap', kind: 'subreddit', url: 'https://www.reddit.com/r/kbswap/', ships: true, local: false, tips: [], categoryIds: ['kb'] },
    { id: 'kb-forum', name: 'KB forum', kind: 'forum', url: 'https://kb.example.com/', ships: true, local: true, tips: [], categoryIds: ['kb'] },
    { id: 'r-watchkb', name: 'r/watchkb', kind: 'subreddit', url: 'https://www.reddit.com/r/watchkb/', ships: true, local: false, tips: [], categoryIds: ['watches', 'kb'] },
    { id: 'photo-shop', name: 'Photo shop', kind: 'marketplace', url: 'https://photo.example.com/', ships: false, local: true, tips: [], categoryIds: ['photo'] },
    { id: 'craigslist', name: 'Craigslist', kind: 'local-classifieds', url: 'https://www.craigslist.org/about/sites', ships: false, local: true, tips: [], categoryIds: [], general: true },
  ],
};
const pickSearch = createSearch({ catalog: pickCatalog, metros: fixtureMetros });
const picks = (categoryIds: string[], subreddits: string[] = []) => ({ categoryIds, searchTerm: 'term from claude', subreddits });
const ids = (venues: Venue[]) => venues.map((v) => v.id);

describe('with Claude picks: specialists and ranking (run 4 AC7)', () => {
  it('serves only the picked categories, ranked by their best position in Claude order', () => {
    // "keyboard" matches kb and music by keyword; Claude picks photo first, then kb.
    const result = pickSearch({ item: 'keyboard', delivery: 'both', window: 30 }, picks(['photo', 'kb']));
    expect(ids(result.venues)).toEqual(['photo-shop', 'r-kb', 'kb-forum', 'r-watchkb', 'ebay', 'craigslist']);
    expect(ids(result.venues)).not.toContain('r-music');
  });

  it('a venue takes the best position of its categories', () => {
    const result = pickSearch({ item: 'vintage item', delivery: 'both', window: 30 }, picks(['kb', 'watches']));
    // r-watchkb serves kb (position 0) and comes before watch-only (watches only, position 1)
    // although watch-only is earlier in the catalog.
    expect(ids(result.venues).slice(0, 4)).toEqual(['r-kb', 'kb-forum', 'r-watchkb', 'watch-only']);
  });

  it('ties on position go to the higher catalog keyword score of the picked categories', () => {
    // Both serve watches (position 0); r-watchkb also serves kb, scoring 2 for "mechanical keyboard".
    const result = pickSearch({ item: 'mechanical keyboard watch', delivery: 'both', window: 30 }, picks(['watches', 'kb']));
    expect(ids(result.venues).slice(0, 2)).toEqual(['r-watchkb', 'watch-only']);
  });

  it('then catalog order', () => {
    const result = pickSearch({ item: 'keyboard', delivery: 'both', window: 30 }, picks(['kb']));
    expect(ids(result.venues).slice(0, 3)).toEqual(['r-kb', 'kb-forum', 'r-watchkb']);
  });

  it('why: the matched keywords of the picked categories, else "Picked by Claude for <best category>"', () => {
    const result = pickSearch({ item: 'mechanical keyboard synth', delivery: 'both', window: 30 }, picks(['watches', 'music', 'kb']));
    const why = Object.fromEntries(result.venues.map((v) => [v.id, v.why]));
    expect(why['watch-only']).toEqual(['Picked by Claude for Watches']);
    expect(why['r-watchkb']).toEqual(['mechanical keyboard']);
    expect(why['r-music']).toEqual(['synth', 'keyboard']);
    expect(why['r-kb']).toEqual(['mechanical keyboard']);
    expect(why['ebay']).toEqual(['Sells almost anything']);
  });

  it('why ignores keywords of categories Claude did not pick', () => {
    const result = pickSearch({ item: 'synth', delivery: 'both', window: 30 }, picks(['kb']));
    expect(result.venues.find((v) => v.id === 'r-kb')?.why).toEqual(['Picked by Claude for Keyboards']);
  });
});

describe('with Claude picks: the plan and notices (run 4 AC7)', () => {
  it('source claude, the picked categories in Claude order with catalog names, the item as searchTerm', () => {
    const result = pickSearch({ item: '  my   keyboard ', delivery: 'both', window: 30 }, picks(['photo', 'nope', 'kb', 'photo']));
    expect(result.plan).toEqual({
      source: 'claude',
      categories: [{ id: 'photo', name: 'Photo' }, { id: 'kb', name: 'Keyboards' }],
      searchTerm: 'my keyboard',
    });
    expect(result.notices).toEqual([]);
  });

  it('no picked category gives the no-match notice, as without Claude', () => {
    const result = pickSearch({ item: 'keyboard', delivery: 'both', window: 30 }, picks([], ['SomeSub']));
    expect(result.plan).toEqual({ source: 'claude', categories: [], searchTerm: 'keyboard' });
    expect(result.notices).toEqual(['No specialist boards matched "keyboard". Try more specific words (brand, model, type).']);
    expect(ids(result.venues)).toEqual(['ai-r-somesub', 'ebay', 'craigslist']);
  });

  it('search links still use the item text, not the Claude term', () => {
    const result = searchVenues({ item: 'mechanical keyboard', delivery: 'both', window: 30 }, picks(['keyboards']));
    const mech = result.venues.find((v) => v.id === 'r-mechmarket');
    expect(mech?.searchUrl).toContain('q=mechanical%20keyboard');
    expect(JSON.stringify(result)).not.toContain('term from claude');
  });

  it('keeps the location notice and Craigslist links', () => {
    const unknown = searchVenues({ item: 'desk', location: 'Nowhereville', delivery: 'both', window: 30 }, picks(['furniture']));
    expect(unknown.notices).toEqual(['Couldn\'t match "Nowhereville" to a city; local links are generic.']);
    const seattle = searchVenues({ item: 'desk', location: 'Seattle', delivery: 'both', window: 30 }, picks(['furniture']));
    expect(seattle.venues.find((v) => v.id === 'craigslist')?.url).toContain('seattle.craigslist.org');
  });
});

describe('with Claude picks: AI-suggested subreddits (run 4 AC7)', () => {
  it('one plain-link venue each, after the specialists and before the metro subreddit and the general venues', () => {
    const result = pickSearch(
      { item: 'keyboard', location: 'Gotham', delivery: 'both', window: 30 },
      picks(['kb'], ['MechanicalKeyboards', 'keyboards_wtb']),
    );
    expect(ids(result.venues)).toEqual([
      'r-kb',
      'kb-forum',
      'r-watchkb',
      'ai-r-mechanicalkeyboards',
      'ai-r-keyboards_wtb',
      'metro-gotham-subreddit',
      'ebay',
      'craigslist',
    ]);
    const venue = result.venues.find((v) => v.id === 'ai-r-mechanicalkeyboards');
    expect(venue).toEqual({
      id: 'ai-r-mechanicalkeyboards',
      name: 'r/MechanicalKeyboards',
      kind: 'subreddit',
      url: 'https://www.reddit.com/r/MechanicalKeyboards/',
      ships: true,
      local: true,
      tips: [],
      why: ['Suggested by Claude'],
      categoryIds: [],
      aiSuggested: true,
    });
    expect(venue).not.toHaveProperty('searchUrl');
    expect(venue).not.toHaveProperty('feeNote');
  });

  it.each<Delivery>(['ship', 'local', 'both'])('the delivery filter keeps them (%s)', (delivery) => {
    const result = pickSearch({ item: 'keyboard', delivery, window: 30 }, picks(['kb'], ['MechanicalKeyboards']));
    expect(ids(result.venues)).toContain('ai-r-mechanicalkeyboards');
  });

  it('are never in the buyer context, which comes from the Claude-ranked catalog subreddits', () => {
    const result = pickSearch({ item: 'keyboard synth', delivery: 'local', window: 30 }, picks(['music', 'kb'], ['MechanicalKeyboards']));
    // music first (Claude order), then kb by catalog order; taken before the delivery filter.
    expect(result.context).toEqual({ subreddits: ['musicswap', 'kbswap', 'watchkb'] });
    const reversed = pickSearch({ item: 'keyboard synth', delivery: 'both', window: 30 }, picks(['kb', 'music'], ['MechanicalKeyboards']));
    expect(reversed.context).toEqual({ subreddits: ['kbswap', 'watchkb', 'musicswap'] });
    expect(reversed.context.subreddits).not.toContain('MechanicalKeyboards');
  });

  it('skips a name already listed as a catalog specialist or the metro subreddit', () => {
    const result = pickSearch(
      { item: 'keyboard', location: 'Gotham', delivery: 'both', window: 30 },
      picks(['kb'], ['KBSwap', 'gothambuysell', 'NewOne', 'newone']),
    );
    expect(result.venues.filter((v) => v.aiSuggested).map((v) => v.name)).toEqual(['r/NewOne']);
  });

  it('skips a name that is not a valid subreddit name', () => {
    const result = pickSearch({ item: 'keyboard', delivery: 'both', window: 30 }, picks(['kb'], ['bad name!', '../x', 'ok_sub']));
    expect(result.venues.filter((v) => v.aiSuggested).map((v) => v.id)).toEqual(['ai-r-ok_sub']);
  });

  it('none without picks', () => {
    const result = pickSearch({ item: 'keyboard', delivery: 'both', window: 30 });
    expect(result.plan.source).toBe('catalog');
    expect(result.venues.some((v) => v.aiSuggested)).toBe(false);
  });
});
