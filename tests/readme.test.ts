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

  it.each(['EBAY_CLIENT_ID', 'EBAY_CLIENT_SECRET', 'Marketplace Account Deletion', 'Not persisting eBay data'])(
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

describe('README (run 4, AC15)', () => {
  const section = (name: string) =>
    readme.split(/^## /m).find((s) => s.startsWith(`${name}\n`) || s.startsWith(`${name}\r\n`)) ?? '';

  it.each(['ANTHROPIC_API_KEY', 'SELLSCOUT_CLAUDE_MODEL', 'claude-opus-5-5', 'never the location'])('mentions %s', (phrase) => {
    expect(readme).toContain(phrase);
  });

  it('has a "Claude (optional)" section after "eBay" and before "Privacy"', () => {
    expect(headings).toContain('Claude (optional)');
    expect(headings.indexOf('Claude (optional)')).toBeGreaterThan(headings.indexOf('eBay'));
    expect(headings.indexOf('Claude (optional)')).toBeLessThan(headings.indexOf('Privacy'));
  });

  it('the Claude section covers the key, the model, cost and the fallback', () => {
    const claude = section('Claude (optional)');
    for (const phrase of [
      'console.anthropic.com',
      'ANTHROPIC_API_KEY=',
      'SELLSCOUT_CLAUDE_MODEL',
      'claude-opus-5-5',
      'structured outputs',
      '`effort`',
      'One request per search, billed to your key',
      'low effort',
      'used the built-in catalog.',
      'AI suggested',
    ]) {
      expect(claude).toContain(phrase);
    }
  });

  it('keeps Claude in the Privacy section, never with the location', () => {
    const privacy = section('Privacy');
    expect(privacy).toContain("Claude receives the item text and the catalog's category list");
    expect(privacy).toContain('never the location, saved searches or your Reddit and eBay keys');
  });

  it('lists the Claude fixture terms under Fixture mode', () => {
    const fixtureMode = readme.split(/^#{2,3} /m).find((s) => s.startsWith('Fixture mode')) ?? '';
    for (const term of [
      'claude-timeout',
      'claude-offline',
      'claude-401',
      'claude-429',
      'claude-500',
      'claude-refusal',
      'claude-max-tokens',
      'claude-invalid',
      'Claude: fixture',
      'via Claude',
      'r/MechanicalKeyboards',
    ]) {
      expect(fixtureMode).toContain(term);
    }
  });

  it('marks 4 done on the Roadmap', () => {
    expect(section('Roadmap')).toMatch(/4\. \*\*Smarter matching with Claude\.\*\*[^]*?\(done/);
  });
});

describe('README (run 5, AC16)', () => {
  const section = (name: string) =>
    readme.split(/^## /m).find((s) => s.startsWith(`${name}\n`) || s.startsWith(`${name}\r\n`)) ?? '';

  it.each(['## Desktop app', '## Settings', 'npm run desktop', 'SELLSCOUT_SETTINGS_FILE', 'Run anyway'])('mentions %s', (phrase) => {
    expect(readme).toContain(phrase);
  });

  it('has "Desktop app" right before "Setup", and a "Settings" section', () => {
    expect(headings).toContain('Desktop app');
    expect(headings.indexOf('Setup')).toBe(headings.indexOf('Desktop app') + 1);
    expect(headings).toContain('Settings');
  });

  it('the Desktop app section covers installing, SmartScreen, npm run desktop, the settings file, uninstalling and .env', () => {
    const desktop = section('Desktop app');
    for (const phrase of [
      'sellscout-windows-installer',
      'npm run desktop:dist',
      'More info',
      'Run anyway',
      'npm run desktop',
      'settings.json',
      'Uninstall',
      "doesn't read `.env`",
    ]) {
      expect(desktop).toContain(phrase);
    }
  });

  it('the Settings section covers the file, the environment winning, read-only and plain text', () => {
    const settings = section('Settings');
    for (const phrase of ['SELLSCOUT_SETTINGS_FILE', 'environment', 'wins', 'read-only', 'plain text', 'user profile']) {
      expect(settings).toContain(phrase);
    }
  });

  it('keeps Settings and the desktop window in the Privacy section', () => {
    const privacy = section('Privacy');
    expect(privacy).toContain('Keys saved in [Settings](#settings) stay in that settings file');
    expect(privacy).toContain('never in the browser or any log');
    expect(privacy).toContain('The desktop window talks only to its own local server');
  });

  it('marks 5 done on the Roadmap', () => {
    expect(section('Roadmap')).toMatch(/5\. \*\*Desktop app and Settings\.\*\*[^]*?\(done/);
  });
});
