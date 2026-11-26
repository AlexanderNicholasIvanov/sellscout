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

describe('README (run 2b, AC10)', () => {
  it.each(['sellscout.savedSearches.v1', '__fixtures', 'Save search', 'up to 50', '**Run**', '**New**', '**Delete**'])(
    'mentions %s',
    (phrase) => {
      expect(readme).toContain(phrase);
    },
  );

  it('keeps saved searches in the Privacy section', () => {
    const privacy = readme.split(/^## /m).find((section) => section.startsWith('Privacy'));
    expect(privacy).toContain('sellscout.savedSearches.v1');
  });

  it('notes the fixture endpoint under Fixture mode', () => {
    const fixtureMode = readme.split(/^#{2,3} /m).find((section) => section.startsWith('Fixture mode'));
    expect(fixtureMode).toContain('POST /api/__fixtures');
  });

  it('marks 2b done on the Roadmap', () => {
    expect(readme).toMatch(/2b\. Saved searches[^\n]*\(done/);
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
