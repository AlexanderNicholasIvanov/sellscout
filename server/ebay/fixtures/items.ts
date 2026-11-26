// Fixture eBay search responses for fixture mode (tests, e2e, demos), in the Browse API's shape.
// The fx_eb* items and the keyboard category distribution are the "Fixture data agreement" that
// the e2e tests assert: change them only together with e2e/.

export interface FixtureItem {
  itemId: string;
  title: string;
  price?: { value: string; currency: string };
  condition?: string;
  itemWebUrl: string;
}

const item = (itemId: string, title: string, value: string | undefined, condition?: string, currency = 'USD'): FixtureItem => ({
  itemId,
  title,
  ...(value === undefined ? {} : { price: { value, currency } }),
  ...(condition === undefined ? {} : { condition }),
  itemWebUrl: `https://www.ebay.com/itm/${itemId}`,
});

/** "mechanical keyboard": 6 kept USD items, then a GBP item and an item without a price (both skipped). */
export const KEYBOARD_ITEMS: readonly FixtureItem[] = [
  item('fx_eb1', 'Redragon K552 mechanical keyboard, tenkeyless, red switches', '50.00', 'Used'),
  item('fx_eb2', 'Keychron K2 mechanical keyboard 75% wireless', '80.00', 'Pre-owned'),
  // No condition: the listing shows none.
  item('fx_eb3', 'RK84 hot-swap mechanical keyboard, brown switches', '100.00'),
  item('fx_eb4', 'Ducky One 3 SF mechanical keyboard, Cherry MX', '120.00', 'Open box'),
  item('fx_eb5', 'Keychron Q1 mechanical keyboard, aluminium case', '150.00', 'Used'),
  item('fx_eb6', 'Custom 65% mechanical keyboard, lubed switches, GMK keycaps', '400.00', 'New'),
  item('fx_eb7', 'Filco Majestouch mechanical keyboard (UK seller)', '60.00', 'Used', 'GBP'),
  item('fx_eb8', 'Vintage IBM Model M mechanical keyboard, best offer', undefined, 'Used'),
];

export const KEYBOARD_CATEGORIES = [
  { categoryId: '33963', categoryName: 'Keyboards & Keypads', matchCount: 7 },
  { categoryId: '58058', categoryName: 'Computers/Tablets & Networking', matchCount: 1 },
] as const;

/** "desk": 2 USD items, too few for a range. */
export const DESK_ITEMS: readonly FixtureItem[] = [
  item('fx_ed1', 'Electric standing desk, 48 x 24 in, walnut top', '180.00', 'Used'),
  item('fx_ed2', 'Solid oak writing desk with two drawers', '95.00', 'Pre-owned'),
];

/** The search response JSON for a lower-cased term: keyboard items, desk items or none. */
export function fixtureSearchBody(term: string): Record<string, unknown> {
  if (term.includes('mechanical keyboard')) {
    return {
      total: KEYBOARD_ITEMS.length,
      limit: 50,
      offset: 0,
      itemSummaries: KEYBOARD_ITEMS,
      refinement: { dominantCategoryId: '33963', categoryDistributions: KEYBOARD_CATEGORIES },
    };
  }
  if (term.includes('desk')) return { total: DESK_ITEMS.length, limit: 50, offset: 0, itemSummaries: DESK_ITEMS };
  // eBay leaves out itemSummaries when nothing matched.
  return { total: 0, limit: 50, offset: 0 };
}
