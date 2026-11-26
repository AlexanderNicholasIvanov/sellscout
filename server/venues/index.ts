import type { VenueSearchFn } from '../types.ts';
import { catalog } from '../data/catalog.ts';
import { metros } from '../data/metros.ts';
import { createSearch } from './search.ts';

export { createSearch } from './search.ts';

/** Venue search over the built-in catalog and metro table. Pure: no network, no file system. */
export const searchVenues: VenueSearchFn = createSearch({ catalog, metros });
