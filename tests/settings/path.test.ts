// AC2: where the settings file lives. Every case passes the platform and home explicitly, so no
// test resolves the real user path.
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { defaultSettingsDir, resolveSettingsFile, SETTINGS_FILE_NAME } from '../../server/settings/path.ts';

const HOME = join('/', 'home', 'tester');

describe('resolveSettingsFile (AC2)', () => {
  it('names the file settings.json', () => {
    expect(SETTINGS_FILE_NAME).toBe('settings.json');
  });

  it('uses SELLSCOUT_SETTINGS_FILE when it is non-empty, trimmed', () => {
    const file = join('/', 'tmp', 'sellscout-test', 'settings.json');
    expect(resolveSettingsFile({ SELLSCOUT_SETTINGS_FILE: file }, 'linux', HOME)).toBe(file);
    expect(resolveSettingsFile({ SELLSCOUT_SETTINGS_FILE: `  ${file}  ` }, 'win32', HOME)).toBe(file);
  });

  it('the explicit path wins even in fixture mode or under NODE_ENV=test', () => {
    const file = join('/', 'tmp', 'x.json');
    expect(resolveSettingsFile({ SELLSCOUT_SETTINGS_FILE: file, SELLSCOUT_FIXTURES: '1' }, 'linux', HOME)).toBe(file);
    expect(resolveSettingsFile({ SELLSCOUT_SETTINGS_FILE: file, NODE_ENV: 'test' }, 'linux', HOME)).toBe(file);
  });

  it.each([
    ['fixture mode', { SELLSCOUT_FIXTURES: '1' }],
    ['NODE_ENV=test', { NODE_ENV: 'test' }],
    ['both', { SELLSCOUT_FIXTURES: '1', NODE_ENV: 'test' }],
    ['an empty explicit path in fixture mode', { SELLSCOUT_SETTINGS_FILE: '', SELLSCOUT_FIXTURES: '1' }],
    ['a blank explicit path under NODE_ENV=test', { SELLSCOUT_SETTINGS_FILE: '   ', NODE_ENV: 'test' }],
  ])('is null (read-only) with %s', (_name, env) => {
    for (const platform of ['win32', 'darwin', 'linux'] as const) {
      expect(resolveSettingsFile({ APPDATA: join('/', 'appdata'), ...env }, platform, HOME)).toBeNull();
    }
  });

  it('only SELLSCOUT_FIXTURES=1 exactly is fixture mode', () => {
    expect(resolveSettingsFile({ SELLSCOUT_FIXTURES: '0' }, 'linux', HOME)).toBe(join(HOME, '.config', 'sellscout', 'settings.json'));
    expect(resolveSettingsFile({ SELLSCOUT_FIXTURES: 'true', NODE_ENV: 'production' }, 'linux', HOME)).toBe(
      join(HOME, '.config', 'sellscout', 'settings.json'),
    );
  });

  it('win32: %APPDATA%\\sellscout\\settings.json, or <home>/AppData/Roaming without APPDATA', () => {
    const appData = join('/', 'Users', 'tester', 'AppData', 'Roaming');
    expect(resolveSettingsFile({ APPDATA: appData }, 'win32', HOME)).toBe(join(appData, 'sellscout', 'settings.json'));
    expect(resolveSettingsFile({}, 'win32', HOME)).toBe(join(HOME, 'AppData', 'Roaming', 'sellscout', 'settings.json'));
    expect(resolveSettingsFile({ APPDATA: '' }, 'win32', HOME)).toBe(join(HOME, 'AppData', 'Roaming', 'sellscout', 'settings.json'));
  });

  it('darwin: ~/Library/Application Support/sellscout/settings.json, whatever APPDATA or XDG say', () => {
    const expected = join(HOME, 'Library', 'Application Support', 'sellscout', 'settings.json');
    expect(resolveSettingsFile({}, 'darwin', HOME)).toBe(expected);
    expect(resolveSettingsFile({ APPDATA: join('/', 'a'), XDG_CONFIG_HOME: join('/', 'x') }, 'darwin', HOME)).toBe(expected);
  });

  it('linux and others: $XDG_CONFIG_HOME/sellscout/settings.json, or ~/.config without it', () => {
    const xdg = join('/', 'xdg', 'config');
    expect(resolveSettingsFile({ XDG_CONFIG_HOME: xdg }, 'linux', HOME)).toBe(join(xdg, 'sellscout', 'settings.json'));
    expect(resolveSettingsFile({}, 'linux', HOME)).toBe(join(HOME, '.config', 'sellscout', 'settings.json'));
    expect(resolveSettingsFile({ XDG_CONFIG_HOME: '' }, 'linux', HOME)).toBe(join(HOME, '.config', 'sellscout', 'settings.json'));
    expect(resolveSettingsFile({ APPDATA: join('/', 'a') }, 'freebsd', HOME)).toBe(join(HOME, '.config', 'sellscout', 'settings.json'));
  });
});

describe('defaultSettingsDir', () => {
  it('is the folder the file sits in, per platform', () => {
    expect(defaultSettingsDir({ APPDATA: join('/', 'ad') }, 'win32', HOME)).toBe(join('/', 'ad', 'sellscout'));
    expect(defaultSettingsDir({}, 'darwin', HOME)).toBe(join(HOME, 'Library', 'Application Support', 'sellscout'));
    expect(defaultSettingsDir({}, 'linux', HOME)).toBe(join(HOME, '.config', 'sellscout'));
  });

  it('under vitest, NODE_ENV is test, so the default call is read-only', () => {
    expect(process.env.NODE_ENV).toBe('test');
    expect(resolveSettingsFile({ NODE_ENV: process.env.NODE_ENV })).toBeNull();
  });
});
