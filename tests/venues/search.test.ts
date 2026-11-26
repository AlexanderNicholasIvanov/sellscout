import { afterEach, describe, expect, it, vi } from 'vitest';
import { catalog } from '../../server/data/catalog.ts';
import { createSearch, searchVenues } from '../../server/venues/index.ts';
import type { Delivery, SearchInput } from '../../server/types.ts';
import { fixtureCatalog, fixtureMetros } from './fixtures.ts';

const generalIds = new Set(catalog.venues.filter((v) => v.general).map((v) => v.id));

afterEach(() => {
  vi.restoreAllMocks();
});

describe('no category match (AC10)', () => {
  it('"asdfgh" returns only general venues and exactly the no-match notice', () => {
    const result = searchVenues({ item: 'asdfgh', delivery: 'both' });
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
    const result = searchVenues({ item: '  qwerty   zxcv ', delivery: 'both' });
    expect(result.notices).toEqual([
      'No specialist boards matched "qwerty zxcv". Try more specific words (brand, model, type).',
    ]);
  });

  it('keeps the general venues after the specialists when categories match', () => {
    const { venues, notices } = searchVenues({ item: 'mechanical keyboard', delivery: 'both' });
    expect(notices).toEqual([]);
    const firstGeneral = venues.findIndex((v) => generalIds.has(v.id));
    expect(firstGeneral).toBeGreaterThan(0);
    expect(venues.slice(firstGeneral).every((v) => generalIds.has(v.id))).toBe(true);
    expect(venues.filter((v) => generalIds.has(v.id)).length).toBe(generalIds.size);
  });
});

describe('delivery filter (AC11)', () => {
  const run = (delivery: Delivery, item = 'two cameras, a guitar and a sofa') =>
    searchVenues({ item, delivery }).venues;

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
    expect(search({ item, delivery: 'ship' }).venues.map((v) => v.id)).toEqual(
      ['kb-a', 'kb-b', 'music-sub', 'ebay', 'facebook-marketplace'],
    );
    expect(search({ item, delivery: 'local' }).venues.map((v) => v.id)).toEqual(
      ['kb-b', 'photo-shop', 'craigslist', 'facebook-marketplace'],
    );
  });
});

describe('purity and robustness', () => {
  it('makes no network call during a search (AC16)', () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(() => {
      throw new Error('fetch must not be called');
    });
    searchVenues({ item: 'Sony A7 III body', location: 'Seattle', delivery: 'both' });
    searchVenues({ item: 'asdfgh', location: 'Nowhereville', delivery: 'ship' });
    searchVenues({ item: 'mechanical keyboard', location: '98101', delivery: 'local' });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('builds the plan from the trimmed, collapsed item', () => {
    const { plan } = searchVenues({ item: '  Sony   A7\tIII  body \n', delivery: 'both' });
    expect(plan.searchTerm).toBe('Sony A7 III body');
    expect(plan.source).toBe('catalog');
  });

  it('never throws on odd input', () => {
    const odd: unknown[] = [
      { item: '\uD800 lone surrogate', delivery: 'both' },
      { item: '', delivery: 'both' },
      { item: '((([[[*+?', location: '\\', delivery: 'both' },
      { item: 'x'.repeat(5000), location: 'y'.repeat(5000), delivery: 'both' },
      { item: 42, location: {}, delivery: 'sideways' },
      {},
    ];
    for (const input of odd) {
      expect(() => searchVenues(input as SearchInput)).not.toThrow();
    }
    const { venues } = searchVenues({ item: '\uD800 cameras', delivery: 'both' });
    expect(venues.length).toBeGreaterThan(0);
  });

  it('does not let callers mutate the catalog through results', () => {
    const first = searchVenues({ item: 'mechanical keyboard', delivery: 'both' });
    first.venues[0].tips.push('mutated');
    first.venues[0].categoryIds.push('mutated');
    const second = searchVenues({ item: 'mechanical keyboard', delivery: 'both' });
    expect(second.venues[0].tips).not.toContain('mutated');
    expect(second.venues[0].categoryIds).not.toContain('mutated');
  });
});
