import { describe, expect, it } from 'vitest';
import { metros } from '../../server/data/metros.ts';
import { createSearch, searchVenues } from '../../server/venues/index.ts';
import { createMetroResolver } from '../../server/venues/location.ts';
import type { SearchResult } from '../../server/types.ts';
import { fixtureCatalog, fixtureMetros } from './fixtures.ts';

const craigslistOf = (result: SearchResult) => result.venues.filter((v) => v.id === 'craigslist');

describe('metro lookup (real metro table)', () => {
  const resolve = createMetroResolver(metros);

  it.each([
    'Seattle', 'seattle', 'seattle, wa', 'Seattle, WA', 'Seattle Washington', 'SEATTLE,WA', ' Seattle ',
    'Bellevue', 'Tacoma, Washington', '98101', '98101-1234', '98402',
  ])('resolves %j to Seattle', (location) => {
    expect(resolve(location)?.id).toBe('seattle');
  });

  it.each([
    ['New York, NY', 'new-york'],
    ['new york new york', 'new-york'],
    ['St. Louis, MO', 'st-louis'],
    ['Washington, D.C.', 'washington-dc'],
    ['Arlington, VA', 'washington-dc'],
    ['Arlington TX', 'dallas'],
    ['arlington texas', 'dallas'],
    ['Kansas City, Kansas', 'kansas-city'],
    ['San Jose', 'sf-bay-area'],
    ['94103', 'sf-bay-area'],
    ['10001', 'new-york'],
    ['60601', 'chicago'],
    ['02139', 'boston'],
  ])('resolves %j to %s', (location, id) => {
    expect(resolve(location)?.id).toBe(id);
  });

  it.each(['Nowhereville', 'Arlington', '9810', '981011', '99999', 'WA', 'abc 98101'])(
    'does not resolve %j',
    (location) => {
      expect(resolve(location)).toBeUndefined();
    },
  );
});

describe('location in search (AC14)', () => {
  it.each(['Seattle', 'seattle, wa', '98101'])('%j gives the Seattle Craigslist links, once', (location) => {
    const result = searchVenues({ item: 'mechanical keyboard', location, delivery: 'both' });
    const craigslist = craigslistOf(result);
    expect(craigslist).toHaveLength(1);
    expect(craigslist[0].url).toBe('https://seattle.craigslist.org/');
    expect(craigslist[0].searchUrl).toBe('https://seattle.craigslist.org/search/sss?query=mechanical%20keyboard');
    expect(craigslist[0].searchUrl?.startsWith('https://seattle.craigslist.org/search/sss?query=')).toBe(true);
    expect(result.venues.filter((v) => v.url.includes('craigslist.org'))).toHaveLength(1);
    expect(result.notices).toEqual([]);
  });

  it('"Nowhereville" keeps the generic links and adds exactly the location notice', () => {
    const result = searchVenues({ item: 'mechanical keyboard', location: 'Nowhereville', delivery: 'both' });
    expect(result.notices).toEqual(['Couldn\'t match "Nowhereville" to a city; local links are generic.']);
    const craigslist = craigslistOf(result);
    expect(craigslist).toHaveLength(1);
    expect(craigslist[0].url).toBe('https://www.craigslist.org/about/sites');
    expect(craigslist[0].searchUrl).toBeUndefined();
  });

  it('quotes the location trimmed, as typed', () => {
    const result = searchVenues({ item: 'asdfgh', location: '  Smallville, KS ', delivery: 'both' });
    expect(result.notices).toEqual([
      'No specialist boards matched "asdfgh". Try more specific words (brand, model, type).',
      'Couldn\'t match "Smallville, KS" to a city; local links are generic.',
    ]);
  });

  it('a blank location adds nothing and no notice', () => {
    const none = searchVenues({ item: 'mechanical keyboard', delivery: 'both' });
    for (const location of ['', '   ']) {
      const blank = searchVenues({ item: 'mechanical keyboard', location, delivery: 'both' });
      expect(blank).toEqual(none);
      expect(blank.notices).toEqual([]);
    }
  });

  it('with no location the Craigslist link is the generic sites page', () => {
    const craigslist = craigslistOf(searchVenues({ item: 'mechanical keyboard', delivery: 'both' }));
    expect(craigslist).toHaveLength(1);
    expect(craigslist[0].url).toBe('https://www.craigslist.org/about/sites');
    expect(craigslist[0].searchUrl).toBeUndefined();
  });

  it('leaves Facebook Marketplace generic when a metro matches', () => {
    const result = searchVenues({ item: 'sofa', location: 'Seattle', delivery: 'both' });
    expect(result.venues.find((v) => v.id === 'facebook-marketplace')?.searchUrl).toBe(
      'https://www.facebook.com/marketplace/search/?query=sofa',
    );
  });
});

describe('metro buy/sell subreddit (AC15, fixture metro)', () => {
  const search = createSearch({ catalog: fixtureCatalog, metros: fixtureMetros });

  it('adds the subreddit right after the specialists, with why "Local to <metro>"', () => {
    const result = search({ item: 'mechanical keyboard', location: 'Gotham', delivery: 'both' });
    expect(result.venues.map((v) => v.id)).toEqual([
      'kb-a', 'kb-b', 'music-sub', 'metro-gotham-subreddit', 'ebay', 'craigslist', 'facebook-marketplace',
    ]);
    expect(result.venues.find((v) => v.id === 'metro-gotham-subreddit')).toEqual({
      id: 'metro-gotham-subreddit',
      name: 'r/GothamBuySell',
      kind: 'subreddit',
      url: 'https://www.reddit.com/r/GothamBuySell/',
      searchUrl: 'https://www.reddit.com/r/GothamBuySell/search/?q=mechanical%20keyboard&restrict_sr=1',
      ships: false,
      local: true,
      tips: ['Local buyers; meet somewhere public'],
      why: ['Local to Gotham'],
      categoryIds: [],
    });
    expect(result.venues.find((v) => v.id === 'craigslist')).toMatchObject({
      url: 'https://gotham.craigslist.org/',
      searchUrl: 'https://gotham.craigslist.org/search/sss?query=mechanical%20keyboard',
    });
    expect(result.notices).toEqual([]);
  });

  it('matches the metro by ZIP and by a state-qualified alias', () => {
    for (const location of ['12345', 'Arlington, Virginia']) {
      const result = search({ item: 'camera', location, delivery: 'local' });
      expect(result.venues.map((v) => v.id)).toContain('metro-gotham-subreddit');
    }
  });

  it('is excluded with delivery "ship"', () => {
    const result = search({ item: 'mechanical keyboard', location: 'Gotham', delivery: 'ship' });
    expect(result.venues.map((v) => v.id)).not.toContain('metro-gotham-subreddit');
  });

  it('appears even when no category matches, before the general venues', () => {
    const result = search({ item: 'asdfgh', location: 'gotham', delivery: 'local' });
    expect(result.venues.map((v) => v.id)).toEqual(['metro-gotham-subreddit', 'craigslist', 'facebook-marketplace']);
  });

  it('adds no subreddit for a metro without one', () => {
    const result = search({ item: 'camera', location: 'Metropolis', delivery: 'both' });
    expect(result.venues.filter((v) => v.kind === 'subreddit')).toEqual([]);
    expect(result.venues.find((v) => v.id === 'craigslist')?.url).toBe('https://metropolis.craigslist.org/');
  });
});
