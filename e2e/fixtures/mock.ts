// Shared helpers for the UI e2e tests: fixture loading, /api/search mocking and a network
// guard that aborts every request not addressed to the local Playwright server (AC28).
import { readFileSync } from 'node:fs';
import type { Page, Request, Route } from '@playwright/test';
import type { BuyersResult, EbayResult, SearchInput, SearchResult, StatusResponse } from '../../server/types.ts';

export const LOCAL_HOST = '127.0.0.1:5181';

export type FixtureName =
  | 'mechanical-keyboard'
  | 'no-match'
  | 'location-notice'
  | 'buyers-ok'
  | 'buyers-none'
  | 'buyers-unavailable'
  | 'ebay-ok'
  | 'ebay-no-range'
  | 'ebay-none'
  | 'ebay-unavailable'
  | 'ebay-disabled';

function isBuyersResult(b: BuyersResult | undefined): boolean {
  return (
    typeof b === 'object' &&
    b !== null &&
    ['ok', 'unavailable', 'disabled'].includes(b.status) &&
    (b.reason === undefined || typeof b.reason === 'string') &&
    typeof b.term === 'string' &&
    [7, 30, 90].includes(b.windowDays) &&
    Array.isArray(b.posts) &&
    b.posts.every(
      (p) =>
        typeof p.id === 'string' &&
        typeof p.title === 'string' &&
        typeof p.subreddit === 'string' &&
        typeof p.author === 'string' &&
        typeof p.createdUtc === 'number' &&
        typeof p.score === 'number' &&
        typeof p.numComments === 'number' &&
        typeof p.snippet === 'string' &&
        typeof p.url === 'string',
    ) &&
    Array.isArray(b.links) &&
    b.links.every((l) => typeof l.label === 'string' && typeof l.url === 'string')
  );
}

const isFiniteNumber = (n: unknown): boolean => typeof n === 'number' && Number.isFinite(n);

function isEbayResult(e: EbayResult | undefined): boolean {
  return (
    typeof e === 'object' &&
    e !== null &&
    ['ok', 'unavailable', 'disabled'].includes(e.status) &&
    (e.reason === undefined || typeof e.reason === 'string') &&
    typeof e.term === 'string' &&
    typeof e.searchUrl === 'string' &&
    Array.isArray(e.listings) &&
    e.listings.every(
      (l) =>
        typeof l.id === 'string' &&
        typeof l.title === 'string' &&
        isFiniteNumber(l.price) &&
        typeof l.condition === 'string' &&
        typeof l.url === 'string',
    ) &&
    (e.priceRange === undefined ||
      [e.priceRange.count, e.priceRange.p25, e.priceRange.median, e.priceRange.p75].every(isFiniteNumber))
  );
}

function assertSearchResult(name: string, value: unknown): asserts value is SearchResult {
  const v = value as SearchResult;
  const ok =
    typeof v === 'object' &&
    v !== null &&
    v.plan?.source === 'catalog' &&
    Array.isArray(v.plan.categories) &&
    typeof v.plan.searchTerm === 'string' &&
    isBuyersResult(v.buyers) &&
    isEbayResult(v.ebay) &&
    Array.isArray(v.notices) &&
    v.notices.every((n) => typeof n === 'string') &&
    Array.isArray(v.venues) &&
    v.venues.every(
      (venue) =>
        typeof venue.id === 'string' &&
        typeof venue.name === 'string' &&
        typeof venue.kind === 'string' &&
        typeof venue.url === 'string' &&
        typeof venue.ships === 'boolean' &&
        typeof venue.local === 'boolean' &&
        Array.isArray(venue.tips) &&
        Array.isArray(venue.why) &&
        Array.isArray(venue.categoryIds),
    );
  if (!ok) throw new Error(`Fixture ${name}.json is not shaped like SearchResult`);
}

export function loadFixture(name: FixtureName): SearchResult {
  const raw: unknown = JSON.parse(readFileSync(new URL(`./${name}.json`, import.meta.url), 'utf8'));
  assertSearchResult(name, raw);
  return raw;
}

/** Aborts every request that is not to the local test server, so nothing leaves the machine. */
export async function blockExternalRequests(page: Page): Promise<string[]> {
  const blocked: string[] = [];
  await page.route('**/*', (route) => {
    const url = new URL(route.request().url());
    if (url.host !== LOCAL_HOST) {
      blocked.push(url.href);
      return route.abort('blockedbyclient');
    }
    return route.fallback();
  });
  return blocked;
}

export interface SearchCall {
  body: SearchInput;
  contentType: string | undefined;
  method: string;
}

type Responder = (route: Route, request: Request) => Promise<void>;

/**
 * Installs the network guard, then intercepts /api/search. Each call is recorded; `respond`
 * decides the response (default: fulfil with the given fixture).
 */
export async function mockSearch(
  page: Page,
  respond: FixtureName | Responder,
): Promise<{ calls: SearchCall[]; blocked: string[] }> {
  const blocked = await blockExternalRequests(page);
  const calls: SearchCall[] = [];
  await page.route('**/api/search', async (route, request) => {
    calls.push({
      body: request.postDataJSON() as SearchInput,
      contentType: await request.headerValue('content-type') ?? undefined,
      method: request.method(),
    });
    if (typeof respond === 'function') {
      await respond(route, request);
    } else {
      await route.fulfill({ status: 200, json: loadFixture(respond) });
    }
  });
  return { calls, blocked };
}

/** Intercepts GET /api/status with the given status body, or with a bare HTTP status code. */
/** `ebay` defaults to false, so run-2 callers keep working. */
export async function mockStatus(
  page: Page,
  respond: (Omit<StatusResponse, 'version' | 'ebay'> & { ebay?: boolean }) | number,
): Promise<void> {
  await page.route('**/api/status', (route) =>
    typeof respond === 'number'
      ? route.fulfill({ status: respond, json: { error: 'Internal error' } })
      : route.fulfill({ status: 200, json: { version: '0.1.0', ebay: false, ...respond } }),
  );
}

/**
 * Puts `value` (a raw string) into localStorage under `key` before the app's first load. A
 * sessionStorage flag keeps a later reload from writing it again.
 */
export async function seedStorage(page: Page, key: string, value: string): Promise<void> {
  await page.addInitScript(
    ([k, v]) => {
      const flag = `__seeded:${k}`;
      if (window.sessionStorage.getItem(flag) !== null) return;
      window.localStorage.setItem(k, v);
      window.sessionStorage.setItem(flag, '1');
    },
    [key, value],
  );
}

/** Reads a raw localStorage value from the page. */
export function readStorage(page: Page, key: string): Promise<string | null> {
  return page.evaluate((k) => window.localStorage.getItem(k), key);
}
