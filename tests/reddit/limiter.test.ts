// AC9: spacing, rate headers and cool-downs (fake timers, fake fetch).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createBuyerSearch, NOTICE_PARTIAL } from '../../server/reddit/index.ts';
import type { BuyerQuery } from '../../server/reddit/index.ts';
import { createLimiter, parseRateHeader } from '../../server/reddit/limiter.ts';
import { config, fakeFetch, json, listing, settle } from './helpers.ts';

const query: BuyerQuery = {
  item: 'RTX 3080',
  windowDays: 30,
  delivery: 'ship',
  context: { subreddits: ['hardwareswap', 'homelabsales', 'buildapcsales'] },
};

beforeEach(() => {
  vi.useFakeTimers({ now: Date.UTC(2026, 10, 25, 12) });
});
afterEach(() => {
  vi.useRealTimers();
});

describe('parseRateHeader', () => {
  it.each([
    ['0.0', 0],
    ['599.0', 599],
    [' 30 ', 30],
    ['12.5', 12.5],
  ])('%j -> %d', (value, expected) => {
    expect(parseRateHeader(value)).toBe(expected);
  });

  it.each([null, '', 'abc', '12abc', 'NaN', 'Infinity'])('%j is ignored', (value) => {
    expect(parseRateHeader(value)).toBeUndefined();
  });
});

