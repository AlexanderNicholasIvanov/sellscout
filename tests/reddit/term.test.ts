// AC4: the buyer term.
import { describe, expect, it } from 'vitest';
import { buyerTerm } from '../../server/reddit/index.ts';
import { significantTokens } from '../../server/reddit/term.ts';

describe('buyerTerm (AC4)', () => {
  it.each([
    ['Sony A7 III body, low shutter count', 'Sony A7 III'],
    ['RTX 3080 (barely used)', 'RTX 3080'],
    ['mechanical keyboard', 'mechanical keyboard'],
    ['Keychron Q1; barely used', 'Keychron Q1'],
    ['Nintendo Switch | OLED', 'Nintendo Switch'],
    ['Herman Miller Aeron - size B', 'Herman Miller Aeron'],
    ['Herman-Miller Aeron', 'Herman-Miller Aeron'],
    ['  The   Leica   M6  ', 'Leica M6'],
    ['A new mint condition camera', 'camera'],
    ['the new body', 'the new body'],
    [', ,', ', ,'],
    ['', ''],
  ])('%j -> %j', (item, term) => {
    expect(buyerTerm(item)).toBe(term);
  });

  it('keeps at most 6 tokens of a 12-word item', () => {
    const term = buyerTerm('vintage walnut record cabinet turntable stand speakers amplifier tuner receiver dust cover');
    expect(term).toBe('vintage walnut record cabinet turntable stand');
    expect(term.split(' ')).toHaveLength(6);
  });

  it('keeps at most 80 characters', () => {
    const long = `${'a'.repeat(30)}x ${'b'.repeat(30)}x ${'c'.repeat(30)}x`;
    expect(buyerTerm(long)).toBe(`${'a'.repeat(30)}x ${'b'.repeat(30)}x`);
    expect(buyerTerm('z'.repeat(200))).toHaveLength(80);
  });

  it('falls back to the first 6 words of the cut text when only stop words are left', () => {
    expect(buyerTerm('a the and or for with of in, something')).toBe('a the and or for with');
  });

  it('keeps the original case and drops stop words case-insensitively', () => {
    expect(buyerTerm('THE RTX 3080 FOR Sale')).toBe('RTX 3080 Sale');
  });
});

describe('significantTokens', () => {
  it('keeps folded tokens of 2+ characters that are not stop words', () => {
    expect(significantTokens('Sony A7 III')).toEqual(['sony', 'a7', 'iii']);
    expect(significantTokens('Pokémon x card')).toEqual(['pokemon', 'card']);
  });

  it('uses every token when none is significant', () => {
    expect(significantTokens('the new body')).toEqual(['the', 'new', 'body']);
  });
});
