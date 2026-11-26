// One HTTP request to Reddit with a 10 s timeout, and the reason texts (spec "Status and reasons").
// Nothing here logs, and no reason text ever contains a URL, a header or a key.

export const REQUEST_TIMEOUT_MS = 10_000;

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
export class RequestTimeoutError extends Error {
  constructor() {
    super(REASON.timeout);
    this.name = 'RequestTimeoutError';
  }
}

export interface HttpResponse {
  status: number;
  headers: Headers;
  /** The parsed body; `undefined` when the body is not JSON. */
  json: unknown;
}

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
  if (signal.aborted) return { ok: false, reason: REASON.network };
  const controller = new AbortController();
  const onAbort = (): void => controller.abort();
  signal.addEventListener('abort', onAbort, { once: true });
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new RequestTimeoutError());
    }, timeoutMs);
  });
  const work = (async () => {
    const res = await fetchFn(url, { ...init, signal: controller.signal });
    const text = await res.text();
    return { res, text };
  })();
  // When the timeout wins, the abandoned request must not become an unhandled rejection.
  work.catch(() => undefined);
  try {
    const { res, text } = await Promise.race([work, timeout]);
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      json = undefined;
    }
    return { ok: true, response: { status: res.status, headers: res.headers, json } };
  } catch (err) {
    return { ok: false, reason: err instanceof RequestTimeoutError ? REASON.timeout : REASON.network };
  } finally {
    clearTimeout(timer);
    signal.removeEventListener('abort', onAbort);
  }
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
