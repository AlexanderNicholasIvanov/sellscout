import type { BuyersResult, EbayResult, SearchFn, SearchInput, Venue, VenueSearchFn, VenueSearchResult } from './types.ts';
import { ebaySearchUrl, REASON as EBAY_REASON } from './ebay/http.ts';
import type { EbaySearchFn, EbaySearchOutput } from './ebay/index.ts';
import { buyerTerm } from './reddit/index.ts';
import type { BuyerSearchFn, BuyerSearchOutput } from './reddit/index.ts';
import { buyerLinks } from './reddit/links.ts';
import { claudeNotice, REASON as CLAUDE_REASON } from './claude/planner.ts';
import type { ClaudePicks, Planner } from './claude/types.ts';

export const BUYER_SEARCH_FAILED = 'Reddit search failed unexpectedly';
export const EBAY_SEARCH_FAILED = EBAY_REASON.failed;

/** Logs the stack only: never the item, the location or any key. */
function logError(err: unknown, placeholder: string): void {
  console.error(err instanceof Error ? (err.stack ?? err.message) : placeholder);
}

/** The buyer search; a throw becomes the unexpected-failure result. Never rejects. */
async function safeBuyers(
  deps: { buyers: BuyerSearchFn },
  input: SearchInput,
  context: VenueSearchResult['context'],
  picks: ClaudePicks | undefined,
): Promise<BuyerSearchOutput> {
  try {
    const query = { item: input.item, windowDays: input.window, delivery: input.delivery, context };
    return await deps.buyers(picks ? { ...query, term: picks.searchTerm } : query);
  } catch (err) {
    logError(err, 'Non-error value thrown by the buyer search');
    const term = picks?.searchTerm || buyerTerm(input.item);
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
async function safeEbay(deps: { ebay: EbaySearchFn }, input: SearchInput, picks: ClaudePicks | undefined): Promise<EbaySearchOutput> {
  try {
    const query = { item: input.item, delivery: input.delivery };
    return await deps.ebay(picks ? { ...query, term: picks.searchTerm } : query);
  } catch (err) {
    logError(err, 'Non-error value thrown by the eBay search');
    const term = picks?.searchTerm || buyerTerm(input.item);
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

/** Claude's picks, or the failure notice. A planner that throws anyway is an unexpected error. */
async function safePlan(planner: Planner | undefined, item: string): Promise<{ picks?: ClaudePicks; notice?: string }> {
  if (!planner) return {};
  try {
    const outcome = await planner(item);
    return outcome.ok ? { picks: outcome.picks } : { notice: claudeNotice(outcome.reason) };
  } catch (err) {
    logError(err, 'Non-error value thrown by the Claude planner');
    return { notice: claudeNotice(CLAUDE_REASON.unexpected) };
  }
}

/**
 * The /api/search service: the Claude plan (when there is a planner), then the venue search with
 * the picks, then the buyer search (with the venue context) and the eBay search side by side,
 * both on Claude's term. A Claude failure gives the catalog result plus one notice. The context
 * never reaches the response, and neither a buyer-search nor an eBay-search error fails the request.
 */
export function createSearchService(deps: {
  venues: VenueSearchFn;
  buyers: BuyerSearchFn;
  ebay: EbaySearchFn;
  /** Unset = Claude off: the catalog result, no notice. */
  planner?: Planner;
}): SearchFn {
  return async (input) => {
    const { picks, notice } = await safePlan(deps.planner, input.item);
    const { plan, venues, notices: venueNotices, context } = picks ? deps.venues(input, picks) : deps.venues(input);
    const [buyerOutput, ebayOutput] = await Promise.all([
      safeBuyers(deps, input, context, picks),
      safeEbay(deps, input, picks),
    ]);
    // Only an `ok` eBay search adds the category venue, and never for local-only delivery.
    const category = ebayOutput.ebay.status === 'ok' && input.delivery !== 'local' ? ebayOutput.categoryVenue : undefined;
    return {
      plan,
      venues: withCategoryVenue(venues, category),
      buyers: buyerOutput.buyers,
      ebay: ebayOutput.ebay,
      notices: [...(notice ? [notice] : []), ...venueNotices, ...buyerOutput.notices],
    };
  };
}
