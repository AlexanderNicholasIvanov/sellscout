import { describe, expect, it } from 'vitest';
import { createSearch, searchVenues } from '../../server/venues/index.ts';
import { compileCategories, keywordPattern, matchCategories } from '../../server/venues/match.ts';
import type { Venue } from '../../server/types.ts';
import { fixtureCatalog, fixtureMetros } from './fixtures.ts';

const ids = (venues: Venue[]) => venues.map((v) => v.id);
const search = createSearch({ catalog: fixtureCatalog, metros: fixtureMetros });

describe('keyword matching', () => {
  const matches = (keyword: string, text: string) => keywordPattern(keyword)?.test(text) ?? false;

  it('is case-insensitive and matches simple plurals', () => {
    expect(matches('keyboard', 'Two KEYBOARDS')).toBe(true);
    expect(matches('watch', 'three watches')).toBe(true);
    expect(matches('lens', 'two lenses')).toBe(true);
  });

  it('respects word boundaries', () => {
    expect(matches('watch', 'watchdog timer')).toBe(false);
    expect(matches('book', 'macbook pro')).toBe(false);
    expect(matches('ram', 'program')).toBe(false);
    expect(matches('ram', '16GB RAM kit')).toBe(true);
  });

  it('matches multi-word keywords as phrases', () => {
    expect(matches('graphics card', 'RTX 3080 graphics   card')).toBe(true);
    expect(matches('graphics card', 'card with graphics')).toBe(false);
    expect(matches('a7 iii', 'Sony A7 III body')).toBe(true);
  });

  it('scores a category by distinct keywords matched', () => {
    const compiled = compileCategories([{ id: 'x', name: 'X', keywords: ['keyboard', 'keyboard', 'keycap'] }]);
    expect(matchCategories('keyboard keyboard keycaps', compiled)).toEqual([
      expect.objectContaining({ score: 2, keywords: ['keyboard', 'keycap'] }),
    ]);
  });

  it('ignores blank keywords', () => {
    expect(keywordPattern('   ')).toBeUndefined();
  });
});

describe('ranking rules (fixture catalog)', () => {
  it('orders by best category score, then specialist before general', () => {
    const result = search({ item: 'mechanical keyboard', delivery: 'both' });
    // kb scores 2 (keyboard + mechanical keyboard), music scores 1 (keyboard).
    expect(ids(result.venues)).toEqual(['kb-a', 'kb-b', 'music-sub', 'ebay', 'craigslist', 'facebook-marketplace']);
    expect(result.plan.categories).toEqual([
      { id: 'kb', name: 'Keyboards' },
      { id: 'music', name: 'Music' },
    ]);
  });

  it('breaks score ties by catalog order', () => {
    // "keyboard mechanical" is not the phrase, so kb and music both score 1: catalog order wins.
    const result = search({ item: 'keyboard mechanical', delivery: 'both' });
    expect(ids(result.venues).slice(0, 3)).toEqual(['music-sub', 'kb-a', 'kb-b']);
    expect(result.plan.categories.map((c) => c.id)).toEqual(['kb', 'music']);
  });

  it('lists matched keywords in why, and a fixed why for general venues', () => {
    const result = search({ item: 'Mechanical keyboard with keycaps', delivery: 'both' });
    expect(result.venues.find((v) => v.id === 'kb-a')?.why).toEqual(['keyboard', 'mechanical keyboard', 'keycap']);
    expect(result.venues.find((v) => v.id === 'music-sub')?.why).toEqual(['keyboard']);
    expect(result.venues.find((v) => v.id === 'ebay')?.why).toEqual(['Sells almost anything']);
  });

  it('matches plurals', () => {
    const result = search({ item: 'two cameras and lenses', delivery: 'both' });
    expect(result.venues[0]).toMatchObject({ id: 'photo-shop', why: ['camera', 'lens'] });
  });
});

describe('ranking on the real catalog (AC9)', () => {
  const generalIds = new Set(['ebay', 'facebook-marketplace', 'craigslist', 'offerup', 'mercari']);
  const firstGeneral = (venues: Venue[]) => venues.findIndex((v) => generalIds.has(v.id));

  it('"Sony A7 III body" ranks r/photomarket above every general venue', () => {
    const { venues, plan } = searchVenues({ item: 'Sony A7 III body', delivery: 'both' });
    const photomarket = venues.findIndex((v) => v.name === 'r/photomarket');
    expect(photomarket).toBeGreaterThanOrEqual(0);
    expect(photomarket).toBeLessThan(firstGeneral(venues));
    expect(venues[photomarket].why).toEqual(expect.arrayContaining(['a7 iii']));
    expect(plan.categories[0].id).toBe('photo');
  });

  it('"mechanical keyboard" puts r/mechmarket first among subreddits', () => {
    const { venues } = searchVenues({ item: 'mechanical keyboard', delivery: 'both' });
    expect(venues.filter((v) => v.kind === 'subreddit')[0]?.name).toBe('r/mechmarket');
    expect(venues[0].name).toBe('r/mechmarket');
  });

  it('"RTX 3080 graphics card" includes r/hardwareswap above the general venues', () => {
    const { venues } = searchVenues({ item: 'RTX 3080 graphics card', delivery: 'both' });
    const hardwareswap = venues.findIndex((v) => v.name === 'r/hardwareswap');
    expect(hardwareswap).toBeGreaterThanOrEqual(0);
    expect(hardwareswap).toBeLessThan(firstGeneral(venues));
    expect(venues[hardwareswap].why).toEqual(expect.arrayContaining(['rtx', 'graphics card']));
  });

  it('"Two KEYBOARDS" matches the keyboard category (case + plural)', () => {
    const { plan, venues } = searchVenues({ item: 'Two KEYBOARDS', delivery: 'both' });
    expect(plan.categories.map((c) => c.id)).toContain('keyboards');
    expect(venues.map((v) => v.name)).toContain('r/mechmarket');
  });

  it('"watchdog timer" does not match the keyword watch', () => {
    const { plan, venues } = searchVenues({ item: 'watchdog timer', delivery: 'both' });
    expect(plan.categories.map((c) => c.id)).not.toContain('watches');
    expect(venues.map((v) => v.name)).not.toContain('r/Watchexchange');
  });

  it('"rolex watches" matches watches via the plural', () => {
    const { plan, venues } = searchVenues({ item: 'two Rolex watches', delivery: 'both' });
    expect(plan.categories[0].id).toBe('watches');
    expect(venues[0].why).toEqual(expect.arrayContaining(['watch', 'rolex']));
  });
});
