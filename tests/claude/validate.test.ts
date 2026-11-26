import { describe, expect, it } from 'vitest';
import { catalog } from '../../server/data/catalog.ts';
import { catalogSubreddits, createValidator } from '../../server/claude/validate.ts';

const validate = createValidator(catalog);
const answer = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  categoryIds: ['keyboards'],
  searchTerm: 'mechanical keyboard',
  subreddits: [],
  ...overrides,
});

describe('validation: the shape (run 4 AC6)', () => {
  it('passes a valid answer through', () => {
    expect(validate(answer({ subreddits: ['MechanicalKeyboards'] }))).toEqual({
      categoryIds: ['keyboards'],
      searchTerm: 'mechanical keyboard',
      subreddits: ['MechanicalKeyboards'],
    });
  });

  it.each([
    ['null', null],
    ['a string', 'keyboards'],
    ['a number', 42],
    ['an array', [answer()]],
    ['categoryIds a string', answer({ categoryIds: 'keyboards' })],
    ['categoryIds missing', { searchTerm: 'x', subreddits: [] }],
    ['categoryIds with a number', answer({ categoryIds: ['keyboards', 1] })],
    ['searchTerm missing', { categoryIds: [], subreddits: [] }],
    ['searchTerm a number', answer({ searchTerm: 5 })],
    ['subreddits missing', { categoryIds: [], searchTerm: 'x' }],
    ['subreddits a string', answer({ subreddits: 'mechmarket' })],
    ['subreddits with null', answer({ subreddits: [null] })],
  ])('rejects %s as an unusable answer', (_label, value) => {
    expect(validate(value)).toBeUndefined();
  });
});

describe('validation: categoryIds (run 4 AC6)', () => {
  it('keeps only catalog ids', () => {
    expect(validate(answer({ categoryIds: ['not-a-category', 'keyboards', 'KEYBOARDS'] }))?.categoryIds).toEqual(['keyboards']);
  });

  it('keeps the first occurrence only, in Claude order', () => {
    expect(validate(answer({ categoryIds: ['photo', 'keyboards', 'photo', 'audio', 'keyboards'] }))?.categoryIds).toEqual([
      'photo',
      'keyboards',
      'audio',
    ]);
  });

  it('keeps at most 5', () => {
    const ids = catalog.categories.slice(0, 8).map((c) => c.id);
    expect(validate(answer({ categoryIds: ids }))?.categoryIds).toEqual(ids.slice(0, 5));
  });

  it('counts the limit after dropping unknown ids and duplicates', () => {
    const ids = catalog.categories.slice(0, 6).map((c) => c.id);
    const noisy = ['nope', ids[0], ids[0], 'nope-2', ...ids.slice(1)];
    expect(validate(answer({ categoryIds: noisy }))?.categoryIds).toEqual(ids.slice(0, 5));
  });

  it('an empty list is valid', () => {
    expect(validate(answer({ categoryIds: [] }))?.categoryIds).toEqual([]);
  });
});

describe('validation: searchTerm (run 4 AC6)', () => {
  it('is trimmed and its whitespace collapsed', () => {
    expect(validate(answer({ searchTerm: '  sony \t a7   iii\n' }))?.searchTerm).toBe('sony a7 iii');
  });

  it('is cut to 80 characters', () => {
    const term = validate(answer({ searchTerm: 'x'.repeat(100) }))?.searchTerm;
    expect(term).toBe('x'.repeat(80));
    expect(validate(answer({ searchTerm: 'y'.repeat(80) }))?.searchTerm).toBe('y'.repeat(80));
  });

  it.each([[''], ['   '], ['\n\t']])('empty (%j) is an unusable answer', (searchTerm) => {
    expect(validate(answer({ searchTerm }))).toBeUndefined();
  });
});

describe('validation: subreddits (run 4 AC6)', () => {
  it('strips a leading r/ or /r/', () => {
    expect(validate(answer({ subreddits: ['r/MechanicalKeyboards', '/r/keyboards_wtb'] }))?.subreddits).toEqual([
      'MechanicalKeyboards',
      'keyboards_wtb',
    ]);
  });

  it('keeps only names matching ^[A-Za-z0-9_]{3,21}$', () => {
    expect(
      validate(answer({ subreddits: ['ok_name', 'ab', 'a'.repeat(22), 'b'.repeat(21), 'bad name!', 'dash-name', 'ünicode', '../x', 'r/'] }))
        ?.subreddits,
    ).toEqual(['ok_name', 'b'.repeat(21)]);
  });

  it('drops case-insensitive duplicates (first spelling kept)', () => {
    expect(validate(answer({ subreddits: ['MechanicalKeyboards', 'mechanicalkeyboards', 'r/MECHANICALKEYBOARDS'] }))?.subreddits).toEqual([
      'MechanicalKeyboards',
    ]);
  });

  it('drops names already in the catalog, case-insensitive', () => {
    expect(catalogSubreddits(catalog).has('mechmarket')).toBe(true);
    expect(validate(answer({ subreddits: ['mechmarket', 'r/MechMarket', 'hardwareswap', 'NewSub'] }))?.subreddits).toEqual(['NewSub']);
  });

  it('keeps at most 5', () => {
    const names = ['aaa', 'bbb', 'ccc', 'ddd', 'eee', 'fff', 'ggg'];
    expect(validate(answer({ subreddits: names }))?.subreddits).toEqual(names.slice(0, 5));
  });

  it('counts the limit after dropping bad names', () => {
    expect(validate(answer({ subreddits: ['x', 'aaa', 'mechmarket', 'bbb', 'aaa', 'ccc', 'ddd', 'eee', 'fff'] }))?.subreddits).toEqual([
      'aaa',
      'bbb',
      'ccc',
      'ddd',
      'eee',
    ]);
  });
});
