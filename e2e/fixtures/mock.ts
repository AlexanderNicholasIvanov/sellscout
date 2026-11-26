// Shared helpers for the UI e2e tests: fixture loading, /api/search mocking and a network
// guard that aborts every request not addressed to the local Playwright server (AC28).
import { readFileSync } from 'node:fs';
import type { Page, Request, Route } from '@playwright/test';
import type { SearchInput, SearchResult } from '../../server/types.ts';

export const LOCAL_HOST = '127.0.0.1:5181';

export type FixtureName = 'mechanical-keyboard' | 'no-match' | 'location-notice';

function assertSearchResult(name: string, value: unknown): asserts value is SearchResult {
  const v = value as SearchResult;
  const ok =
    typeof v === 'object' &&
    v !== null &&
    v.plan?.source === 'catalog' &&
    Array.isArray(v.plan.categories) &&
    typeof v.plan.searchTerm === 'string' &&
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
