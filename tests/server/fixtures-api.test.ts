// AC4: POST /api/__fixtures on the app with an injected fixture store, and its body parser.
// The search fn is the real search service over a fixture-mode buyer search on the same store.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FIXTURE_ERRORS, parseFixtureRequest } from '../../server/http/fixtures.ts';
import { readConfig } from '../../server/config.ts';
import { FIXTURE_POSTS } from '../../server/reddit/fixtures/posts.ts';
import { createFixtureStore } from '../../server/reddit/fixtures/store.ts';
import type { FixtureStore } from '../../server/reddit/fixtures/store.ts';
import { createBuyerSearch } from '../../server/reddit/index.ts';
import { createSearchService } from '../../server/search.ts';
import type { SearchFn, SearchResult } from '../../server/types.ts';
import { searchVenues } from '../../server/venues/index.ts';
import { json, listenApp, postFixtures, postSearch, rawRequest } from './helpers.ts';
import type { TestApp } from './helpers.ts';

let app: TestApp | undefined;
afterEach(async () => {
  await app?.close();
  app = undefined;
});

function fixtureSearchFn(store: FixtureStore): SearchFn {
  const fetchSpy = vi.fn<typeof globalThis.fetch>(() => Promise.reject(new Error('options.fetch must not be called')));
  return createSearchService({
    venues: searchVenues,
    buyers: createBuyerSearch({ config: readConfig({ SELLSCOUT_FIXTURES: '1' }), version: '1.2.3', fetch: fetchSpy, fixtureStore: store }),
  });
}

async function fixtureApp(): Promise<{ app: TestApp; store: FixtureStore }> {
  const store = createFixtureStore();
  app = await listenApp({ fixtures: store, search: fixtureSearchFn(store), status: { redditAuth: false, fixtures: true } });
  return { app, store };
}

async function searchPosts(port: number, item: string): Promise<SearchResult['buyers']['posts']> {
  const res = await postSearch(port, { item, window: 30 });
  expect(res.status).toBe(200);
  const result = json(res) as SearchResult;
  expect(result.buyers.status).toBe('ok');
  return result.buyers.posts;
}

const post = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: 'zx_1',
  title: 'WTB zorblax widget',
  subreddit: 'hardwareswap',
  ...overrides,
});

describe('POST /api/__fixtures: fixture mode off', () => {
  it('is a 404 like any unknown /api path when no store is given', async () => {
    app = await listenApp();
    const res = await postFixtures(app.port, { reset: true });
    expect(res.status).toBe(404);
    expect(json(res)).toEqual({ error: 'Not found' });
    const get = await rawRequest(app.port, { path: '/api/__fixtures' });
    expect(get.status).toBe(404);
    expect(json(get)).toEqual({ error: 'Not found' });
  });
});

