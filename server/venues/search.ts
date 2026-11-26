import type {
  BuyerContext,
  Catalog,
  CatalogVenue,
  Category,
  Delivery,
  Metro,
  Venue,
  VenueSearchFn,
  VenueSearchResult,
} from '../types.ts';
import { craigslistUrls, fillTemplate, subredditUrls } from './links.ts';
import { createMetroResolver } from './location.ts';
import { compileCategories, matchCategories } from './match.ts';
import type { CategoryMatch } from './match.ts';

export const GENERAL_WHY = 'Sells almost anything';
export const AI_SUGGESTED_WHY = 'Suggested by Claude';
/** `why` of a venue Claude picked when none of its picked categories' keywords is in the item. */
export const pickedWhy = (categoryName: string): string => `Picked by Claude for ${categoryName}`;

export const noMatchNotice = (item: string): string =>
  `No specialist boards matched "${item}". Try more specific words (brand, model, type).`;

export const unknownLocationNotice = (location: string): string =>
  `Couldn't match "${location}" to a city; local links are generic.`;

const CRAIGSLIST_SUBDOMAIN = /^[a-z]+$/;
const SUBREDDIT_NAME = /^\w+$/;
const AI_SUBREDDIT_NAME = /^[A-Za-z0-9_]{3,21}$/;
/** Most catalog subreddits handed to the buyer search. */
export const CONTEXT_SUBREDDITS_MAX = 3;

/**
 * Drops matched keywords that are whole words inside another matched keyword, so "Why" reads
 * "sony a7, a7 iii" rather than "sony a7, a7, a7 iii". Display only; scoring is unchanged.
 */
export function mostSpecific(keywords: string[]): string[] {
  return keywords.filter(
    (k) => !keywords.some((other) => other !== k && ` ${other} `.includes(` ${k} `)),
  );
}

function toVenue(venue: CatalogVenue, searchTerm: string, why: string[]): Venue {
  const out: Venue = {
    id: venue.id,
    name: venue.name,
    kind: venue.kind,
    url: venue.url,
    ships: venue.ships,
    local: venue.local,
    tips: [...venue.tips],
    why,
    categoryIds: [...venue.categoryIds],
  };
  if (venue.searchUrlTemplate) out.searchUrl = fillTemplate(venue.searchUrlTemplate, searchTerm);
  if (venue.feeNote) out.feeNote = venue.feeNote;
  return out;
}

const isCraigslist = (venue: CatalogVenue): boolean =>
  venue.kind === 'local-classifieds' && /^https:\/\/(?:[a-z]+\.)?craigslist\.org\//.test(venue.url);

function keepForDelivery(venue: Venue, delivery: Delivery): boolean {
  if (delivery === 'ship') return venue.ships;
  if (delivery === 'local') return venue.local;
  return true;
}

function metroSubredditVenue(metro: Metro, name: string, searchTerm: string): Venue {
  return {
    id: `metro-${metro.id}-subreddit`,
    name: `r/${name}`,
    kind: 'subreddit',
    ...subredditUrls(name, searchTerm),
    ships: false,
    local: true,
    tips: ['Local buyers; meet somewhere public'],
    why: [`Local to ${metro.name}`],
    categoryIds: [],
  };
}

/** The venue for a subreddit Claude suggested: a plain board link (no search link), never searched for buyers. */
export function aiSubredditVenue(name: string): Venue {
  return {
    id: `ai-r-${name.toLowerCase()}`,
    name: `r/${name}`,
    kind: 'subreddit',
    url: `https://www.reddit.com/r/${name}/`,
    ships: true,
    local: true,
    tips: [],
    why: [AI_SUGGESTED_WHY],
    categoryIds: [],
    aiSuggested: true,
  };
}

/** A specialist with its sort keys: `rank` (Claude's list position, 0 without picks), `score`, catalog `index`. */
interface Ranked { venue: Venue; rank: number; score: number; index: number }

