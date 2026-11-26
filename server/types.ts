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

export interface SearchInput { item: string; location?: string; delivery: Delivery }

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
export interface SearchResult { plan: SearchPlan; venues: Venue[]; notices: string[] }
export type SearchFn = (input: SearchInput) => SearchResult;

export interface StatusResponse { version: string }
export interface ErrorResponse { error: string }
