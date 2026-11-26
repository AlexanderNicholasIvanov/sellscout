// Shared fakes for the eBay tests: configs, Browse API JSON and a recording fetch. No network.
import { vi } from 'vitest';
import type { AppConfig } from '../../server/config.ts';
import { readConfig } from '../../server/config.ts';
import { createEbaySearch } from '../../server/ebay/index.ts';
import type { EbaySearchFn } from '../../server/ebay/index.ts';
import { json } from '../reddit/helpers.ts';
import type { Call, Responder } from '../reddit/helpers.ts';

export { hang, json, settle } from '../reddit/helpers.ts';
export type { Call, Responder } from '../reddit/helpers.ts';

export const EBAY_ID = 'SENTINEL-EBAY-ID';
export const EBAY_SECRET = 'SENTINEL-EBAY-SECRET';
export const EBAY_TOKEN = 'SENTINEL-EBAY-TOKEN';
export const SENTINELS = [EBAY_ID, EBAY_SECRET, EBAY_TOKEN];

export const TOKEN_URL = 'https://api.ebay.com/identity/v1/oauth2/token';
export const SEARCH_PREFIX = 'https://api.ebay.com/buy/browse/v1/item_summary/search?';

/** A config with eBay keys (fixtures off) unless overridden. */
export function ebayConfig(overrides: Partial<AppConfig['ebay']> & { fixtures?: boolean } = {}): AppConfig {
  const { fixtures = false, ...ebay } = overrides;
  return { ...readConfig({}), fixtures, ebay: { clientId: EBAY_ID, clientSecret: EBAY_SECRET, ...ebay } };
}

/** An eBay search with no keys: always `disabled`, and its fetch must never be called. */
export function disabledEbay(): EbaySearchFn {
  return createEbaySearch({
    config: readConfig({}),
    fetch: () => Promise.reject(new Error('the disabled eBay search must not fetch')),
  });
}

export interface ItemData {
  itemId?: unknown;
  title?: unknown;
  price?: unknown;
  condition?: unknown;
  itemWebUrl?: unknown;
}

/** An itemSummaries[] entry priced in USD; any field can be overridden or set to undefined. */
export function item(id: string, value: string | number = '10.00', overrides: ItemData = {}): Record<string, unknown> {
  return {
    itemId: id,
    title: `Item ${id}`,
    price: { value, currency: 'USD' },
    condition: 'Used',
    itemWebUrl: `https://www.ebay.com/itm/${id}`,
    ...overrides,
  };
}

export function searchBody(items: unknown[], refinement?: unknown): Record<string, unknown> {
  return { total: items.length, itemSummaries: items, ...(refinement === undefined ? {} : { refinement }) };
}

export const tokenResponse = (token = EBAY_TOKEN, expiresIn: unknown = 7200): Response =>
  json({ access_token: token, token_type: 'Application Access Token', expires_in: expiresIn });

/**
 * A fetch that records every call and answers token requests with a token and search requests
 * through `onSearch` (default: no items). Override `onToken` for token failures.
 */
export function fakeEbayFetch(opts: { onSearch?: Responder; onToken?: Responder } = {}): {
  fetch: typeof globalThis.fetch;
  spy: ReturnType<typeof vi.fn<typeof globalThis.fetch>>;
  calls: Call[];
  searches: () => Call[];
  tokens: () => Call[];
} {
  const calls: Call[] = [];
  const spy = vi.fn<typeof globalThis.fetch>(async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const headers: Record<string, string> = {};
    new Headers(init?.headers).forEach((value, key) => {
      headers[key] = value;
    });
    const call: Call = {
      url,
      method: init?.method ?? 'GET',
      headers,
      body: typeof init?.body === 'string' ? init.body : '',
      at: Date.now(),
      signal: init?.signal ?? undefined,
    };
    calls.push(call);
    if (url === TOKEN_URL) return (opts.onToken ?? (() => tokenResponse()))(call);
    return (opts.onSearch ?? (() => json(searchBody([]))))(call);
  });
  return {
    fetch: spy,
    spy,
    calls,
    searches: () => calls.filter((c) => c.url.startsWith(SEARCH_PREFIX)),
    tokens: () => calls.filter((c) => c.url === TOKEN_URL),
  };
}
