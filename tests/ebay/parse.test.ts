// Run 3 AC7, AC8: reading items, the price range (percentiles) and the top category. Pure.
import { describe, expect, it } from 'vitest';
import {
  categoryVenue,
  ebayItemUrl,
  keptListings,
  parseItems,
  percentile,
  priceRange,
  roundCents,
  toListing,
  topCategory,
} from '../../server/ebay/parse.ts';
import { item } from './helpers.ts';

describe('toListing (AC7)', () => {
  it('keeps a USD item with an id, a title, a positive price and an https ebay.com URL', () => {
    expect(toListing(item('v1|1|0', '12.50', { title: 'Road bike', condition: 'Used' }))).toEqual({
      id: 'v1|1|0',
      title: 'Road bike',
      price: 12.5,
      condition: 'Used',
      url: 'https://www.ebay.com/itm/v1|1|0',
    });
  });

  it("gives '' when eBay has no condition", () => {
    expect(toListing(item('a', '5', { condition: undefined }))?.condition).toBe('');
    expect(toListing(item('a', '5', { condition: 42 }))?.condition).toBe('');
    expect(toListing(item('a', '5', { condition: '  ' }))?.condition).toBe('');
  });

  it('accepts a numeric price and rounds to cents', () => {
    expect(toListing(item('a', 19.999))?.price).toBe(20);
    expect(toListing(item('a', '0.015'))?.price).toBe(0.02);
  });

  it.each([
    ['a GBP item', item('a', '10', { price: { value: '10.00', currency: 'GBP' } })],
    ['no currency', item('a', '10', { price: { value: '10.00' } })],
    ['no price', item('a', '10', { price: undefined })],
    ['a price that is not an object', item('a', '10', { price: '10.00' })],
    ['no price value', item('a', '10', { price: { currency: 'USD' } })],
    ['an empty price value', item('a', '')],
    ['a price of 0', item('a', '0.00')],
    ['a negative price', item('a', '-5.00')],
    ['a non-numeric price', item('a', 'abc')],
    ['an infinite price', item('a', 'Infinity')],
    ['a NaN price', item('a', Number.NaN)],
    ['a price value that is an object', item('a', '1', { price: { value: {}, currency: 'USD' } })],
    ['no itemId', item('a', '10', { itemId: undefined })],
    ['an empty itemId', item('a', '10', { itemId: '' })],
    ['a numeric itemId', item('a', '10', { itemId: 5 })],
    ['no title', item('a', '10', { title: undefined })],
    ['an empty title', item('a', '10', { title: '   ' })],
    ['an http URL', item('a', '10', { itemWebUrl: 'http://www.ebay.com/itm/a' })],
    ['a non-ebay host', item('a', '10', { itemWebUrl: 'https://evil.example/itm/a' })],
    ['a lookalike host', item('a', '10', { itemWebUrl: 'https://notebay.com/itm/a' })],
    ['an ebay.com.evil host', item('a', '10', { itemWebUrl: 'https://www.ebay.com.evil.example/itm/a' })],
    ['a javascript: URL', item('a', '10', { itemWebUrl: 'javascript:alert(1)' })],
    ['a relative URL', item('a', '10', { itemWebUrl: '/itm/a' })],
    ['no URL', item('a', '10', { itemWebUrl: undefined })],
    ['a non-object item', 'not an item'],
    ['null', null],
  ])('skips %s', (_label, entry) => {
    expect(toListing(entry)).toBeUndefined();
  });
});

describe('ebayItemUrl (AC7)', () => {
  it.each([
    ['https://www.ebay.com/itm/1', 'https://www.ebay.com/itm/1'],
    ['https://ebay.com/itm/1', 'https://ebay.com/itm/1'],
    ['https://m.EBAY.com/itm/1?x=1', 'https://m.ebay.com/itm/1?x=1'],
  ])('keeps %s', (input, expected) => {
    expect(ebayItemUrl(input)).toBe(expected);
  });

  it.each(['https://www.ebay.co.uk/itm/1', 'https://user:pw@www.ebay.com/itm/1', 'ftp://www.ebay.com/', 'not a url'])(
    'rejects %s',
    (input) => {
      expect(ebayItemUrl(input)).toBeUndefined();
    },
  );
});

