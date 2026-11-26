import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildSearchInput, isSearchResult, search, status } from './api.ts';
import {
  ageText,
  buyersSearchedText,
  kindLabel,
  plural,
  postMetaText,
  postStatsText,
  safeHref,
  searchLinkText,
  statusChips,
  understoodAs,
  whyText,
} from './format.ts';
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

describe('buyer format helpers (AC23)', () => {
  const NOW = Date.UTC(2026, 10, 25, 12, 0, 0);
  const ago = (ms: number) => (NOW - ms) / 1000;
  const MIN = 60_000;
  const HOUR = 60 * MIN;
  const DAY = 24 * HOUR;

  it('says "just now" under a minute and for a future time', () => {
    expect(ageText(ago(0), NOW)).toBe('just now');
    expect(ageText(ago(59_999), NOW)).toBe('just now');
    expect(ageText(ago(-5 * MIN), NOW)).toBe('just now');
    expect(ageText(ago(-3 * DAY), NOW)).toBe('just now');
  });

  it('counts whole minutes under an hour', () => {
    expect(ageText(ago(MIN), NOW)).toBe('1 minute ago');
    expect(ageText(ago(2 * MIN - 1), NOW)).toBe('1 minute ago');
    expect(ageText(ago(2 * MIN), NOW)).toBe('2 minutes ago');
    expect(ageText(ago(HOUR - 1), NOW)).toBe('59 minutes ago');
  });

  it('counts whole hours under a day', () => {
    expect(ageText(ago(HOUR), NOW)).toBe('1 hour ago');
    expect(ageText(ago(2 * HOUR - 1), NOW)).toBe('1 hour ago');
    expect(ageText(ago(5 * HOUR), NOW)).toBe('5 hours ago');
    expect(ageText(ago(DAY - 1), NOW)).toBe('23 hours ago');
  });

  it('counts whole days from a day on', () => {
    expect(ageText(ago(DAY), NOW)).toBe('1 day ago');
    expect(ageText(ago(2 * DAY - 1), NOW)).toBe('1 day ago');
    expect(ageText(ago(30 * HOUR), NOW)).toBe('1 day ago');
    expect(ageText(ago(40 * DAY), NOW)).toBe('40 days ago');
  });

  it('pluralises points and comments', () => {
    expect(plural(1, 'point')).toBe('1 point');
    expect(plural(0, 'point')).toBe('0 points');
    expect(plural(12, 'comment')).toBe('12 comments');
    expect(postStatsText(1, 1)).toBe('1 point · 1 comment');
    expect(postStatsText(12, 3)).toBe('12 points · 3 comments');
    expect(postStatsText(0, 0)).toBe('0 points · 0 comments');
  });

  it('formats the post meta line and the "searched" line', () => {
    expect(postMetaText('mechmarket', 'keeb_buyer', ago(5 * HOUR), NOW)).toBe(
      'r/mechmarket · u/keeb_buyer · 5 hours ago',
    );
    expect(buyersSearchedText('mechanical keyboard', 30)).toBe(
      'Searched Reddit for "mechanical keyboard" (last 30 days)',
    );
  });

  it('picks the header chips from the status', () => {
    expect(statusChips({ redditAuth: true, fixtures: false, ebay: false })).toEqual(['Reddit: on', 'eBay: off (no keys)']);
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

  it('passes the window through and requires a well-formed buyers object', async () => {
    expect(buildSearchInput('tv', '', 'both', 7)).toEqual({ item: 'tv', delivery: 'both', window: 7 });

    const plan = { source: 'catalog', categories: [], searchTerm: 'tv' };
    const buyers = { status: 'disabled', term: 'tv', windowDays: 30, posts: [], links: [] };
    const ebay = { status: 'disabled', term: 'tv', listings: [], searchUrl: 'https://www.ebay.com/sch/i.html?_nkw=tv' };
    const respond = (body: unknown) =>
      vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(body), { status: 200 })));

    respond({ plan, venues: [], buyers, ebay, notices: [] });
    await expect(search({ item: 'tv', delivery: 'both', window: 30 })).resolves.toMatchObject({ buyers, ebay });

    for (const bad of [
      undefined,
      null,
      { ...buyers, status: 1 },
      { ...buyers, posts: undefined },
      { ...buyers, links: {} },
      { ...buyers, term: null },
      { ...buyers, windowDays: '30' },
    ]) {
      respond({ plan, venues: [], buyers: bad, ebay, notices: [] });
      await expect(search({ item: 'tv', delivery: 'both', window: 30 })).rejects.toThrow('Unexpected response');
    }
  });

  describe('rejects a buyers object that breaks the contract', () => {
    const plan = { source: 'catalog', categories: [], searchTerm: 'tv' };
    const post = {
      id: 't3_a',
      title: 'WTB tv',
      subreddit: 'mechmarket',
      author: 'someone',
      createdUtc: 1_795_608_000,
      score: 1,
      numComments: 0,
      snippet: '',
      url: 'https://www.reddit.com/r/mechmarket/comments/a/wtb_tv/',
    };
    const link = { label: 'Search Reddit for buyers', url: 'https://www.reddit.com/search/?q=tv' };
    const buyers = { status: 'ok', term: 'tv', windowDays: 30, posts: [post], links: [link] };
    const ebay = { status: 'disabled', term: 'tv', listings: [], searchUrl: 'https://www.ebay.com/sch/i.html?_nkw=tv' };
    const body = (b: unknown) => ({ plan, venues: [], buyers: b, ebay, notices: [] });

    it('accepts a well-formed result in every status', () => {
      expect(isSearchResult(body(buyers))).toBe(true);
      expect(isSearchResult(body({ ...buyers, status: 'unavailable', reason: 'x', posts: [] }))).toBe(true);
      expect(isSearchResult(body({ ...buyers, status: 'disabled', posts: [], links: [] }))).toBe(true);
      for (const windowDays of [7, 90]) expect(isSearchResult(body({ ...buyers, windowDays }))).toBe(true);
    });

    const omit = (key: keyof typeof post) => {
      const copy: Record<string, unknown> = { ...post };
      delete copy[key];
      return copy;
    };
    const bad: [string, unknown][] = [
      ['a missing buyers object', undefined],
      ['a null buyers object', null],
      ['status "Ok"', { ...buyers, status: 'Ok' }],
      ['a numeric status', { ...buyers, status: 1 }],
      ['a numeric reason', { ...buyers, status: 'unavailable', reason: 403 }],
      ['windowDays 14', { ...buyers, windowDays: 14 }],
      ['windowDays "30"', { ...buyers, windowDays: '30' }],
      ['a null term', { ...buyers, term: null }],
      ['posts not an array', { ...buyers, posts: undefined }],
      ['a null post', { ...buyers, posts: [null] }],
      ['a string post', { ...buyers, posts: ['x'] }],
      ...(Object.keys(post) as (keyof typeof post)[]).map(
        (key): [string, unknown] => [`a post without ${key}`, { ...buyers, posts: [omit(key)] }],
      ),
      ['a post with a string score', { ...buyers, posts: [{ ...post, score: '1' }] }],
      ['links not an array', { ...buyers, links: {} }],
      ['a null link', { ...buyers, links: [null] }],
      ['a link without a label', { ...buyers, links: [{ url: link.url }] }],
      ['a link with a numeric url', { ...buyers, links: [{ label: 'x', url: 1 }] }],
    ];

    it.each(bad)('%s: isSearchResult is false and search() throws', async (_label, b) => {
      expect(isSearchResult(body(b))).toBe(false);
      vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(body(b)), { status: 200 })));
      await expect(search({ item: 'tv', delivery: 'both', window: 30 })).rejects.toThrow(
        'Unexpected response from server',
      );
    });
  });

  it('status() returns the validated status, or null on any failure', async () => {
    const ok = { version: '0.1.0', redditAuth: false, fixtures: true, ebay: false };
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(ok), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(status()).resolves.toEqual(ok);
    expect(fetchMock).toHaveBeenCalledWith('/api/status', expect.anything());

    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(ok), { status: 500 })));
    await expect(status()).resolves.toBeNull();

    vi.stubGlobal('fetch', vi.fn(async () => new Response('not json', { status: 200 })));
    await expect(status()).resolves.toBeNull();

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ ...ok, redditAuth: 'yes' }), { status: 200 })),
    );
    await expect(status()).resolves.toBeNull();

    // ebay must be a boolean too.
    for (const ebay of [undefined, 'false', 0, null]) {
      vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ ...ok, ebay }), { status: 200 })));
      await expect(status()).resolves.toBeNull();
    }

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch');
      }),
    );
    await expect(status()).resolves.toBeNull();
  });
});
