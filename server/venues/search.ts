import type {
  BuyerContext,
  Catalog,
  CatalogVenue,
  Delivery,
  Metro,
  Venue,
  VenueSearchFn,
  VenueSearchResult,
} from '../types.ts';
import { craigslistUrls, fillTemplate, subredditUrls } from './links.ts';
import { createMetroResolver } from './location.ts';
import { compileCategories, matchCategories } from './match.ts';

export const GENERAL_WHY = 'Sells almost anything';

export const noMatchNotice = (item: string): string =>
  `No specialist boards matched "${item}". Try more specific words (brand, model, type).`;

export const unknownLocationNotice = (location: string): string =>
  `Couldn't match "${location}" to a city; local links are generic.`;

const CRAIGSLIST_SUBDOMAIN = /^[a-z]+$/;
const SUBREDDIT_NAME = /^\w+$/;
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

/**
 * Builds the pure venue search over a catalog and metro table. No I/O: every venue is a link.
 * Order: matched specialists (best category score desc, then catalog order), then the local
 * metro subreddit (if any), then the general venues in catalog order; finally the delivery filter.
 *
 * `context` is for the buyer search only: the matched catalog subreddits in rank order (taken
 * before the delivery filter, never the metro subreddit, at most 3) and the metro's Craigslist
 * subdomain.
 */
export function createSearch({ catalog, metros }: { catalog: Catalog; metros: Metro[] }): VenueSearchFn {
  const compiled = compileCategories(catalog.categories);
  const resolveMetro = createMetroResolver(metros);

  return (input): VenueSearchResult => {
    const item = typeof input?.item === 'string' ? input.item : '';
    const searchTerm = item.trim().replace(/\s+/g, ' ');
    const location = typeof input?.location === 'string' ? input.location.trim() : '';
    const delivery: Delivery =
      input?.delivery === 'ship' || input?.delivery === 'local' ? input.delivery : 'both';
    const notices: string[] = [];

    const matched = matchCategories(searchTerm, compiled);

    const specialists: { venue: Venue; score: number; index: number }[] = [];
    const generals: Venue[] = [];
    const metro = location ? resolveMetro(location) : undefined;

    catalog.venues.forEach((source, index) => {
      if (source.general) {
        const venue = toVenue(source, searchTerm, [GENERAL_WHY]);
        if (metro && isCraigslist(source) && CRAIGSLIST_SUBDOMAIN.test(metro.craigslist)) {
          Object.assign(venue, craigslistUrls(metro.craigslist, searchTerm));
        }
        generals.push(venue);
        return;
      }
      let score = 0;
      const why: string[] = [];
      for (const match of matched) {
        if (!source.categoryIds.includes(match.category.id)) continue;
        score = Math.max(score, match.score);
        for (const keyword of match.keywords) if (!why.includes(keyword)) why.push(keyword);
      }
      if (score > 0) specialists.push({ venue: toVenue(source, searchTerm, mostSpecific(why)), score, index });
    });
    specialists.sort((a, b) => b.score - a.score || a.index - b.index);

    if (matched.length === 0) notices.push(noMatchNotice(searchTerm));

    const local: Venue[] = [];
    // With delivery 'ship' every local venue is filtered out, so a location notice would mislead.
    if (location && !metro && delivery !== 'ship') notices.push(unknownLocationNotice(location));
    if (metro?.buySellSubreddit && SUBREDDIT_NAME.test(metro.buySellSubreddit)) {
      local.push(metroSubredditVenue(metro, metro.buySellSubreddit, searchTerm));
    }

    const context: BuyerContext = {
      subreddits: specialists
        .filter((s) => s.venue.kind === 'subreddit')
        .map((s) => s.venue.name.replace(/^r\//, ''))
        .filter((name) => SUBREDDIT_NAME.test(name))
        .slice(0, CONTEXT_SUBREDDITS_MAX),
    };
    if (metro && CRAIGSLIST_SUBDOMAIN.test(metro.craigslist)) context.craigslist = metro.craigslist;

    const venues = [...specialists.map((s) => s.venue), ...local, ...generals].filter((venue) =>
      keepForDelivery(venue, delivery),
    );

    return {
      plan: {
        source: 'catalog',
        categories: matched.map(({ category }) => ({ id: category.id, name: category.name })),
        searchTerm,
      },
      venues,
      notices,
      context,
    };
  };
}
