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

describe('README (run 3, AC15)', () => {
  const section = (name: string) => readme.split(/^## /m).find((s) => s.startsWith(`${name}\n`) || s.startsWith(`${name}\r\n`));

  it('has an "eBay" section right after "Reddit"', () => {
    expect(headings).toContain('eBay');
    expect(headings.indexOf('eBay')).toBe(headings.indexOf('Reddit') + 1);
  });

  it.each(['EBAY_CLIENT_ID', 'EBAY_CLIENT_SECRET', 'Marketplace Account Deletion', 'I do not persist eBay data'])(
    'the eBay section mentions %s',
    (phrase) => {
      expect(section('eBay')).toContain(phrase);
    },
  );

  it('says eBay receives the search term only, and prices are asking prices', () => {
    const ebay = section('eBay') ?? '';
    expect(ebay.toLowerCase()).toContain('the search term only');
    expect(ebay).toContain('not sold');
    expect(ebay).toContain('5,000');
  });

  it('keeps eBay in the Privacy section', () => {
    const privacy = section('Privacy') ?? '';
    expect(privacy).toContain('eBay receives the');
    expect(privacy).toMatch(/search term only/);
    expect(privacy).toContain('eBay keys');
  });

  it('lists the eBay fixture terms under Fixture mode', () => {
    const fixtureMode = readme.split(/^#{2,3} /m).find((s) => s.startsWith('Fixture mode')) ?? '';
    for (const term of ['ebay-401', 'ebay-429', 'ebay-timeout', 'eBay: fixture']) expect(fixtureMode).toContain(term);
  });

  it('describes the eBay section under Using it', () => {
    const using = readme.split(/^#{2,3} /m).find((s) => s.startsWith('Using it')) ?? '';
    expect(using).toContain('**Similar listings on eBay**');
    expect(using).toContain('**Search eBay yourself**');
  });

  it('marks 3 done on the Roadmap', () => {
    expect(section('Roadmap')).toMatch(/3\. \*\*Similar listings on eBay\.\*\*[^]*?\(done/);
  });
});
