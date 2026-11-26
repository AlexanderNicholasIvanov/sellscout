// One HTTP request to Reddit with a 10 s timeout, and the reason texts (spec "Status and reasons").
// Nothing here logs, and no reason text ever contains a URL, a header or a key.

import { OutboundTimeoutError, REQUEST_TIMEOUT_MS, sendRequest } from '../http/outbound.ts';
import type { HttpResponse } from '../http/outbound.ts';

export { REQUEST_TIMEOUT_MS } from '../http/outbound.ts';

export const REASON = {
  blocked: 'Reddit blocked the request (HTTP 403)',
  rejected: 'Reddit rejected the app credentials (HTTP 401)',
  rateLimited: 'Reddit rate limit reached (HTTP 429)',
  timeout: 'Reddit did not answer within 10 s',
  network: "Couldn't reach Reddit",
  unexpected: 'Unexpected response from Reddit',
  deadline: 'Reddit did not answer within 25 s',
} as const;

export const httpReason = (status: number): string => `Reddit returned HTTP ${status}`;
export const signInFailed = (reason: string): string => `Reddit sign-in failed (${reason})`;
export const coolDownReason = (msLeft: number): string =>
  `Reddit rate limit reached; try again in ${Math.ceil(msLeft / 1000)} s`;

/** The reason for a non-2xx status. 401 is the text used after the retry. */
export function statusReason(status: number): string {
  if (status === 401) return REASON.rejected;
  if (status === 403) return REASON.blocked;
  if (status === 429) return REASON.rateLimited;
  return httpReason(status);
}

/** Thrown (or raised by the fixture transport) when a request runs out of time. */
export class RequestTimeoutError extends OutboundTimeoutError {
  constructor() {
    super(REASON.timeout);
    this.name = 'RequestTimeoutError';
  }
}

export type { HttpResponse } from '../http/outbound.ts';

export type HttpResult = { ok: true; response: HttpResponse } | { ok: false; reason: string };

/**
 * Sends one request and reads its body. Fails with the timeout reason after `timeoutMs`, with
 * the network reason when fetch throws (including when `signal` aborts it). Never throws.
 */
export async function send(
  fetchFn: typeof globalThis.fetch,
  url: string,
  init: RequestInit,
  signal: AbortSignal,
  timeoutMs = REQUEST_TIMEOUT_MS,
): Promise<HttpResult> {
  const result = await sendRequest(fetchFn, url, init, signal, timeoutMs);
  if (result.ok) return result;
  return { ok: false, reason: result.failure === 'timeout' ? REASON.timeout : REASON.network };
}

/** The outcome of one search request, as the buyer search sees it. */
export type SearchOutcome =
  | { ok: true; children: unknown[]; stop: boolean }
  | { ok: false; reason: string; stop: boolean };

/** A buyer-search request: the search URL, plus a signal that aborts it at the deadline. */
export interface Transport {
  search(url: string, signal: AbortSignal): Promise<SearchOutcome>;
}

/** The listing children of a 2xx Reddit listing, or the reason it is not one. */
export function readListing(result: HttpResult): { ok: true; children: unknown[] } | { ok: false; reason: string } {
  if (!result.ok) return result;
  const { status, json } = result.response;
  if (status < 200 || status > 299) return { ok: false, reason: statusReason(status) };
  const data = typeof json === 'object' && json !== null ? (json as { data?: unknown }).data : undefined;
  const children = typeof data === 'object' && data !== null ? (data as { children?: unknown }).children : undefined;
  return Array.isArray(children) ? { ok: true, children } : { ok: false, reason: REASON.unexpected };
}
