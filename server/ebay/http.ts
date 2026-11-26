// eBay Browse API endpoints, the reason texts (spec "Failures") and how a search response is
// read. Nothing here logs, and no reason text ever contains a URL, a header, a key or a token.
import type { OutboundResult } from '../http/outbound.ts';
import { encodeTerm } from '../venues/links.ts';

export const TOKEN_URL = 'https://api.ebay.com/identity/v1/oauth2/token';
export const TOKEN_BODY = 'grant_type=client_credentials&scope=https%3A%2F%2Fapi.ebay.com%2Foauth%2Fapi_scope';
export const SEARCH_ENDPOINT = 'https://api.ebay.com/buy/browse/v1/item_summary/search';
export const MARKETPLACE_ID = 'EBAY_US';
export const SEARCH_LIMIT = 50;
export const SEARCH_FILTER = 'buyingOptions:{FIXED_PRICE}';
export const SEARCH_FIELDGROUPS = 'MATCHING_ITEMS,CATEGORY_REFINEMENTS';

export const REASON = {
  refused: 'eBay refused the request (HTTP 403)',
  rateLimited: 'eBay rate limit reached (HTTP 429)',
  timeout: 'eBay took too long to answer',
  network: "Couldn't reach eBay",
  unexpected: 'eBay returned an unexpected response',
  failed: 'eBay search failed unexpectedly',
} as const;

export const rejectedReason = (status: number): string => `eBay rejected the app keys (HTTP ${status})`;
export const httpReason = (status: number): string => `eBay returned HTTP ${status}`;

/** The reason for a non-2xx search status. 401 is the text used after the retry. */
export function statusReason(status: number): string {
  if (status === 401) return rejectedReason(401);
  if (status === 403) return REASON.refused;
  if (status === 429) return REASON.rateLimited;
  return httpReason(status);
}

/** The reason for a non-2xx token status: 400 and 401 mean the keys were rejected. */
export function tokenStatusReason(status: number): string {
  if (status === 400 || status === 401) return rejectedReason(status);
  return statusReason(status);
}

export const failureReason = (failure: 'timeout' | 'network'): string =>
  failure === 'timeout' ? REASON.timeout : REASON.network;

/** The "search eBay yourself" link: `https://www.ebay.com/sch/i.html?_nkw=<term>`. */
export function ebaySearchUrl(term: string): string {
  return `https://www.ebay.com/sch/i.html?_nkw=${encodeTerm(term)}`;
}

/** The Browse API search URL. Only the term goes in it. */
export function searchRequestUrl(term: string): string {
  const params = [
    `q=${encodeTerm(term)}`,
    `limit=${SEARCH_LIMIT}`,
    `filter=${encodeURIComponent(SEARCH_FILTER)}`,
    `fieldgroups=${encodeURIComponent(SEARCH_FIELDGROUPS)}`,
  ];
  return `${SEARCH_ENDPOINT}?${params.join('&')}`;
}

/** The parts of a search response the parser reads. */
export interface SearchBody { items: unknown[]; refinement: unknown }

export type EbayOutcome = { ok: true; body: SearchBody } | { ok: false; reason: string };

/** A transport answers one search for a term; `signal` aborts it at the deadline. */
export interface EbayTransport {
  search(term: string, signal: AbortSignal): Promise<EbayOutcome>;
}

/**
 * The body of a 2xx search response, or the reason it is not one. The JSON must be an object;
 * `itemSummaries`, when present, must be an array (eBay omits it when nothing matched).
 */
export function readSearchResult(result: OutboundResult): EbayOutcome {
  if (!result.ok) return { ok: false, reason: failureReason(result.failure) };
  const { status, json } = result.response;
  if (status < 200 || status > 299) return { ok: false, reason: statusReason(status) };
  if (typeof json !== 'object' || json === null || Array.isArray(json)) return { ok: false, reason: REASON.unexpected };
  const { itemSummaries, refinement } = json as { itemSummaries?: unknown; refinement?: unknown };
  if (itemSummaries !== undefined && !Array.isArray(itemSummaries)) return { ok: false, reason: REASON.unexpected };
  return { ok: true, body: { items: itemSummaries ?? [], refinement } };
}
