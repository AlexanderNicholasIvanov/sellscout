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

  it('folds diacritics on both sides', () => {
    const compiled = compileCategories([
      { id: 'cafe', name: 'Cafe', keywords: ['café'] },
      { id: 'poke', name: 'Poke', keywords: ['pokemon'] },
    ]);
    expect(matchCategories('Cafe chairs', compiled).map((m) => m.category.id)).toEqual(['cafe']);
    expect(matchCategories('CAFÉ sign, Pokémon cards', compiled).map((m) => m.category.id)).toEqual(['cafe', 'poke']);
  });
});

describe('ranking rules (fixture catalog)', () => {
  it('orders by best category score, then specialist before general', () => {
    const result = search({ item: 'mechanical keyboard', delivery: 'both', window: 30 });
    // kb scores 2 (keyboard + mechanical keyboard), music scores 1 (keyboard).
    expect(ids(result.venues)).toEqual(['kb-a', 'kb-b', 'music-sub', 'ebay', 'craigslist', 'facebook-marketplace']);
    expect(result.plan.categories).toEqual([
      { id: 'kb', name: 'Keyboards' },
      { id: 'music', name: 'Music' },
    ]);
  });

  it('breaks score ties by catalog order', () => {
    // "keyboard mechanical" is not the phrase, so kb and music both score 1: catalog order wins.
    const result = search({ item: 'keyboard mechanical', delivery: 'both', window: 30 });
    expect(ids(result.venues).slice(0, 3)).toEqual(['music-sub', 'kb-a', 'kb-b']);
    expect(result.plan.categories.map((c) => c.id)).toEqual(['kb', 'music']);
  });

  it('lists matched keywords in why, and a fixed why for general venues', () => {
    const result = search({ item: 'Mechanical keyboard with keycaps', delivery: 'both', window: 30 });
    expect(result.venues.find((v) => v.id === 'kb-a')?.why).toEqual(['mechanical keyboard', 'keycap']);
    expect(result.venues.find((v) => v.id === 'music-sub')?.why).toEqual(['keyboard']);
    expect(result.venues.find((v) => v.id === 'ebay')?.why).toEqual(['Sells almost anything']);
  });

  it('matches plurals', () => {
    const result = search({ item: 'two cameras and lenses', delivery: 'both', window: 30 });
    expect(result.venues[0]).toMatchObject({ id: 'photo-shop', why: ['camera', 'lens'] });
  });
});

describe('ranking on the real catalog (AC9)', () => {
  const generalIds = new Set(['ebay', 'facebook-marketplace', 'craigslist', 'offerup', 'mercari']);
  const firstGeneral = (venues: Venue[]) => venues.findIndex((v) => generalIds.has(v.id));

  it('"Sony A7 III body" ranks r/photomarket above every general venue', () => {
    const { venues, plan } = searchVenues({ item: 'Sony A7 III body', delivery: 'both', window: 30 });
    const photomarket = venues.findIndex((v) => v.name === 'r/photomarket');
    expect(photomarket).toBeGreaterThanOrEqual(0);
    expect(photomarket).toBeLessThan(firstGeneral(venues));
    expect(venues[photomarket].why).toEqual(expect.arrayContaining(['a7 iii']));
    expect(plan.categories[0].id).toBe('photo');
  });

  it('"mechanical keyboard" puts r/mechmarket first among subreddits', () => {
    const { venues } = searchVenues({ item: 'mechanical keyboard', delivery: 'both', window: 30 });
    expect(venues.filter((v) => v.kind === 'subreddit')[0]?.name).toBe('r/mechmarket');
    expect(venues[0].name).toBe('r/mechmarket');
  });

  it('"RTX 3080 graphics card" includes r/hardwareswap above the general venues', () => {
    const { venues } = searchVenues({ item: 'RTX 3080 graphics card', delivery: 'both', window: 30 });
    const hardwareswap = venues.findIndex((v) => v.name === 'r/hardwareswap');
    expect(hardwareswap).toBeGreaterThanOrEqual(0);
    expect(hardwareswap).toBeLessThan(firstGeneral(venues));
    expect(venues[hardwareswap].why).toEqual(expect.arrayContaining(['rtx', 'graphics card']));
  });

  it('"Two KEYBOARDS" matches the keyboard category (case + plural)', () => {
    const { plan, venues } = searchVenues({ item: 'Two KEYBOARDS', delivery: 'both', window: 30 });
    expect(plan.categories.map((c) => c.id)).toContain('keyboards');
    expect(venues.map((v) => v.name)).toContain('r/mechmarket');
  });

  it('"watchdog timer" does not match the keyword watch', () => {
    const { plan, venues } = searchVenues({ item: 'watchdog timer', delivery: 'both', window: 30 });
    expect(plan.categories.map((c) => c.id)).not.toContain('watches');
    expect(venues.map((v) => v.name)).not.toContain('r/Watchexchange');
  });

  it('"Pokémon Charizard card" matches the trading-card categories despite the accent', () => {
    const { plan, venues } = searchVenues({ item: 'Pokémon Charizard card', delivery: 'both', window: 30 });
    expect(plan.categories.map((c) => c.id)).toEqual(expect.arrayContaining(['pokemon', 'trading-cards']));
    expect(venues[0].name).toBe('r/pkmntcgtrades');
    expect(plan.searchTerm).toBe('Pokémon Charizard card');
  });

  it('"rolex watches" matches watches via the plural', () => {
    const { plan, venues } = searchVenues({ item: 'two Rolex watches', delivery: 'both', window: 30 });
    expect(plan.categories[0].id).toBe('watches');
    expect(venues[0].why).toEqual(expect.arrayContaining(['watch', 'rolex']));
  });
});

