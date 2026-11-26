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
}

export interface SearchPlan { source: 'catalog'; categories: { id: string; name: string }[]; searchTerm: string }

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
export interface SearchResult { plan: SearchPlan; venues: Venue[]; buyers: BuyersResult; notices: string[] }
export type SearchFn = (input: SearchInput) => Promise<SearchResult>;

/** What the venue search hands the buyer search; never sent to the browser. */
export interface BuyerContext { subreddits: string[]; craigslist?: string }
export type VenueSearchResult = Omit<SearchResult, 'buyers'> & { context: BuyerContext };
export type VenueSearchFn = (input: SearchInput) => VenueSearchResult;

export interface StatusResponse { version: string; redditAuth: boolean; fixtures: boolean }
export interface ErrorResponse { error: string }
/** POST /api/__fixtures (fixture mode only): the fixture post count after the change. */
export interface FixturesResponse { ok: true; posts: number }
