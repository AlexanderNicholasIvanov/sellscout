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
  SearchResult,
  StatusResponse,
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
    (value.priceRange === undefined || isPriceRange(value.priceRange))
  );
}

export function isSearchResult(value: unknown): value is SearchResult {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Partial<SearchResult>;
  return (
    typeof v.plan === 'object' &&
    v.plan !== null &&
    Array.isArray(v.plan.categories) &&
    typeof v.plan.searchTerm === 'string' &&
    Array.isArray(v.venues) &&
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

function isStatusResponse(value: unknown): value is StatusResponse {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Partial<StatusResponse>;
  return (
    typeof v.version === 'string' &&
    typeof v.redditAuth === 'boolean' &&
    typeof v.fixtures === 'boolean' &&
    typeof v.ebay === 'boolean'
  );
}

/** GETs /api/status. Resolves to null on any failure or a malformed body; never throws. */
export async function status(signal?: AbortSignal): Promise<StatusResponse | null> {
  try {
    const res = await fetch('/api/status', { signal });
    if (!res.ok) return null;
    const body: unknown = await res.json();
    return isStatusResponse(body) ? body : null;
  } catch {
    return null;
  }
}
