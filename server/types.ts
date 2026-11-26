export type VenueKind = 'marketplace' | 'subreddit' | 'forum' | 'facebook' | 'local-classifieds';
export type Delivery = 'ship' | 'local' | 'both';

export interface Category { id: string; name: string; keywords: string[] }

export interface CatalogVenue {
  id: string;
  name: string;
  kind: VenueKind;
  url: string;                 // https URL of the board
  searchUrlTemplate?: string;  // https URL containing the literal "{q}"
  ships: boolean;
  local: boolean;
  feeNote?: string;
  tips: string[];
  categoryIds: string[];       // empty when general
  general?: boolean;           // applies to every item (eBay, Facebook Marketplace, Craigslist, OfferUp, Mercari)
}

export interface Catalog { reviewed: string; categories: Category[]; venues: CatalogVenue[] }

export interface Metro {
  id: string;
  name: string;               // "Seattle"
  state: string;              // "WA"
  aliases: string[];          // lower-case city names that map here, e.g. ["seattle", "bellevue", "tacoma"]
  zipPrefixes: string[];      // 3-digit ZIP prefixes, e.g. ["980", "981"]
  craigslist: string;         // subdomain, e.g. "seattle"
  buySellSubreddit?: string;  // name without r/, e.g. "SeattleBuySell" (only if real and active)
}

export type BuyerWindow = 7 | 30 | 90;
export interface SearchInput { item: string; location?: string; delivery: Delivery; window: BuyerWindow }

export interface Venue {
  id: string;
  name: string;
  kind: VenueKind;
  url: string;
  searchUrl?: string;
  ships: boolean;
  local: boolean;
  feeNote?: string;
  tips: string[];
  why: string[];
  categoryIds: string[];
  /** A subreddit Claude suggested that is not in the catalog: a plain board link, never searched. */
  aiSuggested?: true;
}

/** `claude` when Claude picked the categories (ANTHROPIC_API_KEY set or fixture mode), else `catalog`. */
export interface SearchPlan { source: 'claude' | 'catalog'; categories: { id: string; name: string }[]; searchTerm: string }

export interface BuyerPost {
  id: string; title: string; subreddit: string; author: string;
  createdUtc: number;   // seconds since epoch, as Reddit's created_utc
  score: number; numComments: number;
  snippet: string;      // plain text, <= 200 chars, '' when no body
  url: string;          // https://www.reddit.com + permalink
}
export interface FallbackLink { label: string; url: string }
export type BuyerStatus = 'ok' | 'unavailable' | 'disabled';
export interface BuyersResult {
  status: BuyerStatus; reason?: string;   // reason only when 'unavailable'
  term: string; windowDays: BuyerWindow; posts: BuyerPost[]; links: FallbackLink[];
}
export interface EbayListing {
  id: string;            // eBay itemId
  title: string;
  price: number;         // USD, 2 decimals
  condition: string;     // '' when eBay gives none
  url: string;           // https URL on an ebay.com host
}
/** Asking prices of active listings, USD, rounded to cents. */
export interface PriceRange { count: number; p25: number; median: number; p75: number }
export type EbayStatus = 'ok' | 'unavailable' | 'disabled';
export interface EbayResult {
  status: EbayStatus;
  reason?: string;            // only when 'unavailable'
  term: string;               // the eBay search term (= buyerTerm(item))
  listings: EbayListing[];    // at most 10
  priceRange?: PriceRange;    // only when 'ok' and at least 3 prices
  searchUrl: string;          // https://www.ebay.com/sch/i.html?_nkw=<term>, always set
}

export interface SearchResult { plan: SearchPlan; venues: Venue[]; buyers: BuyersResult; ebay: EbayResult; notices: string[] }
export type SearchFn = (input: SearchInput) => Promise<SearchResult>;

/** What the venue search hands the buyer search; never sent to the browser. */
export interface BuyerContext { subreddits: string[]; craigslist?: string }
export type VenueSearchResult = Omit<SearchResult, 'buyers' | 'ebay'> & { context: BuyerContext };
export type VenueSearchFn = (input: SearchInput) => VenueSearchResult;

export interface StatusResponse { version: string; redditAuth: boolean; fixtures: boolean; ebay: boolean; claude: boolean }
export interface ErrorResponse { error: string }
/** POST /api/__fixtures (fixture mode only): the fixture post count after the change. */
export interface FixturesResponse { ok: true; posts: number }
