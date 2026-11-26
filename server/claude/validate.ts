// Pure validation of Claude's parsed answer (spec "Validation").
import type { Catalog } from '../types.ts';
import type { ClaudePicks } from './types.ts';

export const MAX_CATEGORIES = 5;
export const MAX_SUBREDDITS = 5;
export const MAX_TERM_CHARS = 80;
export const SUBREDDIT_NAME = /^[A-Za-z0-9_]{3,21}$/;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((entry) => typeof entry === 'string');

/** Lower-case names of the catalog's own subreddits (without `r/`). */
export function catalogSubreddits(catalog: Catalog): Set<string> {
  return new Set(
    catalog.venues.filter((venue) => venue.kind === 'subreddit').map((venue) => venue.name.replace(/^r\//i, '').toLowerCase()),
  );
}

/**
 * Builds the validator for one catalog. The answer must be an object with `categoryIds`
 * (strings), `searchTerm` (string) and `subreddits` (strings); anything else is `undefined`
 * (an unusable answer). Then:
 * - categoryIds: catalog ids only, first occurrence, Claude's order, at most 5;
 * - searchTerm: trimmed, whitespace collapsed, cut to 80 characters; empty = unusable;
 * - subreddits: a leading `r/` or `/r/` stripped, names matching ^[A-Za-z0-9_]{3,21}$ only, no
 *   case-insensitive duplicates, none already in the catalog, at most 5.
 */
export function createValidator(catalog: Catalog): (value: unknown) => ClaudePicks | undefined {
  const ids = new Set(catalog.categories.map((category) => category.id));
  const known = catalogSubreddits(catalog);

  return (value) => {
    if (!isRecord(value)) return undefined;
    const { categoryIds, searchTerm, subreddits } = value;
    if (!isStringArray(categoryIds) || typeof searchTerm !== 'string' || !isStringArray(subreddits)) return undefined;

    const term = Array.from(searchTerm.trim().replace(/\s+/g, ' ')).slice(0, MAX_TERM_CHARS).join('').trim();
    if (term === '') return undefined;

    const categories: string[] = [];
    for (const id of categoryIds) {
      if (categories.length >= MAX_CATEGORIES) break;
      if (ids.has(id) && !categories.includes(id)) categories.push(id);
    }

    const names: string[] = [];
    const seen = new Set<string>();
    for (const raw of subreddits) {
      if (names.length >= MAX_SUBREDDITS) break;
      const name = raw.trim().replace(/^\/?r\//i, '');
      const lower = name.toLowerCase();
      if (!SUBREDDIT_NAME.test(name) || seen.has(lower) || known.has(lower)) continue;
      seen.add(lower);
      names.push(name);
    }

    return { categoryIds: categories, searchTerm: term, subreddits: names };
  };
}
