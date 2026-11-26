// Fixture mode: answers buyer-search requests from a fixture store (default: the built-in
// FIXTURE_POSTS) as Reddit listing JSON.
// No network, no token, no limiter spacing or cool-down. The responses go through the same
// parsing as real ones, so the reasons and the classifier are the real code paths.
import { readListing, RequestTimeoutError, send } from '../http.ts';
import type { SearchOutcome, Transport } from '../http.ts';
import { FIXTURE_POSTS } from './posts.ts';
import type { FixturePost } from './posts.ts';
import { createFixtureStore } from './store.ts';
import type { FixtureStore } from './store.ts';

const slug = (title: string): string =>
  title.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 50);

/** A fixture post as a Reddit `t3` listing child, aged relative to `nowMs`. */
export function toChild(post: FixturePost, nowMs: number): { kind: 't3'; data: Record<string, unknown> } {
  return {
    kind: 't3',
    data: {
      id: post.id,
      name: `t3_${post.id}`,
      title: post.title,
      selftext: post.selftext,
      subreddit: post.subreddit,
      author: post.author,
      created_utc: Math.floor(nowMs / 1000) - post.ageHours * 3600,
      score: post.score,
      num_comments: post.numComments,
      permalink: post.permalink ?? `/r/${post.subreddit}/comments/${post.id}/${slug(post.title)}/`,
      over_18: post.over18 === true,
      stickied: post.stickied === true,
    },
  };
}

/** Listing JSON for a request path: `/search` gets every post, `/r/<sub>/search` that subreddit's. */
export function fixtureListing(pathname: string, nowMs: number, posts: readonly FixturePost[] = FIXTURE_POSTS): unknown {
  const sub = /^\/r\/([^/]+)\/search\/?$/.exec(pathname)?.[1]?.toLowerCase();
  const chosen = sub === undefined ? posts : posts.filter((post) => post.subreddit.toLowerCase() === sub);
  const children = [...chosen].sort((a, b) => a.ageHours - b.ageHours).map((post) => toChild(post, nowMs));
  return { kind: 'Listing', data: { after: null, before: null, dist: children.length, children } };
}

const HTML_PAGE = '<!doctype html><html><body>blocked</body></html>';
const html = (status: number): Response =>
  new Response(HTML_PAGE, { status, headers: { 'Content-Type': 'text/html; charset=utf-8' } });

function wait(ms: number, signal: AbortSignal | null | undefined): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        reject(new Error('aborted'));
      },
      { once: true },
    );
  });
}

/**
 * A stand-in for `fetch` that serves the fixture data. Terms containing `reddit-403`,
 * `reddit-429` or `reddit-html` get that response; `reddit-timeout` fails at once with the
 * timeout error. Every answer waits `delayMs` first. The posts are read from `store` at request
 * time, so posts added after creation are served; without a store a fresh one is used.
 */
export function createFixtureFetch(delayMs: number, store: FixtureStore = createFixtureStore()): typeof globalThis.fetch {
  return async (input, init) => {
    await wait(delayMs, init?.signal);
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    const q = (url.searchParams.get('q') ?? '').toLowerCase();
    if (q.includes('reddit-timeout')) throw new RequestTimeoutError();
    if (q.includes('reddit-403')) return html(403);
    if (q.includes('reddit-429')) return html(429);
    if (q.includes('reddit-html')) return html(200);
    return new Response(JSON.stringify(fixtureListing(url.pathname, Date.now(), store.posts())), {
      status: 200,
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
    });
  };
}

export function createFixtureTransport(delayMs: number, store?: FixtureStore): Transport {
  const fixtureFetch = createFixtureFetch(delayMs, store);
  return {
    async search(url: string, signal: AbortSignal): Promise<SearchOutcome> {
      // The 10 s timeout still applies, so a long SELLSCOUT_FIXTURE_DELAY_MS behaves like a slow Reddit.
      const result = await send(fixtureFetch, url, { method: 'GET' }, signal);
      const listing = readListing(result);
      return listing.ok ? { ok: true, children: listing.children, stop: false } : { ...listing, stop: false };
    },
  };
}