describe('ranking regressions on the real catalog (review round 1)', () => {
  const names = (item: string) => searchVenues({ item, delivery: 'both', window: 30 }).venues.map((v) => v.name);
  const categoriesOf = (item: string) => searchVenues({ item, delivery: 'both', window: 30 }).plan.categories.map((c) => c.id);

  it.each(['Samsung OLED TV', 'DJI drone', 'Kindle e-reader'])(
    '%j does not surface Apple-only or phone trade-in boards at the top',
    (item) => {
      const list = names(item);
      expect(list).not.toContain('r/appleswap');
      expect(list.slice(0, 3)).not.toContain('Swappa');
      expect(list.slice(0, 3)).not.toContain('Back Market (trade-in)');
    },
  );

  it('keeps r/appleswap for Apple devices only', () => {
    expect(names('iPhone 15 Pro 256GB')).toContain('r/appleswap');
    expect(names('MacBook Air M2')).toContain('r/appleswap');
    expect(names('Samsung Galaxy S24')).not.toContain('r/appleswap');
  });

  it('"MSR tent" ranks the general outdoor boards above Patagonia Worn Wear', () => {
    const list = names('MSR tent');
    const best = Math.min(
      ...['r/ULgeartrade', 'GearTrade'].map((n) => list.indexOf(n)).filter((i) => i >= 0),
    );
    expect(Number.isFinite(best)).toBe(true);
    const wornWear = list.indexOf('Patagonia Worn Wear (trade-in)');
    expect(wornWear === -1 || wornWear > best).toBe(true);
  });

  it('"Patagonia Nano Puff jacket" lists Patagonia Worn Wear first', () => {
    expect(names('Patagonia Nano Puff jacket')[0]).toBe('Patagonia Worn Wear (trade-in)');
  });

  it('keeps brand- or niche-only boards off unrelated items', () => {
    expect(names('1987 Topps baseball card')).not.toContain('r/pkmntcgtrades');
    expect(names('1987 Topps baseball card')).not.toContain('Card Kingdom buylist');
    expect(names('1987 Topps baseball card')).not.toContain('TCGplayer');
    expect(names('MTG commander deck')).toContain('Card Kingdom buylist');
    expect(names('violin with case')).not.toContain('TalkBass Classifieds');
    expect(names('Fender Precision Bass')).toContain('TalkBass Classifieds');
    expect(names('Funko Pop figures')).not.toContain('BrickLink');
    expect(names('LEGO 75192')).toContain('BrickLink');
    expect(names('Casio G-Shock watch')).not.toContain('The RealReal');
    expect(names('Louis Vuitton handbag')).toContain('The RealReal');
    expect(names('kayak paddle')).not.toContain('r/ULgeartrade');
  });

  it('does not mis-rank on generic words', () => {
    expect(categoriesOf('food processor')).not.toContain('pc-parts');
    expect(categoriesOf('console table')).not.toContain('video-games');
    expect(categoriesOf('console table')).toContain('furniture');
    expect(categoriesOf('Ring video doorbell')).not.toContain('jewelry');
    expect(categoriesOf('diamond engagement ring')[0]).toBe('jewelry');
    expect(categoriesOf('dog trainer')).not.toContain('sneakers');
    expect(categoriesOf('Star Trek DVDs')).not.toContain('bikes');
  });

  it('"Wahoo bike trainer" ranks bikes first', () => {
    const { plan, venues } = searchVenues({ item: 'Wahoo bike trainer', delivery: 'both', window: 30 });
    expect(plan.categories[0].id).toBe('bikes');
    expect(plan.categories.map((c) => c.id)).not.toContain('sneakers');
    expect(venues[0].categoryIds).toContain('bikes');
  });
});
