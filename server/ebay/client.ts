// The keyed eBay transport: an application token (client credentials), cached until 60 s before
// it expires and shared by concurrent searches, and the Browse API search with one 401 re-token
// and retry. The keys and the token stay in this closure: they are never logged or returned.
import type { EbayConfig } from '../config.ts';
import { sendRequest } from '../http/outbound.ts';
import type { OutboundResult } from '../http/outbound.ts';
import {
  failureReason,
  MARKETPLACE_ID,
  readSearchResult,
  REASON,
  searchRequestUrl,
  TOKEN_BODY,
  TOKEN_URL,
  tokenStatusReason,
} from './http.ts';
import type { EbayOutcome, EbayTransport } from './http.ts';

/** A token is used until this long before it expires. */
export const TOKEN_MARGIN_MS = 60_000;
const DEFAULT_EXPIRES_IN_S = 7200;

export interface EbayClientOptions {
  ebay: EbayConfig;
  fetch: typeof globalThis.fetch;
  /** The clock for token expiry. Default: Date.now. */
  now?: () => number;
}

type TokenResult = { ok: true; token: string } | { ok: false; reason: string };

export function createEbayClient(options: EbayClientOptions): EbayTransport {
  // Late-bound: never capture globalThis.fetch (the fixture-mode guard is installed after imports).
  const fetchFn: typeof globalThis.fetch = (input, init) => options.fetch(input, init);
  const now = options.now ?? (() => Date.now());
  const basic = `Basic ${Buffer.from(`${options.ebay.clientId}:${options.ebay.clientSecret}`).toString('base64')}`;
  // The token request is shared, so one search's deadline must not abort it; it has its own 10 s timeout.
  const noAbort = new AbortController().signal;

  let cached: { token: string; expiresAt: number } | undefined;
  let pending: Promise<TokenResult> | undefined;

  async function requestToken(): Promise<TokenResult> {
    const startedAt = now();
    const result = await sendRequest(
      fetchFn,
      TOKEN_URL,
      {
        method: 'POST',
        headers: {
          Authorization: basic,
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'application/json',
        },
        body: TOKEN_BODY,
      },
      noAbort,
    );
    if (!result.ok) return { ok: false, reason: failureReason(result.failure) };
    const { status, json } = result.response;
    if (status < 200 || status > 299) return { ok: false, reason: tokenStatusReason(status) };
    const body = typeof json === 'object' && json !== null ? (json as Record<string, unknown>) : {};
    const token = body.access_token;
    if (typeof token !== 'string' || token === '') return { ok: false, reason: REASON.unexpected };
    const expiresIn =
      typeof body.expires_in === 'number' && Number.isFinite(body.expires_in) && body.expires_in > 0
        ? body.expires_in
        : DEFAULT_EXPIRES_IN_S;
    cached = { token, expiresAt: startedAt + expiresIn * 1000 - TOKEN_MARGIN_MS };
    return { ok: true, token };
  }

  /** The cached token while it is fresh; otherwise one token request shared by every waiting search. */
  function getToken(): Promise<TokenResult> {
    if (cached && now() < cached.expiresAt) return Promise.resolve({ ok: true, token: cached.token });
    cached = undefined;
    pending ??= requestToken().finally(() => {
      pending = undefined;
    });
    return pending;
  }

  function searchOnce(url: string, token: string, signal: AbortSignal): Promise<OutboundResult> {
    return sendRequest(
      fetchFn,
      url,
      {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${token}`,
          'X-EBAY-C-MARKETPLACE-ID': MARKETPLACE_ID,
          Accept: 'application/json',
        },
      },
      signal,
    );
  }

  async function search(term: string, signal: AbortSignal): Promise<EbayOutcome> {
    const url = searchRequestUrl(term);
    let token = await getToken();
    if (!token.ok) return token;
    // The deadline may have passed while the token came in: then nothing more is sent.
    if (signal.aborted) return { ok: false, reason: REASON.timeout };
    let result = await searchOnce(url, token.token, signal);
    if (result.ok && result.response.status === 401) {
      // A 401 drops the cached token (unless another search already replaced it), fetches a
      // token again once and retries the search once.
      if (cached?.token === token.token) cached = undefined;
      token = await getToken();
      if (!token.ok) return token;
      if (signal.aborted) return { ok: false, reason: REASON.timeout };
      result = await searchOnce(url, token.token, signal);
    }
    return readSearchResult(result);
  }

  return { search };
}