describe('POST /api/__fixtures: fixture mode on', () => {
  it('adds a post; the next search returns it with the defaults', async () => {
    const { app } = await fixtureApp();
    expect(await searchPosts(app.port, 'zorblax widget')).toEqual([]);

    const res = await postFixtures(app.port, { post: post({ selftext: 'Paying cash.' }) });
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('application/json; charset=utf-8');
    expect(json(res)).toEqual({ ok: true, posts: FIXTURE_POSTS.length + 1 });

    const posts = await searchPosts(app.port, 'zorblax widget');
    expect(posts.map((p) => p.id)).toEqual(['zx_1']);
    expect(posts[0]).toMatchObject({
      title: 'WTB zorblax widget',
      subreddit: 'hardwareswap',
      author: 'fixture_user',
      score: 1,
      numComments: 0,
      snippet: 'Paying cash.',
    });
    expect(Math.round((Date.now() / 1000 - posts[0]!.createdUtc) / 3600)).toBe(1);
  });

  it('replaces a post with the same id', async () => {
    const { app, store } = await fixtureApp();
    await postFixtures(app.port, { post: post() });
    const res = await postFixtures(app.port, { post: post({ title: '  WTB quibbit gizmo  ', ageHours: 3 }) });
    expect(json(res)).toEqual({ ok: true, posts: FIXTURE_POSTS.length + 1 });
    expect(store.posts().filter((p) => p.id === 'zx_1')).toEqual([
      expect.objectContaining({ title: 'WTB quibbit gizmo', ageHours: 3 }),
    ]);
    expect(await searchPosts(app.port, 'zorblax widget')).toEqual([]);
    const gizmo = await searchPosts(app.port, 'quibbit gizmo');
    expect(gizmo.map((p) => p.id)).toEqual(['zx_1']);
  });

  it('reset restores the built-in posts', async () => {
    const { app, store } = await fixtureApp();
    await postFixtures(app.port, { post: post() });
    await postFixtures(app.port, { post: post({ id: 'zx_2' }) });
    const res = await postFixtures(app.port, { reset: true });
    expect(res.status).toBe(200);
    expect(json(res)).toEqual({ ok: true, posts: FIXTURE_POSTS.length });
    expect(store.posts().some((p) => p.id === 'zx_1' || p.id === 'zx_2')).toBe(false);
    expect(store.posts()).toEqual(FIXTURE_POSTS);
    expect(await searchPosts(app.port, 'zorblax widget')).toEqual([]);
  });

  it.each([
    ['not JSON', '{oops', FIXTURE_ERRORS.json],
    ['an array', '[]', FIXTURE_ERRORS.shape],
    ['null', 'null', FIXTURE_ERRORS.shape],
    ['an empty object', '{}', FIXTURE_ERRORS.shape],
    ['reset false', { reset: false }, FIXTURE_ERRORS.shape],
    ['reset "true"', { reset: 'true' }, FIXTURE_ERRORS.shape],
    ['post and reset together', { post: post(), reset: true }, FIXTURE_ERRORS.shape],
    ['an unknown top-level key', { add: post() }, FIXTURE_ERRORS.shape],
    ['post not an object', { post: 'zx_1' }, FIXTURE_ERRORS.shape],
    ['post an array', { post: [post()] }, FIXTURE_ERRORS.shape],
    ['an unknown post field', { post: post({ author: 'someone' }) }, FIXTURE_ERRORS.shape],
    ['id missing', { post: post({ id: undefined }) }, FIXTURE_ERRORS.id],
    ['id upper case', { post: post({ id: 'ZX_1' }) }, FIXTURE_ERRORS.id],
    ['id with a dash', { post: post({ id: 'zx-1' }) }, FIXTURE_ERRORS.id],
    ['id empty', { post: post({ id: '' }) }, FIXTURE_ERRORS.id],
    ['id 21 characters', { post: post({ id: 'a'.repeat(21) }) }, FIXTURE_ERRORS.id],
    ['id a number', { post: post({ id: 12 }) }, FIXTURE_ERRORS.id],
    ['title missing', { post: post({ title: undefined }) }, FIXTURE_ERRORS.title],
    ['title not a string', { post: post({ title: 5 }) }, FIXTURE_ERRORS.title],
    ['title empty', { post: post({ title: '' }) }, FIXTURE_ERRORS.title],
    ['title only spaces', { post: post({ title: '   ' }) }, FIXTURE_ERRORS.title],
    ['title 301 characters', { post: post({ title: 'W'.repeat(301) }) }, FIXTURE_ERRORS.title],
    ['subreddit missing', { post: post({ subreddit: undefined }) }, FIXTURE_ERRORS.subreddit],
    ['subreddit too short', { post: post({ subreddit: 'ab' }) }, FIXTURE_ERRORS.subreddit],
    ['subreddit 22 characters', { post: post({ subreddit: 'a'.repeat(22) }) }, FIXTURE_ERRORS.subreddit],
    ['subreddit with r/', { post: post({ subreddit: 'r/hardwareswap' }) }, FIXTURE_ERRORS.subreddit],
    ['selftext not a string', { post: post({ selftext: 7 }) }, FIXTURE_ERRORS.selftext],
    ['selftext null', { post: post({ selftext: null }) }, FIXTURE_ERRORS.selftext],
    ['selftext 2001 characters', { post: post({ selftext: 'x'.repeat(2001) }) }, FIXTURE_ERRORS.selftext],
    ['ageHours negative', { post: post({ ageHours: -1 }) }, FIXTURE_ERRORS.ageHours],
    ['ageHours over 2160', { post: post({ ageHours: 2160.5 }) }, FIXTURE_ERRORS.ageHours],
    ['ageHours a string', { post: post({ ageHours: '5' }) }, FIXTURE_ERRORS.ageHours],
    ['ageHours null', { post: post({ ageHours: null }) }, FIXTURE_ERRORS.ageHours],
  ])('400 for %s', async (_name, body, message) => {
    const { app, store } = await fixtureApp();
    const res = await postFixtures(app.port, body);
    expect(res.status).toBe(400);
    expect(json(res)).toEqual({ error: message });
    expect(store.posts()).toEqual(FIXTURE_POSTS);
  });

  it('405 with Allow: POST for GET and other methods', async () => {
    const { app } = await fixtureApp();
    for (const method of ['GET', 'PUT', 'DELETE']) {
      const res = await rawRequest(app.port, { method, path: '/api/__fixtures' });
      expect(res.status).toBe(405);
      expect(res.headers.allow).toBe('POST');
      expect(json(res)).toEqual({ error: 'Method not allowed' });
    }
  });

  it('403 for a foreign Host, before anything changes', async () => {
    const { app, store } = await fixtureApp();
    const res = await postFixtures(app.port, { post: post() }, { Host: 'evil.example:5180' });
    expect(res.status).toBe(403);
    expect(json(res)).toEqual({ error: 'Forbidden host' });
    expect(store.posts()).toEqual(FIXTURE_POSTS);
  });

  it('400 for a non-JSON content type', async () => {
    const { app, store } = await fixtureApp();
    const text = JSON.stringify({ post: post() });
    const res = await rawRequest(app.port, {
      method: 'POST',
      path: '/api/__fixtures',
      headers: { 'Content-Type': 'text/plain', 'Content-Length': Buffer.byteLength(text) },
      body: text,
    });
    expect(res.status).toBe(400);
    expect(json(res)).toEqual({ error: 'Content-Type must be application/json' });
    expect(store.posts()).toEqual(FIXTURE_POSTS);
  });

  it('413 above 10 KB', async () => {
    const { app, store } = await fixtureApp();
    const res = await postFixtures(app.port, { post: post({ selftext: 'x'.repeat(10 * 1024) }) });
    expect(res.status).toBe(413);
    expect(json(res)).toEqual({ error: 'Request too large' });
    expect(store.posts()).toEqual(FIXTURE_POSTS);
  });

  it('sends no CORS headers', async () => {
    const { app } = await fixtureApp();
    const res = await postFixtures(app.port, { reset: true }, { Origin: 'https://evil.example' });
    expect(res.status).toBe(200);
    expect(Object.keys(res.headers).filter((h) => h.startsWith('access-control-'))).toEqual([]);
  });
});

