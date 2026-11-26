import type {
  BuyersResult,
  BuyerWindow,
  Delivery,
  ErrorResponse,
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

function isBuyersResult(value: unknown): value is BuyersResult {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Partial<BuyersResult>;
  return (
    typeof v.status === 'string' &&
    Array.isArray(v.posts) &&
    Array.isArray(v.links) &&
    typeof v.term === 'string' &&
    typeof v.windowDays === 'number'
  );
}

function isSearchResult(value: unknown): value is SearchResult {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Partial<SearchResult>;
  return (
    typeof v.plan === 'object' &&
    v.plan !== null &&
    Array.isArray(v.plan.categories) &&
    typeof v.plan.searchTerm === 'string' &&
    Array.isArray(v.venues) &&
    isBuyersResult(v.buyers) &&
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
  return typeof v.version === 'string' && typeof v.redditAuth === 'boolean' && typeof v.fixtures === 'boolean';
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
