import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildSearchInput, search } from './api.ts';
import { kindLabel, safeHref, searchLinkText, understoodAs, whyText } from './format.ts';
import { LOCATION_KEY, loadLocation, saveLocation } from './storage.ts';

describe('format helpers', () => {
  it('joins category names, or says "general item" when there are none', () => {
    expect(
      understoodAs({
        source: 'catalog',
        categories: [
          { id: 'a', name: 'Keyboards' },
          { id: 'b', name: 'Computer parts' },
        ],
        searchTerm: 'x',
      }),
    ).toBe('Understood as: Keyboards, Computer parts · via built-in catalog');
    expect(understoodAs({ source: 'catalog', categories: [], searchTerm: 'x' })).toBe(
      'Understood as: general item · via built-in catalog',
    );
  });

  it('formats why, kind and search link text', () => {
    expect(whyText(['keyboard', 'mechanical keyboard'])).toBe('Why: keyboard, mechanical keyboard');
    expect(kindLabel('local-classifieds')).toBe('local classifieds');
    expect(kindLabel('subreddit')).toBe('subreddit');
    expect(searchLinkText('mechanical keyboard')).toBe("Search for 'mechanical keyboard' there");
  });

  it('only allows absolute http(s) links', () => {
    expect(safeHref('https://www.reddit.com/r/mechmarket/')).toBe('https://www.reddit.com/r/mechmarket/');
    expect(safeHref('javascript:alert(1)')).toBeNull();
    expect(safeHref('/relative')).toBeNull();
    expect(safeHref(undefined)).toBeNull();
  });
});

describe('location storage', () => {
  afterEach(() => {
    window.localStorage.clear();
    vi.restoreAllMocks();
  });

  it('round-trips a trimmed non-blank location', () => {
    saveLocation('  Seattle ');
    expect(window.localStorage.getItem(LOCATION_KEY)).toBe('"Seattle"');
    expect(loadLocation()).toBe('Seattle');
  });

  it('ignores blank locations on save', () => {
    saveLocation('Seattle');
    saveLocation('   ');
    expect(loadLocation()).toBe('Seattle');
  });

  it.each([
    ['an object', '{"a":1}'],
    ['a number', '42'],
    ['invalid JSON', '{nope'],
    ['a 101-char string', JSON.stringify('x'.repeat(101))],
  ])('returns "" for %s', (_label, raw) => {
    window.localStorage.setItem(LOCATION_KEY, raw);
    expect(loadLocation()).toBe('');
  });

  it('survives a throwing localStorage', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('denied');
    });
    expect(loadLocation()).toBe('');
    expect(() => saveLocation('Seattle')).not.toThrow();
  });
});

describe('api', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('omits a blank location and trims the fields', () => {
    expect(buildSearchInput(' tv ', '  ', 'both')).toEqual({ item: 'tv', delivery: 'both', window: 30 });
    expect(buildSearchInput('tv', ' Seattle ', 'local')).toEqual({
      item: 'tv',
      location: 'Seattle',
      delivery: 'local',
      window: 30,
    });
  });

  it('uses the JSON error field, then the status text', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ error: 'Item too long' }), { status: 400 })),
    );
    await expect(search({ item: 'x', delivery: 'both', window: 30 })).rejects.toThrow('Item too long');

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('oops', { status: 502, statusText: 'Bad Gateway' })),
    );
    await expect(search({ item: 'x', delivery: 'both', window: 30 })).rejects.toThrow('Bad Gateway');

    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 500 })));
    await expect(search({ item: 'x', delivery: 'both', window: 30 })).rejects.toThrow('HTTP 500');
  });

  it('reports network errors and malformed bodies', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch');
      }),
    );
    await expect(search({ item: 'x', delivery: 'both', window: 30 })).rejects.toThrow('Failed to fetch');

    vi.stubGlobal('fetch', vi.fn(async () => new Response('{"venues":3}', { status: 200 })));
    await expect(search({ item: 'x', delivery: 'both', window: 30 })).rejects.toThrow('Unexpected response');
  });
});