describe('parseFixtureRequest', () => {
  it('fills the defaults and trims the title', () => {
    expect(parseFixtureRequest(JSON.stringify({ post: { id: 'a', title: '  WTB x  ', subreddit: 'abc' } }))).toEqual({
      ok: true,
      value: {
        kind: 'post',
        post: { id: 'a', title: 'WTB x', subreddit: 'abc', author: 'fixture_user', score: 1, numComments: 0, selftext: '', ageHours: 1 },
      },
    });
  });

  it('keeps the given selftext and ageHours, including the limits', () => {
    const parsed = parseFixtureRequest(
      JSON.stringify({ post: { id: 'a_1', title: 'WTB x', subreddit: 'A_b', selftext: 'y'.repeat(2000), ageHours: 2160 } }),
    );
    expect(parsed).toMatchObject({ ok: true, value: { post: { selftext: 'y'.repeat(2000), ageHours: 2160 } } });
    expect(parseFixtureRequest(JSON.stringify({ post: { id: 'a', title: 'WTB x', subreddit: 'abc', ageHours: 0 } }))).toMatchObject({
      ok: true,
      value: { post: { ageHours: 0 } },
    });
  });

  it('counts characters as code points: 300 emoji is a valid title, 2000 emoji a valid selftext', () => {
    const emoji = '\u{1F600}';
    expect(parseFixtureRequest(JSON.stringify({ post: { id: 'a', title: emoji.repeat(300), subreddit: 'abc' } })).ok).toBe(true);
    expect(parseFixtureRequest(JSON.stringify({ post: { id: 'a', title: emoji.repeat(301), subreddit: 'abc' } }))).toEqual({
      ok: false,
      error: FIXTURE_ERRORS.title,
    });
    expect(
      parseFixtureRequest(JSON.stringify({ post: { id: 'a', title: 'x', subreddit: 'abc', selftext: emoji.repeat(2000) } })).ok,
    ).toBe(true);
  });

  it('accepts {"reset": true}', () => {
    expect(parseFixtureRequest('{"reset": true}')).toEqual({ ok: true, value: { kind: 'reset' } });
  });

  it('rejects non-finite ageHours (JSON cannot carry them, so 1e999 = Infinity)', () => {
    expect(parseFixtureRequest('{"post":{"id":"a","title":"x","subreddit":"abc","ageHours":1e999}}')).toEqual({
      ok: false,
      error: FIXTURE_ERRORS.ageHours,
    });
  });

  it('has the spec messages', () => {
    expect(FIXTURE_ERRORS).toEqual({
      json: 'Body must be JSON',
      shape: 'Body must be {"post": {...}} or {"reset": true}',
      id: 'id must match ^[a-z0-9_]{1,20}$',
      title: 'title must be a string, 1-300 characters after trim',
      subreddit: 'subreddit must match ^[A-Za-z0-9_]{3,21}$',
      selftext: 'selftext, if given, must be a string of at most 2000 characters',
      ageHours: 'ageHours, if given, must be a finite number from 0 to 2160',
    });
  });
});
