// AC16 (u2 part): the fixture transport. No network: options.fetch must never be called.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readConfig } from '../../server/config.ts';
import { installFetchGuard } from '../../server/fetch-guard.ts';
import { FIXTURE_POSTS } from '../../server/reddit/fixtures/posts.ts';
import { fixtureListing } from '../../server/reddit/fixtures/transport.ts';
import { createBuyerSearch } from '../../server/reddit/index.ts';
import type { BuyerQuery, BuyerSearchFn } from '../../server/reddit/index.ts';
import type { BuyerWindow } from '../../server/types.ts';
import { searchVenues } from '../../server/venues/index.ts';
import { CLIENT_ID, config, SECRET, settle } from './helpers.ts';

const queryFor = (item: string, windowDays: BuyerWindow = 30): BuyerQuery => ({
  item,
  windowDays,
  delivery: 'both',
  context: searchVenues({ item, delivery: 'both', window: windowDays }).context,
});

function fixtureSearch(fixtureDelayMs = 0): { search: BuyerSearchFn; fetchSpy: ReturnType<typeof vi.fn> } {
  const fetchSpy = vi.fn<typeof globalThis.fetch>(() => Promise.reject(new Error('options.fetch must not be called')));
  // Keys are set on purpose: fixture mode must ignore them.
  const search = createBuyerSearch({ config: config({ fixtures: true, fixtureDelayMs }), version: '1.2.3', fetch: fetchSpy });
  return { search, fetchSpy };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('fixture data agreement', () => {
  it('has the agreed mechanical keyboard posts', () => {
    const byId = new Map(FIXTURE_POSTS.map((post) => [post.id, post]));
    expect(byId.get('fx_mk1')).toMatchObject({
      subreddit: 'mechmarket',
      title: '[US-CA] [H] PayPal [W] Mechanical keyboard, 65% layout preferred',
      author: 'keeb_buyer',
      ageHours: 5,
      score: 12,
      numComments: 3,
      selftext: 'Looking for a **hot-swap** board. See [my wishlist](https://example.com/list).',
    });
    expect(byId.get('fx_mk2')).toMatchObject({
      subreddit: 'mechmarket',
      title: '[US-NY] [H] Mechanical keyboard, Keychron Q1 [W] PayPal',
      author: 'keeb_seller',
      ageHours: 8,
      score: 2,
      numComments: 1,
    });
    expect(byId.get('fx_mk3')).toMatchObject({
      subreddit: 'MechanicalKeyboards',
      title: 'WTB a mechanical keyboard for a beginner',
      author: 'first_keeb',
      ageHours: 30,
      score: 4,
      numComments: 9,
      selftext: '',
    });
    expect(byId.get('fx_mk4')).toMatchObject({
      subreddit: 'MechanicalKeyboards',
      title: 'WTB mechanical keyboard (nsfw test)',
      author: 'nsfw_user',
      ageHours: 2,
      score: 1,
      numComments: 0,
      over18: true,
    });
    expect(byId.get('fx_mk5')).toMatchObject({
      subreddit: 'mechmarket',
      title: 'Looking for a mechanical keyboard - monthly thread',
      author: 'AutoModerator',
      ageHours: 1,
      score: 1,
      numComments: 0,
      stickied: true,
    });
    expect(byId.get('fx_mk6')).toMatchObject({
      subreddit: 'MechanicalKeyboards',
      title: 'WTB mechanical keyboard, older post',
      author: 'old_keeb',
      ageHours: 960,
      score: 3,
      numComments: 2,
    });
  });

  it('has unique ids and r/hardwareswap and r/photomarket posts', () => {
    expect(new Set(FIXTURE_POSTS.map((p) => p.id)).size).toBe(FIXTURE_POSTS.length);
    expect(FIXTURE_POSTS.some((p) => p.subreddit === 'hardwareswap')).toBe(true);
    expect(FIXTURE_POSTS.some((p) => p.subreddit === 'photomarket')).toBe(true);
  });

  it('serves listing JSON: every post site-wide, one subreddit for /r/<sub>, newest first', () => {
    const now = Date.UTC(2026, 10, 25, 12);
    const all = fixtureListing('/search', now) as { kind: string; data: { children: { kind: string; data: { id: string; created_utc: number } }[] } };
    expect(all.kind).toBe('Listing');
    expect(all.data.children).toHaveLength(FIXTURE_POSTS.length);
    expect(all.data.children.every((c) => c.kind === 't3')).toBe(true);
    const times = all.data.children.map((c) => c.data.created_utc);
    expect([...times].sort((a, b) => b - a)).toEqual(times);
    const mk1 = all.data.children.find((c) => c.data.id === 'fx_mk1')!;
    expect(mk1.data.created_utc).toBe(now / 1000 - 5 * 3600);

    const sub = fixtureListing('/r/mechmarket/search', now) as typeof all;
    expect(sub.data.children.map((c) => c.data.id).sort()).toEqual(['fx_mk1', 'fx_mk2', 'fx_mk5']);
  });
});

describe('fixture mode search (AC16)', () => {
  it('"mechanical keyboard", window 30 -> fx_mk1 then fx_mk3', async () => {
    const { search, fetchSpy } = fixtureSearch();
    const query = queryFor('mechanical keyboard', 30);
    expect(query.context.subreddits[0]).toBe('mechmarket');
    const out = await search(query);
    expect(out.notices).toEqual([]);
    expect(out.buyers).toMatchObject({ status: 'ok', term: 'mechanical keyboard', windowDays: 30 });
    expect(out.buyers.posts.map((p) => p.id)).toEqual(['fx_mk1', 'fx_mk3']);
    const [mk1, mk3] = out.buyers.posts;
    expect(mk1).toMatchObject({
      title: '[US-CA] [H] PayPal [W] Mechanical keyboard, 65% layout preferred',
      subreddit: 'mechmarket',
      author: 'keeb_buyer',
      score: 12,
      numComments: 3,
      snippet: 'Looking for a hot-swap board. See my wishlist.',
    });
    expect(mk1!.url.startsWith('https://www.reddit.com/r/mechmarket/comments/fx_mk1/')).toBe(true);
    expect(Math.round((Date.now() / 1000 - mk1!.createdUtc) / 3600)).toBe(5);
    expect(mk3!.snippet).toBe('');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('"mechanical keyboard", window 90 also shows fx_mk6, last', async () => {
    const { search } = fixtureSearch();
    const out = await search(queryFor('mechanical keyboard', 90));
    expect(out.buyers.posts.map((p) => p.id)).toEqual(['fx_mk1', 'fx_mk3', 'fx_mk6']);
  });

  it('"mechanical keyboard", window 7 drops fx_mk6', async () => {
    const { search } = fixtureSearch();
    const out = await search(queryFor('mechanical keyboard', 7));
    expect(out.buyers.posts.map((p) => p.id)).toEqual(['fx_mk1', 'fx_mk3']);
  });

  it('"RTX 3080" and "Sony A7 III" have buyers, not sellers', async () => {
    const { search } = fixtureSearch();
    const gpu = await search(queryFor('RTX 3080'));
    expect(gpu.buyers.posts.map((p) => p.id)).toEqual(['fx_gpu1', 'fx_gpu3']);
    const cam = await search(queryFor('Sony A7 III body, low shutter count'));
    expect(cam.buyers.term).toBe('Sony A7 III');
    expect(cam.buyers.posts.map((p) => p.id)).toEqual(['fx_cam1', 'fx_cam3']);
  });

  it('"desk" gives 0 posts', async () => {
    const { search } = fixtureSearch();
    const out = await search(queryFor('desk', 7));
    expect(out).toMatchObject({ buyers: { status: 'ok', posts: [] }, notices: [] });
  });

  it.each([
    ['reddit-403', 'Reddit blocked the request (HTTP 403)'],
    ['reddit-429', 'Reddit rate limit reached (HTTP 429)'],
    ['reddit-html', 'Unexpected response from Reddit'],
    ['reddit-timeout', 'Reddit did not answer within 10 s'],
    ['old bike reddit-timeout', 'Reddit did not answer within 10 s'],
  ])('%j -> unavailable "%s", at once', async (item, reason) => {
    const { search, fetchSpy } = fixtureSearch();
    const started = performance.now();
    const out = await search(queryFor(item));
    expect(performance.now() - started).toBeLessThan(2_000);
    expect(out.buyers).toMatchObject({ status: 'unavailable', reason, posts: [] });
    expect(out.buyers.links.length).toBeGreaterThan(0);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('a 429 starts no cool-down in fixture mode', async () => {
    const { search } = fixtureSearch();
    await search(queryFor('reddit-429'));
    const out = await search(queryFor('mechanical keyboard'));
    expect(out.buyers.status).toBe('ok');
  });

  it('waits fixtureDelayMs before each response', async () => {
    vi.useFakeTimers();
    const { search } = fixtureSearch(50);
    let done = false;
    const pending = search({ item: 'desk', windowDays: 30, delivery: 'ship', context: { subreddits: [] } }).then((out) => {
      done = true;
      return out;
    });
    await vi.advanceTimersByTimeAsync(49);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    const out = await settle(pending);
    expect(done).toBe(true);
    expect(out.buyers.status).toBe('ok');
  });

  it('waits once per request: two requests with 50 ms take 100 ms', async () => {
    vi.useFakeTimers();
    const { search } = fixtureSearch(50);
    let done = false;
    const pending = search({ item: 'desk', windowDays: 30, delivery: 'ship', context: { subreddits: ['mechmarket'] } }).then(() => {
      done = true;
    });
    await vi.advanceTimersByTimeAsync(99);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await pending;
    expect(done).toBe(true);
  });

  it('works with the fetch guard installed and ignores keys from the environment', async () => {
    const restore = installFetchGuard();
    try {
      const cfg = readConfig({ SELLSCOUT_FIXTURES: '1', REDDIT_CLIENT_ID: CLIENT_ID, REDDIT_CLIENT_SECRET: SECRET });
      const search = createBuyerSearch({ config: cfg, version: '1.2.3', fetch: (input, init) => globalThis.fetch(input, init) });
      const out = await search(queryFor('mechanical keyboard'));
      expect(out.buyers.posts.map((p) => p.id)).toEqual(['fx_mk1', 'fx_mk3']);
      expect(JSON.stringify(out)).not.toContain('SENTINEL');
    } finally {
      restore();
    }
  });
});
