// The fixed parts of the Claude request: the system prompt and the answer schema. Both are built
// from the catalog once, so every search sends the same bytes.
import type { Catalog } from '../types.ts';

/** Keywords per category listed in the system prompt. */
export const PROMPT_KEYWORDS = 4;

const INSTRUCTION = [
  'You help a person in the United States sell a used item. They describe the item; you choose where to post it and what to search for.',
  'Answer with JSON only, matching the schema:',
  '- categoryIds: the ids of the catalog categories below that fit the item, best fit first (at most 5). Use an empty list when none fits.',
  '- searchTerm: one short search term (2-6 words, no punctuation) a buyer would type to find this item on Reddit or eBay, e.g. brand and model.',
  '- subreddits: up to 5 real, active subreddit names (without "r/") where people buy or trade this kind of item, beyond the catalog. Use an empty list when unsure.',
  'Catalog categories (id: name - example keywords):',
].join('\n');

/** `id: name - first keywords`, one line per catalog category, after a fixed instruction. */
export function buildSystemPrompt(catalog: Catalog): string {
  const lines = catalog.categories.map(
    (category) => `${category.id}: ${category.name} - ${category.keywords.slice(0, PROMPT_KEYWORDS).join(', ')}`,
  );
  return `${INSTRUCTION}\n${lines.join('\n')}`;
}

/** The structured-output schema. Limits (counts, lengths, name rules) are enforced in code. */
export function buildSchema(catalog: Catalog): Record<string, unknown> {
  return {
    type: 'object',
    properties: {
      categoryIds: { type: 'array', items: { type: 'string', enum: catalog.categories.map((category) => category.id) } },
      searchTerm: { type: 'string' },
      subreddits: { type: 'array', items: { type: 'string' } },
    },
    required: ['categoryIds', 'searchTerm', 'subreddits'],
    additionalProperties: false,
  };
}
