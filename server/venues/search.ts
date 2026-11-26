import type { Catalog, CatalogVenue, Delivery, Metro, SearchFn, SearchResult, Venue } from '../types.ts';
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
 */
export function createSearch({ catalog, metros }: { catalog: Catalog; metros: Metro[] }): SearchFn {
  const compiled = compileCategories(catalog.categories);
  const resolveMetro = createMetroResolver(metros);

  return (input): SearchResult => {
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
      if (score > 0) specialists.push({ venue: toVenue(source, searchTerm, why), score, index });
    });
    specialists.sort((a, b) => b.score - a.score || a.index - b.index);

    if (matched.length === 0) notices.push(noMatchNotice(searchTerm));

    const local: Venue[] = [];
    if (location && !metro) notices.push(unknownLocationNotice(location));
    if (metro?.buySellSubreddit && SUBREDDIT_NAME.test(metro.buySellSubreddit)) {
      local.push(metroSubredditVenue(metro, metro.buySellSubreddit, searchTerm));
    }

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
    };
  };
}
