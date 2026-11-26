import { describe, expect, it } from 'vitest';
import { hasEbayKeys, hasRedditKeys, parsePort, readConfig } from '../server/config.ts';
import { parsePort as parsePortFromMain } from '../server/main.ts';

const ID = 'SENTINEL-ID-456';
const SECRET = 'SENTINEL-SECRET-123';

describe('readConfig (AC3)', () => {
  it('defaults everything for an empty environment', () => {
    expect(readConfig({})).toEqual({
      port: 5180,
      fixtures: false,
      fixtureDelayMs: 0,
      reddit: { clientId: '', clientSecret: '', username: '' },
      ebay: { clientId: '', clientSecret: '' },
    });
  });

  it('reads and trims the Reddit settings', () => {
    const config = readConfig({
      REDDIT_CLIENT_ID: `  ${ID} `,
      REDDIT_CLIENT_SECRET: `\t${SECRET}\n`,
      REDDIT_USERNAME: ' seller ',
    });
    expect(config.reddit).toEqual({ clientId: ID, clientSecret: SECRET, username: 'seller' });
    expect(config.fixtures).toBe(false);
  });

  it('uses the run-1 PORT rules', () => {
    for (const value of [undefined, '', '5181', '0', '65536', 'abc', '80.5']) {
      expect(readConfig({ PORT: value }).port).toBe(parsePort(value));
    }
    expect(readConfig({ PORT: '5181' }).port).toBe(5181);
    expect(readConfig({ PORT: 'abc' }).port).toBeNull();
    expect(parsePortFromMain).toBe(parsePort);
  });

  it.each([
    ['1', true],
    [undefined, false],
    ['', false],
    ['0', false],
    ['true', false],
    [' 1', false],
    ['1 ', false],
    ['01', false],
  ])('SELLSCOUT_FIXTURES=%j gives fixtures %s', (value, expected) => {
    expect(readConfig({ SELLSCOUT_FIXTURES: value }).fixtures).toBe(expected);
  });

  it('blanks every Reddit field in fixture mode, even with keys set', () => {
    const config = readConfig({
      SELLSCOUT_FIXTURES: '1',
      REDDIT_CLIENT_ID: ID,
      REDDIT_CLIENT_SECRET: SECRET,
      REDDIT_USERNAME: 'seller',
    });
    expect(config.fixtures).toBe(true);
    expect(config.reddit).toEqual({ clientId: '', clientSecret: '', username: '' });
    expect(JSON.stringify(config)).not.toContain('SENTINEL');
  });

  it.each([
    [undefined, 0],
    ['', 0],
    ['0', 0],
    ['50', 50],
    ['1500', 1500],
    ['abc', 0],
    ['-1', 0],
    ['1.5', 0],
    ['1e3', 0],
    [' 50', 0],
    ['50ms', 0],
    ['9'.repeat(30), 0],
  ])('SELLSCOUT_FIXTURE_DELAY_MS=%j gives %i', (value, expected) => {
    expect(readConfig({ SELLSCOUT_FIXTURE_DELAY_MS: value }).fixtureDelayMs).toBe(expected);
  });
});

describe('hasRedditKeys (AC3)', () => {
  it('is true with both keys and fixtures off', () => {
    expect(hasRedditKeys(readConfig({ REDDIT_CLIENT_ID: ID, REDDIT_CLIENT_SECRET: SECRET }))).toBe(true);
  });

  it('does not need REDDIT_USERNAME', () => {
    const config = readConfig({ REDDIT_CLIENT_ID: ID, REDDIT_CLIENT_SECRET: SECRET, REDDIT_USERNAME: '' });
    expect(hasRedditKeys(config)).toBe(true);
  });

  it.each([
    ['only the id', { REDDIT_CLIENT_ID: ID }],
    ['only the secret', { REDDIT_CLIENT_SECRET: SECRET }],
    ['no keys', {}],
    ['blank keys', { REDDIT_CLIENT_ID: '  ', REDDIT_CLIENT_SECRET: ' ' }],
    ['fixture mode with both keys', { SELLSCOUT_FIXTURES: '1', REDDIT_CLIENT_ID: ID, REDDIT_CLIENT_SECRET: SECRET }],
  ])('is false with %s', (_label, env: Record<string, string>) => {
    expect(hasRedditKeys(readConfig(env))).toBe(false);
  });

  it('is false for an injected fixture config even if it carries keys', () => {
    const config = { ...readConfig({}), fixtures: true, reddit: { clientId: ID, clientSecret: SECRET, username: '' } };
    expect(hasRedditKeys(config)).toBe(false);
  });
});

const EBAY_ID = 'SENTINEL-EBAY-ID';
const EBAY_SECRET = 'SENTINEL-EBAY-SECRET';

describe('eBay keys in readConfig (run 3 AC2)', () => {
  it('reads and trims EBAY_CLIENT_ID and EBAY_CLIENT_SECRET', () => {
    const config = readConfig({ EBAY_CLIENT_ID: `  ${EBAY_ID} `, EBAY_CLIENT_SECRET: `\t${EBAY_SECRET}\n` });
    expect(config.ebay).toEqual({ clientId: EBAY_ID, clientSecret: EBAY_SECRET });
  });

  it("gives '' for unset eBay keys", () => {
    expect(readConfig({ REDDIT_CLIENT_ID: ID }).ebay).toEqual({ clientId: '', clientSecret: '' });
  });

  it('keeps the eBay and Reddit keys apart', () => {
    const config = readConfig({ EBAY_CLIENT_ID: EBAY_ID, REDDIT_CLIENT_ID: ID });
    expect(config.ebay).toEqual({ clientId: EBAY_ID, clientSecret: '' });
    expect(config.reddit.clientId).toBe(ID);
  });

  it('forces both eBay keys to empty in fixture mode', () => {
    const config = readConfig({ SELLSCOUT_FIXTURES: '1', EBAY_CLIENT_ID: EBAY_ID, EBAY_CLIENT_SECRET: EBAY_SECRET });
    expect(config.ebay).toEqual({ clientId: '', clientSecret: '' });
    expect(JSON.stringify(config)).not.toContain('SENTINEL');
  });
});

describe('hasEbayKeys (run 3 AC2)', () => {
  it('is true with both keys and fixtures off', () => {
    expect(hasEbayKeys(readConfig({ EBAY_CLIENT_ID: EBAY_ID, EBAY_CLIENT_SECRET: EBAY_SECRET }))).toBe(true);
  });

  it.each([
    ['only the id', { EBAY_CLIENT_ID: EBAY_ID }],
    ['only the secret', { EBAY_CLIENT_SECRET: EBAY_SECRET }],
    ['no keys', {}],
    ['blank keys', { EBAY_CLIENT_ID: '  ', EBAY_CLIENT_SECRET: ' ' }],
    ['only the Reddit keys', { REDDIT_CLIENT_ID: ID, REDDIT_CLIENT_SECRET: SECRET }],
    ['fixture mode with both keys', { SELLSCOUT_FIXTURES: '1', EBAY_CLIENT_ID: EBAY_ID, EBAY_CLIENT_SECRET: EBAY_SECRET }],
  ])('is false with %s', (_label, env: Record<string, string>) => {
    expect(hasEbayKeys(readConfig(env))).toBe(false);
  });

  it('is false for an injected fixture config even if it carries keys', () => {
    const config = { ...readConfig({}), fixtures: true, ebay: { clientId: EBAY_ID, clientSecret: EBAY_SECRET } };
    expect(hasEbayKeys(config)).toBe(false);
  });
});
