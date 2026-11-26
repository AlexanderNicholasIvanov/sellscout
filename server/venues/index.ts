import type { SearchFn } from '../types.ts';

// Stub: u2 replaces this with the real venue engine.
export const searchVenues: SearchFn = (input) => ({ plan: { source: 'catalog', categories: [], searchTerm: input.item.trim().replace(/\s+/g, ' ') }, venues: [], notices: [] });
