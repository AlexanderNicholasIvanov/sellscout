// Reading an eBay search response: the listings, the asking-price range and the category venue
// (spec "Reading the response" and "eBay category venue"). Pure functions, no I/O.
import type { EbayListing, PriceRange, Venue } from '../types.ts';
import { encodeTerm } from '../venues/links.ts';

export const MAX_LISTINGS = 10;
/** The range uses every kept item up to this many (the search asks for 50). */
export const MAX_RANGE_ITEMS = 50;
export const MIN_RANGE_COUNT = 3;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const nonEmpty = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;

/** Rounds to cents. */
export const roundCents = (value: number): number => Math.round((value + Number.EPSILON) * 100) / 100;

/** A finite USD amount above 0, from eBay's string value (a number is accepted too). */
function usdPrice(price: unknown): number | undefined {
  if (!isRecord(price) || price.currency !== 'USD') return undefined;
  const { value } = price;
  const amount = typeof value === 'number' ? value : typeof value === 'string' && value.trim() !== '' ? Number(value) : NaN;
  return Number.isFinite(amount) && amount > 0 ? roundCents(amount) : undefined;
}

/** An `https:` URL on `ebay.com` or a `*.ebay.com` host, or undefined. */
export function ebayItemUrl(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return undefined;
  }
  if (url.protocol !== 'https:' || url.username !== '' || url.password !== '') return undefined;
  const host = url.hostname.toLowerCase();
  return host === 'ebay.com' || host.endsWith('.ebay.com') ? url.href : undefined;
}

/** One `itemSummaries[]` entry as a listing, or undefined when it is skipped. */
export function toListing(item: unknown): EbayListing | undefined {
  if (!isRecord(item)) return undefined;
  const id = nonEmpty(item.itemId);
  const title = nonEmpty(item.title);
  const price = usdPrice(item.price);
  const url = ebayItemUrl(item.itemWebUrl);
  if (id === undefined || title === undefined || price === undefined || url === undefined) return undefined;
  return { id, title, price, condition: nonEmpty(item.condition) ?? '', url };
}

/** Every kept item, in eBay's order. */
export function keptListings(items: unknown[]): EbayListing[] {
  const kept: EbayListing[] = [];
  for (const item of items) {
    const listing = toListing(item);
    if (listing) kept.push(listing);
  }
  return kept;
}

/**
 * The p-th percentile (0..1) of ascending `sorted` by linear interpolation between closest
 * ranks: rank `(n - 1) * p`. Not rounded. `sorted` must not be empty.
 */
export function percentile(sorted: readonly number[], p: number): number {
  const rank = (sorted.length - 1) * p;
  const low = Math.floor(rank);
  const high = Math.ceil(rank);
  const lowValue = sorted[low] as number;
  const highValue = sorted[high] as number;
  return lowValue + (highValue - lowValue) * (rank - low);
}

/** count, p25, median and p75 of the prices, rounded to cents; undefined for fewer than 3. */
export function priceRange(prices: readonly number[]): PriceRange | undefined {
  if (prices.length < MIN_RANGE_COUNT) return undefined;
  const sorted = [...prices].sort((a, b) => a - b);
  return {
    count: sorted.length,
    p25: roundCents(percentile(sorted, 0.25)),
    median: roundCents(percentile(sorted, 0.5)),
    p75: roundCents(percentile(sorted, 0.75)),
  };
}

export interface ParsedSearch { listings: EbayListing[]; priceRange?: PriceRange }

/** The first 10 kept items, and the range over every kept item (up to 50). */
export function parseItems(items: unknown[]): ParsedSearch {
  const kept = keptListings(items);
  const range = priceRange(kept.slice(0, MAX_RANGE_ITEMS).map((listing) => listing.price));
  return { listings: kept.slice(0, MAX_LISTINGS), ...(range ? { priceRange: range } : {}) };
}

const CATEGORY_ID = /^\d{1,10}$/;

/**
 * The top category of `refinement.categoryDistributions[]`: the highest `matchCount`; on a tie
 * `refinement.dominantCategoryId` wins, otherwise the first. Undefined when there is none, or
 * when the top one has an invalid id or an empty name.
 */
export function topCategory(refinement: unknown): { id: string; name: string } | undefined {
  if (!isRecord(refinement) || !Array.isArray(refinement.categoryDistributions)) return undefined;
  const dominant = refinement.dominantCategoryId;
  let top: Record<string, unknown> | undefined;
  let topCount = -Infinity;
  for (const entry of refinement.categoryDistributions) {
    if (!isRecord(entry) || typeof entry.matchCount !== 'number' || !Number.isFinite(entry.matchCount)) continue;
    const count = entry.matchCount;
    const tieWin = count === topCount && dominant !== undefined && entry.categoryId === dominant && top?.categoryId !== dominant;
    if (count > topCount || tieWin) {
      top = entry;
      topCount = count;
    }
  }
  if (!top) return undefined;
  const id = top.categoryId;
  const name = nonEmpty(top.categoryName);
  if (typeof id !== 'string' || !CATEGORY_ID.test(id) || name === undefined) return undefined;
  return { id, name };
}

/** The "eBay - <category>" venue for the term, or undefined when there is no valid top category. */
export function categoryVenue(refinement: unknown, term: string): Venue | undefined {
  const category = topCategory(refinement);
  if (!category) return undefined;
  return {
    id: 'ebay-category',
    name: `eBay - ${category.name}`,
    kind: 'marketplace',
    url: `https://www.ebay.com/sch/i.html?_nkw=${encodeTerm(term)}&_sacat=${category.id}`,
    ships: true,
    local: false,
    tips: [],
    why: [`eBay category for "${term}"`],
    categoryIds: [],
  };
}
