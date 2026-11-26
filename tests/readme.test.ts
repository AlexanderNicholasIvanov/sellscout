// AC26: the README keeps the sections users and contributors rely on.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8');
const headings = readme
  .split(/\r?\n/)
  .filter((line) => line.startsWith('## '))
  .map((line) => line.slice(3).trim());

describe('README (AC26)', () => {
  it.each([
    'SELLSCOUT_FIXTURES=1 npm start',
    'REDDIT_CLIENT_ID',
    'REDDIT_CLIENT_SECRET',
    'REDDIT_USERNAME',
    'location is never sent',
    '2b.',
  ])('mentions %s', (phrase) => {
    expect(readme.toLowerCase()).toContain(phrase.toLowerCase());
  });
});

describe('README', () => {
  it.each(['Setup', 'Running', 'Checks', 'Editing the catalog and metros', 'Reddit', 'Privacy', 'Roadmap'])(
    'has a "%s" section',
    (name) => {
      expect(headings).toContain(name);
    },
  );
});
