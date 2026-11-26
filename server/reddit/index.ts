// STUB (run 2a, unit u1): u2 replaces the body with the real Reddit buyer search and keeps
// these exports. The stub never makes a request: every search is 'disabled'.
import type { AppConfig } from '../config.ts';
import type { BuyerContext, BuyersResult, BuyerWindow, Delivery } from '../types.ts';

export interface BuyerQuery { item: string; windowDays: BuyerWindow; delivery: Delivery; context: BuyerContext }
export interface BuyerSearchOutput { buyers: BuyersResult; notices: string[] }
export type BuyerSearchFn = (query: BuyerQuery) => Promise<BuyerSearchOutput>;
export interface BuyerSearchOptions {
  config: AppConfig;
  version: string;
  /** Used for Reddit requests when signed in. Never called when disabled or in fixture mode. */
  fetch: typeof globalThis.fetch;
}

/** The Reddit search term derived from the item (spec "Buyer term"). Stub: trimmed, whitespace collapsed. */
export function buyerTerm(item: string): string {
  return item.trim().replace(/\s+/g, ' ');
}

export function createBuyerSearch(options: BuyerSearchOptions): BuyerSearchFn {
  void options;
  return async ({ item, windowDays }) => ({
    buyers: { status: 'disabled', term: buyerTerm(item), windowDays, posts: [], links: [] },
    notices: [],
  });
}
