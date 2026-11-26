import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { searchVenues } from '../server/venues/index.ts';

const readRepoFile = (name: string) => readFileSync(fileURLToPath(new URL(`../${name}`, import.meta.url)), 'utf8');

describe('smoke', () => {
  it('searchVenues collapses whitespace in the search term', () => {
    const result = searchVenues({ item: '  vintage   road\tbike \n ', delivery: 'both', window: 30 });
    expect(result.plan.searchTerm).toBe('vintage road bike');
    expect(result.plan.source).toBe('catalog');
  });

  it('.gitattributes forces LF line endings', () => {
    expect(readRepoFile('.gitattributes').split(/\r?\n/)).toContain('* text=auto eol=lf');
  });

  it('.env.example lists PORT', () => {
    expect(readRepoFile('.env.example').split(/\r?\n/)).toContain('PORT=');
  });
});
