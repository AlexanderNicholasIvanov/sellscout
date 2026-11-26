// One outbound HTTP request with a timeout, shared by the Reddit and eBay sources. It returns
// the status, the headers and the parsed JSON body, or why the request failed. Never throws and
// never logs, so no URL, header or key can leak from here.

export const REQUEST_TIMEOUT_MS = 10_000;

/** Raised when a request runs out of time (also thrown by the fixture transports to simulate it). */
export class OutboundTimeoutError extends Error {
  constructor(message = 'Request timed out') {
    super(message);
    this.name = 'OutboundTimeoutError';
  }
}

export interface HttpResponse {
  status: number;
  headers: Headers;
  /** The parsed body; `undefined` when the body is not JSON. */
  json: unknown;
}

export type OutboundResult = { ok: true; response: HttpResponse } | { ok: false; failure: 'timeout' | 'network' };

/**
 * Sends one request and reads its body. Fails with `timeout` after `timeoutMs` (or when fetch
 * throws an OutboundTimeoutError), with `network` when fetch throws anything else (including
 * when `signal` aborts it).
 */
export async function sendRequest(
  fetchFn: typeof globalThis.fetch,
  url: string,
  init: RequestInit,
  signal: AbortSignal,
  timeoutMs = REQUEST_TIMEOUT_MS,
): Promise<OutboundResult> {
  if (signal.aborted) return { ok: false, failure: 'network' };
  const controller = new AbortController();
  const onAbort = (): void => controller.abort();
  signal.addEventListener('abort', onAbort, { once: true });
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new OutboundTimeoutError());
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
    return { ok: false, failure: err instanceof OutboundTimeoutError ? 'timeout' : 'network' };
  } finally {
    clearTimeout(timer);
    signal.removeEventListener('abort', onAbort);
  }
}
