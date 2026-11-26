import { describe, expect, it } from 'vitest';
import { searchVenues } from '../../server/venues/index.ts';
import type { Venue } from '../../server/types.ts';

const urls = (venues: Venue[]) => venues.flatMap((v) => (v.searchUrl ? [v.url, v.searchUrl] : [v.url]));

describe('search links (AC12)', () => {
  const item = 'Nike Air Max 90 & box';
  const encoded = 'Nike%20Air%20Max%2090%20%26%20box';

  it('replaces {q} with the encodeURIComponent of the search term', () => {
    const { venues } = searchVenues({ item, location: 'Seattle', delivery: 'both', window: 30 });
    expect(encodeURIComponent(item)).toBe(encoded);
    const withSearch = venues.filter((v) => v.searchUrl);
    expect(withSearch.length).toBeGreaterThan(0);
    for (const venue of withSearch) {
      expect(venue.searchUrl, venue.id).toContain(encoded);
      expect(venue.searchUrl, venue.id).not.toContain('{q}');
    }
    expect(venues.find((v) => v.id === 'ebay')?.searchUrl).toBe(`https://www.ebay.com/sch/i.html?_nkw=${encoded}`);
    expect(venues.find((v) => v.id === 'r-sneakermarket')?.searchUrl).toBe(
      `https://www.reddit.com/r/sneakermarket/search/?q=${encoded}&restrict_sr=1`,
    );
  });

  it('puts no raw space or "&" from the term in any URL', () => {
    for (const location of [undefined, 'Seattle']) {
      const { venues } = searchVenues({ item, location, delivery: 'both', window: 30 });
      for (const url of urls(venues)) {
        expect(url).not.toMatch(/\s/);
        expect(url).not.toContain('& box');
        expect(url).not.toContain('&box');
        expect(url).toMatch(/^https:\/\//);
      }
    }
  });

  it('leaves Facebook Marketplace as the generic search', () => {
    const { venues } = searchVenues({ item, location: 'Seattle', delivery: 'both', window: 30 });
    expect(venues.find((v) => v.id === 'facebook-marketplace')?.searchUrl).toBe(
      `https://www.facebook.com/marketplace/search/?query=${encoded}`,
    );
  });

  it('encodes characters that would break a query string', () => {
    const { venues } = searchVenues({ item: 'camera #1 50% off? a=b/c', delivery: 'both', window: 30 });
    const ebay = venues.find((v) => v.id === 'ebay');
    expect(ebay?.searchUrl).toBe(`https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent('camera #1 50% off? a=b/c')}`);
  });
});
