import { describe, expect, it } from 'vitest';
import { catalog } from '../../server/data/catalog.ts';
import { buildSchema, buildSystemPrompt } from '../../server/claude/prompt.ts';
import { fixtureCatalog } from '../venues/fixtures.ts';

describe('the system prompt (run 4 "The planner")', () => {
  it('lists every catalog category as "id: name - first 4 keywords"', () => {
    const prompt = buildSystemPrompt(catalog);
    const lines = prompt.split('\n');
    for (const category of catalog.categories) {
      expect(lines).toContain(`${category.id}: ${category.name} - ${category.keywords.slice(0, 4).join(', ')}`);
    }
    expect(lines).toContain('keyboards: Mechanical keyboards - mechanical keyboard, keyboard, keycap, gmk');
  });

  it('is the same bytes every time and depends only on the catalog', () => {
    expect(buildSystemPrompt(catalog)).toBe(buildSystemPrompt(catalog));
    expect(buildSystemPrompt(fixtureCatalog)).not.toBe(buildSystemPrompt(catalog));
    expect(buildSystemPrompt(fixtureCatalog)).toMatch(/\nkb: Keyboards - keyboard, mechanical keyboard, keycap\nmusic: Music - synth, keyboard\n/);
  });
});

describe('the answer schema (run 4 "The planner")', () => {
  it('is an object of categoryIds (catalog enum), searchTerm and subreddits, all required, nothing else', () => {
    expect(buildSchema(fixtureCatalog)).toEqual({
      type: 'object',
      properties: {
        categoryIds: { type: 'array', items: { type: 'string', enum: ['kb', 'music', 'watches', 'photo'] } },
        searchTerm: { type: 'string' },
        subreddits: { type: 'array', items: { type: 'string' } },
      },
      required: ['categoryIds', 'searchTerm', 'subreddits'],
      additionalProperties: false,
    });
  });

  it('the enum is every catalog category id', () => {
    const schema = buildSchema(catalog) as { properties: { categoryIds: { items: { enum: string[] } } } };
    expect(schema.properties.categoryIds.items.enum).toEqual(catalog.categories.map((c) => c.id));
  });
});
