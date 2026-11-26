import type { BuyersResult, SearchFn, VenueSearchFn } from './types.ts';
import { buyerTerm } from './reddit/index.ts';
import type { BuyerSearchFn, BuyerSearchOutput } from './reddit/index.ts';

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
      const buyers: BuyersResult = {
        status: 'unavailable',
        reason: BUYER_SEARCH_FAILED,
        term: buyerTerm(input.item),
        windowDays: input.window,
        posts: [],
        links: [],
      };
      output = { buyers, notices: [] };
    }
    return { plan, venues, buyers: output.buyers, notices: [...venueNotices, ...output.notices] };
  };
}
