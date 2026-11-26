// The eBay search: "Similar listings on eBay" and the "eBay - <category>" venue.
// - No keys (and fixtures off): `disabled`, no request, the "search eBay yourself" link only.
// - Keys: the keyed client (application token, Browse API) from client.ts.
// - Fixture mode: the in-repo fixture transport; `options.fetch` is never called.
// Only the term is sent to eBay: never the location, the delivery choice or anything derived from them.
import { hasEbayKeys } from '../config.ts';
import type { AppConfig } from '../config.ts';
import { buyerTerm } from '../reddit/term.ts';
import type { Delivery, EbayResult, Venue } from '../types.ts';
import { createEbayClient } from './client.ts';
import { createEbayFixtureTransport } from './fixtures/transport.ts';
import { ebaySearchUrl, REASON } from './http.ts';
import type { EbayOutcome, EbayTransport } from './http.ts';
import { categoryVenue, parseItems } from './parse.ts';

export interface EbayQuery { item: string; delivery: Delivery }
export interface EbaySearchOutput { ebay: EbayResult; categoryVenue?: Venue }
export type EbaySearchFn = (query: EbayQuery) => Promise<EbaySearchOutput>;
export interface EbaySearchOptions {
  config: AppConfig;
  /** Used for eBay requests when keys are set. Never called when disabled or in fixture mode. */
  fetch: typeof globalThis.fetch;
  /** The clock for token expiry. Default: Date.now. */
  now?: () => number;
}

/** The whole eBay search (token and search request) must finish within this. */
export const EBAY_DEADLINE_MS = 20_000;

/** The transport's outcome, or the timeout reason once the deadline passes (the search is aborted). */
async function withDeadline(transport: EbayTransport, term: string): Promise<EbayOutcome> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<EbayOutcome>((resolve) => {
    timer = setTimeout(() => {
      controller.abort();
      resolve({ ok: false, reason: REASON.timeout });
    }, EBAY_DEADLINE_MS);
  });
  const work = transport.search(term, controller.signal);
  // When the deadline wins, a late rejection must not become an unhandled rejection.
  work.catch(() => undefined);
  try {
    return await Promise.race([work, deadline]);
  } finally {
    clearTimeout(timer);
  }
}

export function createEbaySearch(options: EbaySearchOptions): EbaySearchFn {
  const { config } = options;
  // One transport per instance: the token cache lasts for the server process.
  const transport: EbayTransport | undefined = config.fixtures
    ? createEbayFixtureTransport(config.fixtureDelayMs)
    : hasEbayKeys(config)
      ? createEbayClient({ ebay: config.ebay, fetch: options.fetch, ...(options.now ? { now: options.now } : {}) })
      : undefined;

  return async ({ item, delivery }) => {
    const term = buyerTerm(item);
    const searchUrl = ebaySearchUrl(term);
    if (!transport) return { ebay: { status: 'disabled', term, listings: [], searchUrl } };

    const outcome = await withDeadline(transport, term);
    if (!outcome.ok) {
      return { ebay: { status: 'unavailable', reason: outcome.reason, term, listings: [], searchUrl } };
    }
    const { listings, priceRange } = parseItems(outcome.body.items);
    const ebay: EbayResult = { status: 'ok', term, listings, ...(priceRange ? { priceRange } : {}), searchUrl };
    // Delivery `local` hides ship-only venues, this one included.
    const venue = delivery === 'local' ? undefined : categoryVenue(outcome.body.refinement, term);
    return venue ? { ebay, categoryVenue: venue } : { ebay };
  };
}
