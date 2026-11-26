// Which value wins (spec "Settings file"), pure: the environment, the saved values, the config.
import { describe, expect, it } from 'vitest';
import { readConfig } from '../../server/config.ts';
import { SETTING_KEYS } from '../../server/settings/keys.ts';
import { applySettingsUpdate, mergedEnv, readOnlySettingsResponse, settingsResponse } from '../../server/settings/merge.ts';

const SECRET = 'SENTINEL-SETTINGS-KEY';

describe('mergedEnv', () => {
  it('adds a saved value only where the environment has none (blank counts as none)', () => {
    const env = { ANTHROPIC_API_KEY: 'env-key', EBAY_CLIENT_ID: '   ', PATH: '/bin' };
    const merged = mergedEnv(env, { ANTHROPIC_API_KEY: 'file-key', EBAY_CLIENT_ID: 'file-id', REDDIT_USERNAME: 'me' });
    expect(merged).toMatchObject({ ANTHROPIC_API_KEY: 'env-key', EBAY_CLIENT_ID: 'file-id', REDDIT_USERNAME: 'me', PATH: '/bin' });
    expect(env.EBAY_CLIENT_ID).toBe('   ');
  });

  it('only the 7 keys come from the file; fixture mode and PORT stay as the environment says', () => {
    const values = { PORT: '1234', SELLSCOUT_FIXTURES: '1', SELLSCOUT_SETTINGS_FILE: '/x' } as Record<string, string>;
    const merged = mergedEnv({ PORT: '5190' }, values);
    expect(merged.PORT).toBe('5190');
    expect(merged.SELLSCOUT_FIXTURES).toBe('');
    expect(merged.SELLSCOUT_SETTINGS_FILE).toBeUndefined();
    expect(mergedEnv({ SELLSCOUT_FIXTURES: 'true' }, {}).SELLSCOUT_FIXTURES).toBe('');
    expect(mergedEnv({ SELLSCOUT_FIXTURES: '1' }, {}).SELLSCOUT_FIXTURES).toBe('1');
  });

  it('readConfig over it: saved keys turn features on, and fixture mode still forces every key off', () => {
    const values = { ANTHROPIC_API_KEY: SECRET, EBAY_CLIENT_ID: 'id', EBAY_CLIENT_SECRET: 'secret', SELLSCOUT_CLAUDE_MODEL: 'claude-sonnet-5-5' };
    const live = readConfig(mergedEnv({}, values));
    expect(live.claude).toEqual({ apiKey: SECRET, model: 'claude-sonnet-5-5' });
    expect(live.ebay).toEqual({ clientId: 'id', clientSecret: 'secret' });
    const fixture = readConfig(mergedEnv({ SELLSCOUT_FIXTURES: '1' }, values));
    expect(fixture.fixtures).toBe(true);
    expect(fixture.claude.apiKey).toBe('');
    expect(fixture.ebay).toEqual({ clientId: '', clientSecret: '' });
  });
});

describe('settingsResponse', () => {
  it('lists the 7 keys with their source; values only for the set non-secret keys', () => {
    const res = settingsResponse(
      { ANTHROPIC_API_KEY: ` ${SECRET} `, REDDIT_USERNAME: ' env_user ', EBAY_CLIENT_SECRET: '  ' },
      { ANTHROPIC_API_KEY: `${SECRET}-FILE`, SELLSCOUT_CLAUDE_MODEL: 'claude-sonnet-5-5', EBAY_CLIENT_SECRET: `${SECRET}-EB`, REDDIT_USERNAME: 'file_user' },
      '/tmp/settings.json',
    );
    expect(res.editable).toBe(true);
    expect(res.file).toBe('/tmp/settings.json');
    expect(Object.keys(res.settings)).toEqual([...SETTING_KEYS]);
    expect(res.settings).toEqual({
      ANTHROPIC_API_KEY: { source: 'environment', secret: true },
      SELLSCOUT_CLAUDE_MODEL: { source: 'settings', secret: false, value: 'claude-sonnet-5-5' },
      EBAY_CLIENT_ID: { source: 'none', secret: true },
      EBAY_CLIENT_SECRET: { source: 'settings', secret: true },
      REDDIT_CLIENT_ID: { source: 'none', secret: true },
      REDDIT_CLIENT_SECRET: { source: 'none', secret: true },
      REDDIT_USERNAME: { source: 'environment', secret: false, value: 'env_user' },
    });
    expect(JSON.stringify(res)).not.toContain(SECRET);
  });

  it('is read-only with no file', () => {
    expect(settingsResponse({}, {}, null)).toMatchObject({ editable: false, file: null });
  });
});

describe('readOnlySettingsResponse (a start without `settings`)', () => {
  it('environment where the injected config has the value, else none; secrets never carry a value', () => {
    const config = readConfig({ ANTHROPIC_API_KEY: SECRET, REDDIT_CLIENT_ID: 'rid', REDDIT_USERNAME: 'me', SELLSCOUT_CLAUDE_MODEL: 'claude-sonnet-5-5' });
    const res = readOnlySettingsResponse(config);
    expect(res).toEqual({
      editable: false,
      file: null,
      settings: {
        ANTHROPIC_API_KEY: { source: 'environment', secret: true },
        SELLSCOUT_CLAUDE_MODEL: { source: 'environment', secret: false, value: 'claude-sonnet-5-5' },
        EBAY_CLIENT_ID: { source: 'none', secret: true },
        EBAY_CLIENT_SECRET: { source: 'none', secret: true },
        REDDIT_CLIENT_ID: { source: 'environment', secret: true },
        REDDIT_CLIENT_SECRET: { source: 'none', secret: true },
        REDDIT_USERNAME: { source: 'environment', secret: false, value: 'me' },
      },
    });
    expect(JSON.stringify(res)).not.toContain(SECRET);
  });

  it('the default model counts as not set', () => {
    expect(readOnlySettingsResponse(readConfig({})).settings.SELLSCOUT_CLAUDE_MODEL).toEqual({ source: 'none', secret: false });
  });
});

describe('applySettingsUpdate', () => {
  it('a string saves (trimmed), null or "" removes, a key left out keeps its value', () => {
    const before = { ANTHROPIC_API_KEY: 'a', REDDIT_USERNAME: 'me', EBAY_CLIENT_ID: 'id' };
    const after = applySettingsUpdate(before, { ANTHROPIC_API_KEY: ' b ', REDDIT_USERNAME: null, EBAY_CLIENT_ID: '', REDDIT_CLIENT_ID: 'rid' });
    expect(after).toEqual({ ANTHROPIC_API_KEY: 'b', REDDIT_CLIENT_ID: 'rid' });
    expect(before).toEqual({ ANTHROPIC_API_KEY: 'a', REDDIT_USERNAME: 'me', EBAY_CLIENT_ID: 'id' });
    expect(applySettingsUpdate(before, {})).toEqual(before);
  });
});