describe('rate limiting (AC9)', () => {
  it('runs requests one at a time, at least 500 ms apart', async () => {
    const fake = fakeFetch();
    const search = createBuyerSearch({ config: config(), version: '1.2.3', fetch: fake.fetch });
    const out = await settle(search(query));
    expect(out.buyers.status).toBe('ok');
    expect(fake.searches()).toHaveLength(4);
    expect(fake.calls).toHaveLength(5); // token + 4 searches
    for (let i = 1; i < fake.calls.length; i++) {
      expect(fake.calls[i]!.at - fake.calls[i - 1]!.at).toBeGreaterThanOrEqual(500);
    }
  });

  it('keeps the spacing across two searches running at the same time', async () => {
    const fake = fakeFetch();
    const search = createBuyerSearch({ config: config(), version: '1.2.3', fetch: fake.fetch });
    await settle(Promise.all([search(query), search({ ...query, item: 'Steam Deck' })]));
    expect(fake.calls).toHaveLength(9); // one shared token + 4 + 4
    const times = fake.calls.map((c) => c.at);
    for (let i = 1; i < times.length; i++) expect(times[i]! - times[i - 1]!).toBeGreaterThanOrEqual(500);
  });

  it('Remaining 0.0 + Reset 30: skips the rest, then makes no request for 30 s', async () => {
    const fake = fakeFetch({
      onSearch: () => json(listing([{ id: 'a', title: 'WTB RTX 3080' }]), 200, {
        'X-Ratelimit-Remaining': '0.0',
        'X-Ratelimit-Reset': '30',
        'X-Ratelimit-Used': '600',
      }),
    });
    const search = createBuyerSearch({ config: config(), version: '1.2.3', fetch: fake.fetch });

    const first = await settle(search(query));
    expect(fake.searches()).toHaveLength(1);
    expect(first.buyers.status).toBe('ok');
    expect(first.buyers.posts.map((p) => p.id)).toEqual(['a']);
    expect(first.notices).toEqual([NOTICE_PARTIAL]);
    const coolDownEnds = fake.searches()[0]!.at + 30_000;

    await vi.advanceTimersByTimeAsync(10_000);
    const callsBefore = fake.calls.length;
    const second = await settle(search(query));
    expect(fake.calls.length).toBe(callsBefore);
    expect(second.buyers.status).toBe('unavailable');
    expect(second.buyers.reason).toBe(
      `Reddit rate limit reached; try again in ${Math.ceil((coolDownEnds - Date.now()) / 1000)} s`,
    );
    expect(second.buyers.reason).toMatch(/^Reddit rate limit reached; try again in (19|20) s$/);
    expect(second.buyers.posts).toEqual([]);
    expect(second.buyers.links.length).toBeGreaterThan(0);

    await vi.advanceTimersByTimeAsync(coolDownEnds - Date.now() + 1);
    await settle(search(query));
    expect(fake.calls.length).toBeGreaterThan(callsBefore);
  });

  it('a 429 without headers starts a 60 s cool-down', async () => {
    const fake = fakeFetch({ onSearch: () => new Response('Too Many Requests', { status: 429 }) });
    const search = createBuyerSearch({ config: config(), version: '1.2.3', fetch: fake.fetch });

    const first = await settle(search(query));
    expect(first.buyers).toMatchObject({ status: 'unavailable', reason: 'Reddit rate limit reached (HTTP 429)' });
    expect(fake.searches()).toHaveLength(1);
    const coolDownEnds = fake.searches()[0]!.at + 60_000;

    await vi.advanceTimersByTimeAsync(coolDownEnds - Date.now() - 1_500);
    const second = await settle(search(query));
    expect(fake.searches()).toHaveLength(1);
    expect(second.buyers.reason).toMatch(/^Reddit rate limit reached; try again in [12] s$/);

    await vi.advanceTimersByTimeAsync(coolDownEnds - Date.now() + 1);
    await settle(search(query));
    expect(fake.searches().length).toBeGreaterThan(1);
  });

  it('a 429 with a non-numeric Reset also cools down for 60 s', async () => {
    const fake = fakeFetch({
      onSearch: () => new Response('', { status: 429, headers: { 'X-Ratelimit-Reset': 'soon' } }),
    });
    const search = createBuyerSearch({ config: config(), version: '1.2.3', fetch: fake.fetch });
    await settle(search(query));
    await vi.advanceTimersByTimeAsync(55_000);
    const second = await settle(search(query));
    expect(fake.searches()).toHaveLength(1);
    expect(second.buyers.reason).toMatch(/^Reddit rate limit reached; try again in [45] s$/);
  });

  it('ignores non-numeric rate headers', async () => {
    const fake = fakeFetch({
      onSearch: () => json(listing(), 200, { 'X-Ratelimit-Remaining': 'abc', 'X-Ratelimit-Reset': 'later' }),
    });
    const search = createBuyerSearch({ config: config(), version: '1.2.3', fetch: fake.fetch });
    const first = await settle(search(query));
    expect(first.buyers.status).toBe('ok');
    expect(first.notices).toEqual([]);
    expect(fake.searches()).toHaveLength(4);
    await settle(search(query));
    expect(fake.searches()).toHaveLength(8);
  });

  it('keeps going while Remaining is 1 or more', async () => {
    const fake = fakeFetch({
      onSearch: () => json(listing(), 200, { 'X-Ratelimit-Remaining': '1.0', 'X-Ratelimit-Reset': '300' }),
    });
    const search = createBuyerSearch({ config: config(), version: '1.2.3', fetch: fake.fetch });
    const out = await settle(search(query));
    expect(fake.searches()).toHaveLength(4);
    expect(out.notices).toEqual([]);
  });
});

describe('createLimiter', () => {
  it('reports the cool-down left and clears it when it ends', async () => {
    const limiter = createLimiter();
    expect(limiter.coolDownLeftMs()).toBe(0);
    expect(limiter.observe(200, new Headers({ 'X-Ratelimit-Remaining': '0.4', 'X-Ratelimit-Reset': '12.5' }))).toBe(true);
    expect(limiter.coolDownLeftMs()).toBe(12_500);
    await vi.advanceTimersByTimeAsync(12_500);
    expect(limiter.coolDownLeftMs()).toBe(0);
  });

  it('does not skip on a 2xx with Remaining >= 1', () => {
    const limiter = createLimiter();
    expect(limiter.observe(200, new Headers({ 'X-Ratelimit-Remaining': '42', 'X-Ratelimit-Reset': '12' }))).toBe(false);
    expect(limiter.coolDownLeftMs()).toBe(0);
  });
});
