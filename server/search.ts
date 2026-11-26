import type { BuyersResult, EbayResult, SearchFn, SearchInput, Venue, VenueSearchFn, VenueSearchResult } from './types.ts';
import { ebaySearchUrl, REASON as EBAY_REASON } from './ebay/http.ts';
import type { EbaySearchFn, EbaySearchOutput } from './ebay/index.ts';
import { buyerTerm } from './reddit/index.ts';
import type { BuyerSearchFn, BuyerSearchOutput } from './reddit/index.ts';
import { buyerLinks } from './reddit/links.ts';

export const BUYER_SEARCH_FAILED = 'Reddit search failed unexpectedly';
export const EBAY_SEARCH_FAILED = EBAY_REASON.failed;

/** Logs the stack only: never the item, the location or any key. */
function logError(err: unknown, placeholder: string): void {
  console.error(err instanceof Error ? (err.stack ?? err.message) : placeholder);
}

/** The buyer search; a throw becomes the unexpected-failure result. Never rejects. */
async function safeBuyers(deps: { buyers: BuyerSearchFn }, input: SearchInput, context: VenueSearchResult['context']): Promise<BuyerSearchOutput> {
  try {
    return await deps.buyers({ item: input.item, windowDays: input.window, delivery: input.delivery, context });
  } catch (err) {
    logError(err, 'Non-error value thrown by the buyer search');
    const term = buyerTerm(input.item);
    const buyers: BuyersResult = {
      status: 'unavailable',
      reason: BUYER_SEARCH_FAILED,
      term,
      windowDays: input.window,
      posts: [],
      // The look-yourself links are shown in every status, this one included.
      links: buyerLinks(term, input.window, input.delivery, context),
    };
    return { buyers, notices: [] };
  }
}

/** The eBay search; a throw becomes the unexpected-failure result. Never rejects. */
async function safeEbay(deps: { ebay: EbaySearchFn }, input: SearchInput): Promise<EbaySearchOutput> {
  try {
    return await deps.ebay({ item: input.item, delivery: input.delivery });
  } catch (err) {
    logError(err, 'Non-error value thrown by the eBay search');
    const term = buyerTerm(input.item);
    const ebay: EbayResult = { status: 'unavailable', reason: EBAY_SEARCH_FAILED, term, listings: [], searchUrl: ebaySearchUrl(term) };
    return { ebay };
  }
}

/** The venues with the eBay category venue right after the `ebay` venue, or first when that is absent. */
export function withCategoryVenue(venues: Venue[], venue: Venue | undefined): Venue[] {
  if (!venue) return venues;
  const at = venues.findIndex((existing) => existing.id === 'ebay') + 1;
  return [...venues.slice(0, at), venue, ...venues.slice(at)];
}

/**
 * The /api/search service: the venue search, then the buyer search (with the venue context) and
 * the eBay search side by side. The context never reaches the response, and neither a
 * buyer-search nor an eBay-search error fails the request.
 */
export function createSearchService(deps: { venues: VenueSearchFn; buyers: BuyerSearchFn; ebay: EbaySearchFn }): SearchFn {
  return async (input) => {
    const { plan, venues, notices: venueNotices, context } = deps.venues(input);
    const [buyerOutput, ebayOutput] = await Promise.all([safeBuyers(deps, input, context), safeEbay(deps, input)]);
    // Only an `ok` eBay search adds the category venue, and never for local-only delivery.
    const category = ebayOutput.ebay.status === 'ok' && input.delivery !== 'local' ? ebayOutput.categoryVenue : undefined;
    return {
      plan,
      venues: withCategoryVenue(venues, category),
      buyers: buyerOutput.buyers,
      ebay: ebayOutput.ebay,
      notices: [...venueNotices, ...buyerOutput.notices],
    };
  };
}
