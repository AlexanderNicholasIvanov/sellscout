import { describe, expect, it } from 'vitest';
import { metros } from '../../server/data/metros.ts';
import { normalizePlace } from '../../server/venues/location.ts';

describe('metro table (AC13)', () => {
  it('has at least 30 metros with unique ids', () => {
    expect(metros.length).toBeGreaterThanOrEqual(30);
    expect(new Set(metros.map((m) => m.id)).size).toBe(metros.length);
  });

  it('includes the largest metros and Seattle', () => {
    const subs = metros.map((m) => m.craigslist);
    for (const sub of ['newyork', 'losangeles', 'chicago', 'sfbay', 'seattle', 'washingtondc', 'dallas', 'houston']) {
      expect(subs).toContain(sub);
    }
  });

  it('uses lower-case letter-only Craigslist subdomains', () => {
    for (const metro of metros) expect(metro.craigslist, metro.id).toMatch(/^[a-z]+$/);
  });

  it('uses 3-digit ZIP prefixes, never shared between metros', () => {
    const owner = new Map<string, string>();
    for (const metro of metros) {
      expect(metro.zipPrefixes.length, metro.id).toBeGreaterThan(0);
      for (const prefix of metro.zipPrefixes) {
        expect(prefix, metro.id).toMatch(/^\d{3}$/);
        expect(owner.get(prefix), `${prefix} in ${metro.id}`).toBeUndefined();
        owner.set(prefix, metro.id);
      }
    }
  });

  it('uses lower-case aliases, none shared between metros', () => {
    const owner = new Map<string, string>();
    for (const metro of metros) {
      expect(metro.aliases.length, metro.id).toBeGreaterThan(0);
      for (const alias of metro.aliases) {
        expect(alias, metro.id).toBe(alias.toLowerCase());
        const key = normalizePlace(alias);
        expect(owner.get(key), `${alias} in ${metro.id}`).toBeUndefined();
        owner.set(key, metro.id);
      }
    }
  });

  it('gives every metro a name and a 2-letter state', () => {
    for (const metro of metros) {
      expect(metro.name.trim(), metro.id).not.toBe('');
      expect(metro.state, metro.id).toMatch(/^[A-Z]{2}$/);
    }
  });

  it('names a buy/sell subreddit only as a bare subreddit name', () => {
    for (const metro of metros) {
      if (metro.buySellSubreddit !== undefined) expect(metro.buySellSubreddit, metro.id).toMatch(/^\w+$/);
    }
  });
});
