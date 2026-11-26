import type { Delivery, ErrorResponse, SearchInput, SearchResult } from '../server/types.ts';

export class SearchError extends Error {}

function isErrorResponse(value: unknown): value is ErrorResponse {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { error?: unknown }).error === 'string' &&
    (value as ErrorResponse).error !== ''
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
    Array.isArray(v.notices)
  );
}

/** Builds the request body; a blank location is omitted. */
export function buildSearchInput(item: string, location: string, delivery: Delivery): SearchInput {
  const input: SearchInput = { item: item.trim(), delivery };
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
