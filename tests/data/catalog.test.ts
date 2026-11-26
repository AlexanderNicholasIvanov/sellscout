import { describe, expect, it } from 'vitest';
import { catalog } from '../../server/data/catalog.ts';
import type { VenueKind } from '../../server/types.ts';

const KINDS: VenueKind[] = ['marketplace', 'subreddit', 'forum', 'facebook', 'local-classifieds'];

describe('board catalog (AC8)', () => {
  const { categories, venues } = catalog;
  const categoryIds = new Set(categories.map((c) => c.id));

  it('has at least 15 categories and 50 venues', () => {
    expect(categories.length).toBeGreaterThanOrEqual(15);
    expect(venues.length).toBeGreaterThanOrEqual(50);
  });

  it('has unique category ids and unique venue ids', () => {
    expect(categoryIds.size).toBe(categories.length);
    expect(new Set(venues.map((v) => v.id)).size).toBe(venues.length);
  });

  it('gives every category a name and lower-case, non-blank keywords', () => {
    for (const category of categories) {
      expect(category.name.trim(), category.id).not.toBe('');
      expect(category.keywords.length, category.id).toBeGreaterThan(0);
      for (const keyword of category.keywords) {
        expect(keyword, category.id).toBe(keyword.toLowerCase().trim());
        expect(keyword, category.id).not.toBe('');
      }
    }
  });

  it('avoids keywords too generic to rank well', () => {
    const keywords = categories.flatMap((c) => c.keywords);
    for (const generic of ['case', 'set', 'item', 'thing', 'new', 'used']) expect(keywords).not.toContain(generic);
  });

  it('uses https URLs and {q} search templates', () => {
    for (const venue of venues) {
      expect(venue.url, venue.id).toMatch(/^https:\/\//);
      if (venue.searchUrlTemplate !== undefined) {
        expect(venue.searchUrlTemplate, venue.id).toMatch(/^https:\/\//);
        expect(venue.searchUrlTemplate, venue.id).toContain('{q}');
      }
    }
  });

  it('gives every venue a valid kind, a delivery mode and 1-3 tips', () => {
    for (const venue of venues) {
      expect(KINDS, venue.id).toContain(venue.kind);
      expect(venue.ships || venue.local, venue.id).toBe(true);
      expect(venue.tips.length, venue.id).toBeGreaterThanOrEqual(1);
      expect(venue.tips.length, venue.id).toBeLessThanOrEqual(3);
    }
  });

  it('makes every venue general with no categories, or a specialist with existing categories', () => {
    for (const venue of venues) {
      if (venue.general) {
        expect(venue.categoryIds, venue.id).toEqual([]);
      } else {
        expect(venue.categoryIds.length, venue.id).toBeGreaterThanOrEqual(1);
        for (const id of venue.categoryIds) expect(categoryIds.has(id), `${venue.id} -> ${id}`).toBe(true);
      }
    }
  });

  it('serves every category with at least one specialist venue', () => {
    const served = new Set(venues.flatMap((v) => v.categoryIds));
    for (const category of categories) expect(served.has(category.id), category.id).toBe(true);
  });

  it('lists the general venues, with Craigslist as a generic local link', () => {
    const general = venues.filter((v) => v.general).map((v) => v.id);
    expect(general).toEqual(expect.arrayContaining(['ebay', 'facebook-marketplace', 'craigslist', 'offerup', 'mercari']));
    const craigslist = venues.find((v) => v.id === 'craigslist');
    expect(craigslist).toMatchObject({ url: 'https://www.craigslist.org/about/sites', ships: false, local: true });
    expect(craigslist?.searchUrlTemplate).toBeUndefined();
  });

  it('has an ISO reviewed date', () => {
    expect(catalog.reviewed).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(new Date(`${catalog.reviewed}T00:00:00Z`).toISOString().slice(0, 10)).toBe(catalog.reviewed);
  });

  it('lists no firearms or ammunition venues', () => {
    const banned = /\b(guns?|firearms?|ammo|ammunition|rifles?|pistols?|armslist|gunbroker)\b/i;
    for (const venue of venues) {
      expect(venue.name, venue.id).not.toMatch(banned);
      expect(venue.id, venue.id).not.toMatch(banned);
      expect(venue.url, venue.id).not.toMatch(banned);
    }
  });
});