describe('keptListings and parseItems (AC7)', () => {
  it("keeps eBay's order and skips the bad items", () => {
    const items = [item('a', '30'), item('gbp', '1', { price: { value: '1', currency: 'GBP' } }), item('b', '10'), item('c', '20')];
    expect(keptListings(items).map((l) => l.id)).toEqual(['a', 'b', 'c']);
  });

  it('lists at most 10, in order, but the range uses every kept item', () => {
    const items = Array.from({ length: 14 }, (_, i) => item(`i${i + 1}`, String(i + 1)));
    const parsed = parseItems(items);
    expect(parsed.listings.map((l) => l.id)).toEqual(['i1', 'i2', 'i3', 'i4', 'i5', 'i6', 'i7', 'i8', 'i9', 'i10']);
    // 1..14: rank 13p -> p25 3.25 + 1 = 4.25, median 7.5, p75 10.75.
    expect(parsed.priceRange).toEqual({ count: 14, p25: 4.25, median: 7.5, p75: 10.75 });
  });

  it('the range uses at most 50 kept items', () => {
    const items = Array.from({ length: 60 }, (_, i) => item(`i${i}`, String(i + 1)));
    expect(parseItems(items).priceRange?.count).toBe(50);
  });

  it('skipped items do not count toward the range', () => {
    const items = [item('a', '10'), item('b', '20'), item('c', '0'), item('d', '30', { itemWebUrl: 'http://www.ebay.com/' })];
    const parsed = parseItems(items);
    expect(parsed.listings).toHaveLength(2);
    expect(parsed).not.toHaveProperty('priceRange');
  });

  it('0 items gives no listings and no range', () => {
    expect(parseItems([])).toEqual({ listings: [] });
  });
});

describe('percentile (AC7)', () => {
  it('interpolates linearly between closest ranks, rank (n - 1) * p', () => {
    const x = [50, 80, 100, 120, 150, 400];
    expect(percentile(x, 0.25)).toBe(85);
    expect(percentile(x, 0.5)).toBe(110);
    expect(percentile(x, 0.75)).toBe(142.5);
    expect(percentile(x, 0)).toBe(50);
    expect(percentile(x, 1)).toBe(400);
  });

  it('works for one value', () => {
    expect(percentile([7], 0.5)).toBe(7);
  });
});

describe('priceRange (AC7)', () => {
  it('needs at least 3 prices', () => {
    expect(priceRange([])).toBeUndefined();
    expect(priceRange([10])).toBeUndefined();
    expect(priceRange([10, 20])).toBeUndefined();
  });

  it('n = 3 (odd)', () => {
    // ranks 0.5, 1, 1.5
    expect(priceRange([30, 10, 20])).toEqual({ count: 3, p25: 15, median: 20, p75: 25 });
  });

  it('n = 4 (even)', () => {
    // ranks 0.75, 1.5, 2.25
    expect(priceRange([10, 20, 30, 40])).toEqual({ count: 4, p25: 17.5, median: 25, p75: 32.5 });
  });

  it('n = 5 (odd)', () => {
    // ranks 1, 2, 3
    expect(priceRange([5, 1, 4, 2, 3])).toEqual({ count: 5, p25: 2, median: 3, p75: 4 });
  });

  it('n = 6, the fixture prices (even)', () => {
    expect(priceRange([400, 150, 120, 100, 80, 50])).toEqual({ count: 6, p25: 85, median: 110, p75: 142.5 });
  });

  it('rounds each value to cents', () => {
    // n = 3: p25 = 0.01 + (0.02 - 0.01) * 0.5 = 0.015 -> 0.02; p75 = 0.02 + 0.5 * (10 - 0.02) = 5.01
    expect(priceRange([0.01, 0.02, 10])).toEqual({ count: 3, p25: 0.02, median: 0.02, p75: 5.01 });
    // n = 4: p25 rank 0.75 -> 1 + 0.75 * 0.33 = 1.2475 -> 1.25
    expect(priceRange([1, 1.33, 2, 3])?.p25).toBe(1.25);
  });

  it('does not change its input', () => {
    const prices = [3, 1, 2];
    priceRange(prices);
    expect(prices).toEqual([3, 1, 2]);
  });

  it('roundCents', () => {
    expect(roundCents(1.005)).toBe(1.01);
    expect(roundCents(142.5)).toBe(142.5);
    expect(roundCents(2.344)).toBe(2.34);
  });
});