const subredditName = (venue: Venue): string => venue.name.replace(/^r\//, '');

/**
 * Builds the pure venue search over a catalog and metro table. No I/O: every venue is a link.
 * Order: matched specialists (best category score desc, then catalog order), then the local
 * metro subreddit (if any), then the general venues in catalog order; finally the delivery filter.
 *
 * With Claude's `picks` (spec "With Claude picks"): the specialists are the catalog venues that
 * serve a picked category, ranked by the best position of their categories in Claude's list, then
 * the catalog keyword score of those categories, then catalog order; the AI-suggested subreddits
 * follow them; the plan lists the picked categories in Claude's order with `source: 'claude'`.
 *
 * `context` is for the buyer search only: the ranked catalog subreddits (taken before the
 * delivery filter, never the metro subreddit or an AI-suggested one, at most 3) and the metro's
 * Craigslist subdomain.
 */
export function createSearch({ catalog, metros }: { catalog: Catalog; metros: Metro[] }): VenueSearchFn {
  const compiled = compileCategories(catalog.categories);
  const resolveMetro = createMetroResolver(metros);
  const categoriesById = new Map(catalog.categories.map((category) => [category.id, category]));

  /** Catalog mode: the venues serving a keyword-matched category. */
  function keywordSpecialists(matched: CategoryMatch[], searchTerm: string): Ranked[] {
    const ranked: Ranked[] = [];
    catalog.venues.forEach((source, index) => {
      if (source.general) return;
      let score = 0;
      const why: string[] = [];
      for (const match of matched) {
        if (!source.categoryIds.includes(match.category.id)) continue;
        score = Math.max(score, match.score);
        for (const keyword of match.keywords) if (!why.includes(keyword)) why.push(keyword);
      }
      if (score > 0) ranked.push({ venue: toVenue(source, searchTerm, mostSpecific(why)), rank: 0, score, index });
    });
    return ranked;
  }

  /** Claude mode: the venues serving a picked category. */
  function pickedSpecialists(picked: Category[], matched: CategoryMatch[], searchTerm: string): Ranked[] {
    const matchById = new Map(matched.map((match) => [match.category.id, match]));
    const ranked: Ranked[] = [];
    catalog.venues.forEach((source, index) => {
      if (source.general) return;
      let best: { rank: number; category: Category } | undefined;
      let score = 0;
      const why: string[] = [];
      for (const [rank, category] of picked.entries()) {
        if (!source.categoryIds.includes(category.id)) continue;
        best ??= { rank, category };
        const match = matchById.get(category.id);
        if (!match) continue;
        score = Math.max(score, match.score);
        for (const keyword of match.keywords) if (!why.includes(keyword)) why.push(keyword);
      }
      if (!best) return;
      const reasons = why.length > 0 ? mostSpecific(why) : [pickedWhy(best.category.name)];
      ranked.push({ venue: toVenue(source, searchTerm, reasons), rank: best.rank, score, index });
    });
    return ranked;
  }

  return (input, picks): VenueSearchResult => {
    const item = typeof input?.item === 'string' ? input.item : '';
    const searchTerm = item.trim().replace(/\s+/g, ' ');
    const location = typeof input?.location === 'string' ? input.location.trim() : '';
    const delivery: Delivery =
      input?.delivery === 'ship' || input?.delivery === 'local' ? input.delivery : 'both';
    const notices: string[] = [];

    const matched = matchCategories(searchTerm, compiled);
    const metro = location ? resolveMetro(location) : undefined;

    // Claude's categories in its order, catalog ids only, once each.
    const picked: Category[] = [];
    for (const id of picks?.categoryIds ?? []) {
      const category = categoriesById.get(id);
      if (category && !picked.includes(category)) picked.push(category);
    }
    const categories = picks ? picked : matched.map(({ category }) => category);

    const specialists = picks ? pickedSpecialists(picked, matched, searchTerm) : keywordSpecialists(matched, searchTerm);
    specialists.sort((a, b) => a.rank - b.rank || b.score - a.score || a.index - b.index);

    const generals: Venue[] = [];
    for (const source of catalog.venues) {
      if (!source.general) continue;
      const venue = toVenue(source, searchTerm, [GENERAL_WHY]);
      if (metro && isCraigslist(source) && CRAIGSLIST_SUBDOMAIN.test(metro.craigslist)) {
        Object.assign(venue, craigslistUrls(metro.craigslist, searchTerm));
      }
      generals.push(venue);
    }

    if (categories.length === 0) notices.push(noMatchNotice(searchTerm));

    const local: Venue[] = [];
    // With delivery 'ship' every local venue is filtered out, so a location notice would mislead.
    if (location && !metro && delivery !== 'ship') notices.push(unknownLocationNotice(location));
    if (metro?.buySellSubreddit && SUBREDDIT_NAME.test(metro.buySellSubreddit)) {
      local.push(metroSubredditVenue(metro, metro.buySellSubreddit, searchTerm));
    }

    // One venue per AI-suggested subreddit, never one already listed (a catalog or metro board).
    const listed = new Set(
      [...specialists.map((s) => s.venue), ...local]
        .filter((venue) => venue.kind === 'subreddit')
        .map((venue) => subredditName(venue).toLowerCase()),
    );
    const suggested: Venue[] = [];
    for (const name of picks?.subreddits ?? []) {
      const lower = name.toLowerCase();
      if (!AI_SUBREDDIT_NAME.test(name) || listed.has(lower)) continue;
      listed.add(lower);
      suggested.push(aiSubredditVenue(name));
    }

    const context: BuyerContext = {
      subreddits: specialists
        .filter((s) => s.venue.kind === 'subreddit')
        .map((s) => subredditName(s.venue))
        .filter((name) => SUBREDDIT_NAME.test(name))
        .slice(0, CONTEXT_SUBREDDITS_MAX),
    };
    if (metro && CRAIGSLIST_SUBDOMAIN.test(metro.craigslist)) context.craigslist = metro.craigslist;

    const venues = [...specialists.map((s) => s.venue), ...suggested, ...local, ...generals].filter((venue) =>
      keepForDelivery(venue, delivery),
    );

    return {
      plan: {
        source: picks ? 'claude' : 'catalog',
        categories: categories.map((category) => ({ id: category.id, name: category.name })),
        searchTerm,
      },
      venues,
      notices,
      context,
    };
  };
}
