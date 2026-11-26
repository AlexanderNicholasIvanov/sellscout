import type {
  BuyerPost,
  BuyersResult,
  BuyerWindow,
  Delivery,
  EbayListing,
  EbayResult,
  ErrorResponse,
  FallbackLink,
  PriceRange,
  SearchInput,
  SearchPlan,
  SearchResult,
  StatusResponse,
  Venue,
} from '../server/types.ts';

export const BUYER_WINDOWS: readonly BuyerWindow[] = [7, 30, 90];
export const DEFAULT_BUYER_WINDOW: BuyerWindow = 30;

export class SearchError extends Error {}

function isErrorResponse(value: unknown): value is ErrorResponse {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { error?: unknown }).error === 'string' &&
    (value as ErrorResponse).error !== ''
  );
}

const BUYER_STATUSES: readonly string[] = ['ok', 'unavailable', 'disabled'];

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isBuyerPost(value: unknown): value is BuyerPost {
  return (
    isObject(value) &&
    typeof value.id === 'string' &&
    typeof value.title === 'string' &&
    typeof value.subreddit === 'string' &&
    typeof value.author === 'string' &&
    typeof value.createdUtc === 'number' &&
    typeof value.score === 'number' &&
    typeof value.numComments === 'number' &&
    typeof value.snippet === 'string' &&
    typeof value.url === 'string'
  );
}

function isFallbackLink(value: unknown): value is FallbackLink {
  return isObject(value) && typeof value.label === 'string' && typeof value.url === 'string';
}

function isBuyersResult(value: unknown): value is BuyersResult {
  if (!isObject(value)) return false;
  return (
    typeof value.status === 'string' &&
    BUYER_STATUSES.includes(value.status) &&
    (value.reason === undefined || typeof value.reason === 'string') &&
    typeof value.term === 'string' &&
    typeof value.windowDays === 'number' &&
    (BUYER_WINDOWS as readonly number[]).includes(value.windowDays) &&
    Array.isArray(value.posts) &&
    value.posts.every(isBuyerPost) &&
    Array.isArray(value.links) &&
    value.links.every(isFallbackLink)
  );
}

const EBAY_STATUSES: readonly string[] = ['ok', 'unavailable', 'disabled'];

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isEbayListing(value: unknown): value is EbayListing {
  return (
    isObject(value) &&
    typeof value.id === 'string' &&
    typeof value.title === 'string' &&
    isFiniteNumber(value.price) &&
    typeof value.condition === 'string' &&
    typeof value.url === 'string'
  );
}

function isPriceRange(value: unknown): value is PriceRange {
  return (
    isObject(value) &&
    isFiniteNumber(value.count) &&
    isFiniteNumber(value.p25) &&
    isFiniteNumber(value.median) &&
    isFiniteNumber(value.p75)
  );
}

function isEbayResult(value: unknown): value is EbayResult {
  if (!isObject(value)) return false;
  return (
    typeof value.status === 'string' &&
    EBAY_STATUSES.includes(value.status) &&
    (value.reason === undefined || typeof value.reason === 'string') &&
    typeof value.term === 'string' &&
    typeof value.searchUrl === 'string' &&
    Array.isArray(value.listings) &&
    value.listings.every(isEbayListing) &&
    (value.priceRange === undefined || isPriceRange(value.priceRange)) &&
    // Fields that only go with one status: a reason only when unavailable, listings and a
    // range only when ok.
    (value.status === 'unavailable') === (typeof value.reason === 'string') &&
    (value.status === 'ok' || (value.listings.length === 0 && value.priceRange === undefined))
  );
}

const PLAN_SOURCES: readonly string[] = ['claude', 'catalog'];

function isSearchPlan(value: unknown): value is SearchPlan {
  return (
    isObject(value) &&
    typeof value.source === 'string' &&
    PLAN_SOURCES.includes(value.source) &&
    Array.isArray(value.categories) &&
    typeof value.searchTerm === 'string'
  );
}

const VENUE_KINDS: readonly string[] = ['marketplace', 'subreddit', 'forum', 'facebook', 'local-classifieds'];

const isStrings = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((entry) => typeof entry === 'string');

const isOptionalString = (value: unknown): boolean => value === undefined || typeof value === 'string';

/** Every field the venue row reads; `aiSuggested` is either absent or exactly `true`. */
function isVenue(value: unknown): value is Venue {
  return (
    isObject(value) &&
    typeof value.id === 'string' &&
    typeof value.name === 'string' &&
    typeof value.kind === 'string' &&
    VENUE_KINDS.includes(value.kind) &&
    typeof value.url === 'string' &&
    isOptionalString(value.searchUrl) &&
    isOptionalString(value.feeNote) &&
    typeof value.ships === 'boolean' &&
    typeof value.local === 'boolean' &&
    isStrings(value.tips) &&
    isStrings(value.why) &&
    isStrings(value.categoryIds) &&
    (value.aiSuggested === undefined || value.aiSuggested === true)
  );
}

export function isSearchResult(value: unknown): value is SearchResult {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Partial<SearchResult>;
  return (
    isSearchPlan(v.plan) &&
    Array.isArray(v.venues) &&
    v.venues.every(isVenue) &&
    isBuyersResult(v.buyers) &&
    isEbayResult(v.ebay) &&
    Array.isArray(v.notices)
  );
}

/** Builds the request body; a blank location is omitted. */
export function buildSearchInput(
  item: string,
  location: string,
  delivery: Delivery,
  window: BuyerWindow = DEFAULT_BUYER_WINDOW,
): SearchInput {
  const input: SearchInput = { item: item.trim(), delivery, window };
  const loc = location.trim();
  if (loc !== '') input.location = loc;
  return input;
}

/** POSTs to /api/search. Throws SearchError with a user-facing message on any failure. */
export async function search(input: SearchInput, signal?: AbortSignal): Promise<SearchResult> {
  let res: Response;
  try {
    res = await fetch('/api/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
      signal,
    });
  } catch (err) {
    throw new SearchError(err instanceof Error && err.message ? err.message : 'Network error');
  }

  let body: unknown = undefined;
  try {
    body = await res.json();
  } catch {
    // Not JSON; handled below.
  }

  if (!res.ok) {
    if (isErrorResponse(body)) throw new SearchError(body.error);
    throw new SearchError(res.statusText || `HTTP ${res.status}`);
  }
  if (!isSearchResult(body)) throw new SearchError('Unexpected response from server');
  return body;
}

/** A status body; `claude` may be missing (a server older than run 4) but not another type. */
function isStatusResponse(value: unknown): value is Omit<StatusResponse, 'claude'> & { claude?: boolean } {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Partial<StatusResponse>;
  return (
    typeof v.version === 'string' &&
    typeof v.redditAuth === 'boolean' &&
    typeof v.fixtures === 'boolean' &&
    typeof v.ebay === 'boolean' &&
    (v.claude === undefined || typeof v.claude === 'boolean')
  );
}

/**
 * GETs /api/status. Resolves to null on any failure or a malformed body; never throws. A body
 * without `claude` reads as `claude: false`.
 */
export async function status(signal?: AbortSignal): Promise<StatusResponse | null> {
  try {
    const res = await fetch('/api/status', { signal });
    if (!res.ok) return null;
    const body: unknown = await res.json();
    return isStatusResponse(body) ? { ...body, claude: body.claude === true } : null;
  } catch {
    return null;
  }
}
