import type { BuyersResult, EbayResult, SearchFn, VenueSearchFn } from './types.ts';
import { buyerTerm } from './reddit/index.ts';
import type { BuyerSearchFn, BuyerSearchOutput } from './reddit/index.ts';
import { buyerLinks } from './reddit/links.ts';

export const BUYER_SEARCH_FAILED = 'Reddit search failed unexpectedly';

/**
 * The /api/search service: the venue search, then the buyer search with the venue context.
 * The context never reaches the response, and a buyer-search error never fails the request.
 */
export function createSearchService(deps: { venues: VenueSearchFn; buyers: BuyerSearchFn }): SearchFn {
  return async (input) => {
    const { plan, venues, notices: venueNotices, context } = deps.venues(input);
    let output: BuyerSearchOutput;
    try {
      output = await deps.buyers({ item: input.item, windowDays: input.window, delivery: input.delivery, context });
    } catch (err) {
      // Log the stack only: never the item, the location or any key.
      console.error(err instanceof Error ? (err.stack ?? err.message) : 'Non-error value thrown by the buyer search');
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
      output = { buyers, notices: [] };
    }
    // Contract stub (run 3 wave 0): u1 replaces this with the real eBay search.
    const term = buyerTerm(input.item);
    const ebay: EbayResult = {
      status: 'disabled',
      term,
      listings: [],
      searchUrl: `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(term)}`,
    };
    return { plan, venues, buyers: output.buyers, ebay, notices: [...venueNotices, ...output.notices] };
  };
}
