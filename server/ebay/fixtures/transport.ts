// Fixture mode: answers eBay searches from the in-repo fixture data as Browse API JSON.
// No network and no token. The responses go through the same reading and parsing as real ones,
// so the reasons and the listings are the real code paths.
import { OutboundTimeoutError, sendRequest } from '../../http/outbound.ts';
import { readSearchResult, searchRequestUrl } from '../http.ts';
import type { EbayOutcome, EbayTransport } from '../http.ts';
import { fixtureSearchBody } from './items.ts';

const HTML_PAGE = '<!doctype html><html><body>blocked</body></html>';
const html = (status: number): Response =>
  new Response(HTML_PAGE, { status, headers: { 'Content-Type': 'text/html; charset=utf-8' } });

function wait(ms: number, signal: AbortSignal | null | undefined): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(new Error('aborted'));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/**
 * A stand-in for `fetch` that serves the fixture data for the `q` of a search URL. Terms
 * containing `ebay-401`, `ebay-403`, `ebay-429`, `ebay-500` or `ebay-html` get that response;
 * `ebay-timeout` fails at once with the timeout error. Every answer waits `delayMs` first.
 */
export function createEbayFixtureFetch(delayMs: number): typeof globalThis.fetch {
  return async (input, init) => {
    await wait(delayMs, init?.signal);
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    const q = (url.searchParams.get('q') ?? '').toLowerCase();
    if (q.includes('ebay-timeout')) throw new OutboundTimeoutError();
    if (q.includes('ebay-401')) return html(401);
    if (q.includes('ebay-403')) return html(403);
    if (q.includes('ebay-429')) return html(429);
    if (q.includes('ebay-500')) return html(500);
    if (q.includes('ebay-html')) return html(200);
    return new Response(JSON.stringify(fixtureSearchBody(q)), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };
}

export function createEbayFixtureTransport(delayMs: number): EbayTransport {
  const fixtureFetch = createEbayFixtureFetch(delayMs);
  return {
    async search(term: string, signal: AbortSignal): Promise<EbayOutcome> {
      const url = searchRequestUrl(term);
      // The 10 s request timeout still applies, so a long SELLSCOUT_FIXTURE_DELAY_MS behaves like a slow eBay.
      let result = await sendRequest(fixtureFetch, url, { method: 'GET' }, signal);
      // Like the keyed client, a 401 is retried once (there is no token to refresh).
      if (result.ok && result.response.status === 401) result = await sendRequest(fixtureFetch, url, { method: 'GET' }, signal);
      return readSearchResult(result);
    },
  };
}