describe('topCategory (AC8)', () => {
  const dist = (categoryId: unknown, categoryName: unknown, matchCount: unknown) => ({ categoryId, categoryName, matchCount });

  it('the highest matchCount wins', () => {
    expect(
      topCategory({ categoryDistributions: [dist('1', 'One', 2), dist('2', 'Two', 9), dist('3', 'Three', 4)] }),
    ).toEqual({ id: '2', name: 'Two' });
  });

  it('on a tie dominantCategoryId wins', () => {
    const categoryDistributions = [dist('1', 'One', 5), dist('2', 'Two', 5), dist('3', 'Three', 5)];
    expect(topCategory({ dominantCategoryId: '2', categoryDistributions })).toEqual({ id: '2', name: 'Two' });
    expect(topCategory({ dominantCategoryId: '3', categoryDistributions })).toEqual({ id: '3', name: 'Three' });
  });

  it('on a tie without the dominant category the first wins', () => {
    const categoryDistributions = [dist('1', 'One', 5), dist('2', 'Two', 5)];
    expect(topCategory({ categoryDistributions })).toEqual({ id: '1', name: 'One' });
    expect(topCategory({ dominantCategoryId: '9', categoryDistributions })).toEqual({ id: '1', name: 'One' });
  });

  it('dominantCategoryId does not beat a higher matchCount', () => {
    expect(topCategory({ dominantCategoryId: '1', categoryDistributions: [dist('1', 'One', 3), dist('2', 'Two', 4)] })).toEqual({
      id: '2',
      name: 'Two',
    });
  });

  it('ignores entries without a numeric matchCount', () => {
    expect(topCategory({ categoryDistributions: [dist('1', 'One', '99'), dist('2', 'Two', 1), null] })).toEqual({ id: '2', name: 'Two' });
  });

  it.each([
    ['a non-digit id', [dist('12a', 'Name', 3)]],
    ['a negative id', [dist('-1', 'Name', 3)]],
    ['an 11-digit id', [dist('12345678901', 'Name', 3)]],
    ['an empty id', [dist('', 'Name', 3)]],
    ['a numeric id', [dist(33963, 'Name', 3)]],
    ['an id with a query string', [dist('1&_nkw=x', 'Name', 3)]],
    ['an empty name', [dist('1', '', 3)]],
    ['a blank name', [dist('1', '   ', 3)]],
    ['no name', [dist('1', undefined, 3)]],
    // The top one is invalid: nothing is added, the next one is not used instead.
    ['an invalid top category', [dist('x', 'Bad', 9), dist('2', 'Good', 1)]],
  ])('%s gives none', (_label, categoryDistributions) => {
    expect(topCategory({ categoryDistributions })).toBeUndefined();
  });

  it.each([
    ['no refinement', undefined],
    ['a non-object refinement', 'x'],
    ['no categoryDistributions', {}],
    ['categoryDistributions not an array', { categoryDistributions: {} }],
    ['empty categoryDistributions', { categoryDistributions: [] }],
  ])('%s gives none', (_label, refinement) => {
    expect(topCategory(refinement)).toBeUndefined();
  });

  it('accepts a 10-digit id', () => {
    expect(topCategory({ categoryDistributions: [dist('1234567890', 'Big', 1)] })).toEqual({ id: '1234567890', name: 'Big' });
  });
});

describe('categoryVenue (AC8)', () => {
  const refinement = { categoryDistributions: [{ categoryId: '33963', categoryName: 'Keyboards & Keypads', matchCount: 7 }] };

  it('builds the "eBay - <category>" venue', () => {
    expect(categoryVenue(refinement, 'mechanical keyboard')).toEqual({
      id: 'ebay-category',
      name: 'eBay - Keyboards & Keypads',
      kind: 'marketplace',
      url: 'https://www.ebay.com/sch/i.html?_nkw=mechanical%20keyboard&_sacat=33963',
      ships: true,
      local: false,
      tips: [],
      why: ['eBay category for "mechanical keyboard"'],
      categoryIds: [],
    });
  });

  it('encodes the term in the URL', () => {
    const venue = categoryVenue(refinement, 'AT&T #1 50% off?');
    expect(venue?.url).toBe('https://www.ebay.com/sch/i.html?_nkw=AT%26T%20%231%2050%25%20off%3F&_sacat=33963');
    expect(new URL(venue!.url).searchParams.get('_nkw')).toBe('AT&T #1 50% off?');
    expect(new URL(venue!.url).searchParams.get('_sacat')).toBe('33963');
  });

  it('is undefined without a valid category', () => {
    expect(categoryVenue({ categoryDistributions: [{ categoryId: 'x', categoryName: 'A', matchCount: 1 }] }, 'a')).toBeUndefined();
    expect(categoryVenue(undefined, 'a')).toBeUndefined();
  });
});
