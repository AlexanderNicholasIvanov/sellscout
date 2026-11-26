// AC14: the look-yourself links.
import { describe, expect, it } from 'vitest';
import { buyerLinks, searchUrls } from '../../server/reddit/links.ts';

describe('buyerLinks (AC14)', () => {
  it('searches Reddit site-wide with the encoded query and the window t', () => {
    const [first] = buyerLinks('RTX 3080', 30, 'ship', { subreddits: [] });
    expect(first).toEqual({
      label: 'Search Reddit for buyers',
      url: `https://www.reddit.com/search/?q=${encodeURIComponent('(WTB OR ISO OR "looking for") RTX 3080')}&sort=new&t=month`,
    });
    expect(buyerLinks('x', 7, 'ship', { subreddits: [] })[0]?.url).toContain('&t=week');
    expect(buyerLinks('x', 90, 'ship', { subreddits: [] })[0]?.url).toContain('&t=year');
  });

  it('adds one "Search r/<sub>" per context subreddit, in order', () => {
    const links = buyerLinks('RTX 3080', 7, 'ship', { subreddits: ['hardwareswap', 'homelabsales'] });
    expect(links.slice(1)).toEqual([
      {
        label: 'Search r/hardwareswap',
        url: 'https://www.reddit.com/r/hardwareswap/search/?q=RTX%203080&restrict_sr=1&sort=new&t=week',
      },
      {
        label: 'Search r/homelabsales',
        url: 'https://www.reddit.com/r/homelabsales/search/?q=RTX%203080&restrict_sr=1&sort=new&t=week',
      },
    ]);
  });

  it('links the metro Craigslist "wanted" search for local or both', () => {
    for (const delivery of ['local', 'both'] as const) {
      const links = buyerLinks('RTX 3080', 30, delivery, { subreddits: [], craigslist: 'seattle' });
      expect(links.at(-1)).toEqual({
        label: "Craigslist 'wanted' posts",
        url: 'https://seattle.craigslist.org/search/waa?query=RTX%203080',
      });
    }
  });

  it('links "pick your city" when no metro matched', () => {
    const links = buyerLinks('RTX 3080', 30, 'both', { subreddits: ['hardwareswap'] });
    expect(links.map((l) => l.label)).toEqual([
      'Search Reddit for buyers',
      'Search r/hardwareswap',
      "Craigslist 'wanted' (pick your city)",
    ]);
    expect(links.at(-1)?.url).toBe('https://www.craigslist.org/about/sites');
  });

  it('has no Craigslist link for delivery ship', () => {
    const links = buyerLinks('RTX 3080', 30, 'ship', { subreddits: ['hardwareswap'], craigslist: 'seattle' });
    expect(links.some((l) => l.url.includes('craigslist'))).toBe(false);
  });
});

describe('searchUrls', () => {
  it('builds the site-wide and per-subreddit API searches, at most 4', () => {
    const urls = searchUrls('RTX 3080', 30, { subreddits: ['a1', 'b2', 'c3', 'd4', 'e5'] });
    expect(urls).toHaveLength(4);
    const site = new URL(urls[0]!);
    expect(site.origin + site.pathname).toBe('https://oauth.reddit.com/search');
    expect(Object.fromEntries(site.searchParams)).toEqual({
      q: '(WTB OR ISO OR "looking for") RTX 3080',
      sort: 'new',
      t: 'month',
      limit: '100',
      type: 'link',
      raw_json: '1',
    });
    const sub = new URL(urls[1]!);
    expect(sub.pathname).toBe('/r/a1/search');
    expect(Object.fromEntries(sub.searchParams)).toEqual({
      q: 'RTX 3080',
      restrict_sr: '1',
      sort: 'new',
      t: 'month',
      limit: '100',
      type: 'link',
      raw_json: '1',
    });
  });

  it('never puts brackets in a query', () => {
    for (const url of searchUrls('[H] RTX 3080', 7, { subreddits: ['hardwareswap'] })) {
      expect(new URL(url).searchParams.get('q')).not.toMatch(/[[\]]/);
    }
  });
});
