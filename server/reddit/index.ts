// The Reddit buyer search: "People looking for it".
// - No keys (and fixtures off): `disabled`, no request, look-yourself links only.
// - Keys: the signed-in client (app-only OAuth, rate limiter) from client.ts.
// - Fixture mode: the in-repo fixture transport; `options.fetch` is never called.
// Only the term and the context subreddits are sent; nothing derived from the location.
import { hasRedditKeys } from '../config.ts';
import type { AppConfig } from '../config.ts';
import type { BuyerContext, BuyersResult, BuyerWindow, Delivery } from '../types.ts';
import { buyerPosts } from './classify.ts';
import { createRedditClient } from './client.ts';
import { createFixtureTransport } from './fixtures/transport.ts';
import { REASON } from './http.ts';
import type { SearchOutcome, Transport } from './http.ts';
import { buyerLinks, searchUrls } from './links.ts';
import { buyerTerm } from './term.ts';

export { buyerTerm } from './term.ts';

export interface BuyerQuery { item: string; windowDays: BuyerWindow; delivery: Delivery; context: BuyerContext }
export interface BuyerSearchOutput { buyers: BuyersResult; notices: string[] }
export type BuyerSearchFn = (query: BuyerQuery) => Promise<BuyerSearchOutput>;
export interface BuyerSearchOptions {
  config: AppConfig;
  version: string;
  /** Used for Reddit requests when signed in. Never called when disabled or in fixture mode. */
  fetch: typeof globalThis.fetch;
}

export const SEARCH_DEADLINE_MS = 25_000;
export const NOTICE_PARTIAL = 'Some Reddit searches failed; results may be incomplete';
export const NOTICE_DEADLINE = 'Reddit took longer than 25 s; showing what finished';

const DEADLINE = Symbol('deadline');

type Success = Extract<SearchOutcome, { ok: true }>;
type Failure = Extract<SearchOutcome, { ok: false }>;

interface Run { outcomes: SearchOutcome[]; skipped: number; cut: boolean }

/** Runs the requests one after another until done, told to stop, or the 25 s deadline. */
async function runRequests(transport: Transport, urls: string[]): Promise<Run> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<typeof DEADLINE>((resolve) => {
    timer = setTimeout(() => {
      controller.abort();
      resolve(DEADLINE);
    }, SEARCH_DEADLINE_MS);
  });
  const run: Run = { outcomes: [], skipped: 0, cut: false };
  try {
    for (const [index, url] of urls.entries()) {
      const outcome = await Promise.race([transport.search(url, controller.signal), deadline]);
      if (outcome === DEADLINE) {
        run.cut = true;
        break;
      }
      run.outcomes.push(outcome);
      if (outcome.stop) {
        run.skipped = urls.length - index - 1;
        break;
      }
    }
  } finally {
    clearTimeout(timer);
  }
  return run;
}

export function createBuyerSearch(options: BuyerSearchOptions): BuyerSearchFn {
  const { config } = options;
  // One transport per instance: the token cache and the limiter last for the server process.
  const transport: Transport | undefined = config.fixtures
    ? createFixtureTransport(config.fixtureDelayMs)
    : hasRedditKeys(config)
      ? createRedditClient({ reddit: config.reddit, version: options.version, fetch: options.fetch })
      : undefined;

  return async ({ item, windowDays, delivery, context }) => {
    const term = buyerTerm(item);
    const links = buyerLinks(term, windowDays, delivery, context);
    const base = { term, windowDays, links };
    if (!transport) return { buyers: { status: 'disabled', ...base, posts: [] }, notices: [] };

    const run = await runRequests(transport, searchUrls(term, windowDays, context));
    const successes = run.outcomes.filter((outcome): outcome is Success => outcome.ok);
    const failures = run.outcomes.filter((outcome): outcome is Failure => !outcome.ok);

    if (successes.length === 0) {
      const reason = run.cut ? REASON.deadline : (failures[0]?.reason ?? REASON.unexpected);
      return { buyers: { status: 'unavailable', reason, ...base, posts: [] }, notices: [] };
    }
    const children = successes.flatMap((outcome) => outcome.children);
    const posts = buyerPosts(children, term, windowDays, Date.now());
    const notices: string[] = [];
    if (run.cut) notices.push(NOTICE_DEADLINE);
    if (failures.length > 0 || run.skipped > 0) notices.push(NOTICE_PARTIAL);
    return { buyers: { status: 'ok', ...base, posts }, notices };
  };
}
