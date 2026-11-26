// AC3: the settings store, on a temp folder (never the real user file) or injected fs fakes.
import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  nodeSettingsFs,
  readSettingsFile,
  renameWithRetry,
  serializeSettings,
  SETTINGS_UNREADABLE_MESSAGE,
  writeSettingsFile,
} from '../../server/settings/store.ts';
import type { SettingsFs } from '../../server/settings/store.ts';

const SECRET = 'SENTINEL-SETTINGS-KEY';

let dir = '';
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'sellscout-store-'));
});
afterEach(async () => {
  vi.restoreAllMocks();
  await rm(dir, { recursive: true, force: true });
});

function logSpy(): { log: (message: string) => void; lines: string[] } {
  const lines: string[] = [];
  return { log: (message) => lines.push(message), lines };
}

describe('readSettingsFile (AC3)', () => {
  it('a missing file is no saved values, and nothing is logged', async () => {
    const { log, lines } = logSpy();
    expect(await readSettingsFile(join(dir, 'nope', 'settings.json'), { log })).toEqual({});
    expect(lines).toEqual([]);
  });

  it('reads the 7 keys, trimmed, and ignores unknown keys, non-strings and empty values', async () => {
    const file = join(dir, 'settings.json');
    await writeFile(
      file,
      JSON.stringify({
        version: 1,
        values: {
          ANTHROPIC_API_KEY: ` ${SECRET} `,
          SELLSCOUT_CLAUDE_MODEL: 'claude-sonnet-5-5',
          REDDIT_USERNAME: '',
          EBAY_CLIENT_ID: 42,
          EBAY_CLIENT_SECRET: null,
          PORT: '9999',
          SELLSCOUT_FIXTURES: '1',
          SELLSCOUT_SETTINGS_FILE: '/elsewhere',
          constructor: 'x',
        },
        extra: true,
      }),
    );
    const { log, lines } = logSpy();
    expect(await readSettingsFile(file, { log })).toEqual({ ANTHROPIC_API_KEY: SECRET, SELLSCOUT_CLAUDE_MODEL: 'claude-sonnet-5-5' });
    expect(lines).toEqual([]);
  });

  it('accepts a UTF-8 BOM', async () => {
    const file = join(dir, 'settings.json');
    await writeFile(file, Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(JSON.stringify({ version: 1, values: { REDDIT_USERNAME: 'u' } }))]));
    expect(await readSettingsFile(file, { log: () => {} })).toEqual({ REDDIT_USERNAME: 'u' });
  });

  it.each([
    ['bad JSON', `{"version": 1, "values": {"ANTHROPIC_API_KEY": "${SECRET}"`],
    ['an array', `[{"version": 1, "values": {"ANTHROPIC_API_KEY": "${SECRET}"}}]`],
    ['another version', `{"version": 2, "values": {"ANTHROPIC_API_KEY": "${SECRET}"}}`],
    ['no version', `{"values": {"ANTHROPIC_API_KEY": "${SECRET}"}}`],
    ['values not an object', `{"version": 1, "values": ["${SECRET}"]}`],
    ['values missing', `{"version": 1, "ANTHROPIC_API_KEY": "${SECRET}"}`],
    ['null', 'null'],
    ['empty', ''],
  ])('an unreadable file (%s) is no saved values and one log line without the content', async (_name, text) => {
    const file = join(dir, 'settings.json');
    await writeFile(file, text);
    const { log, lines } = logSpy();
    expect(await readSettingsFile(file, { log })).toEqual({});
    expect(lines).toEqual([SETTINGS_UNREADABLE_MESSAGE]);
    expect(SETTINGS_UNREADABLE_MESSAGE).toBe('sellscout: settings file unreadable; starting with no saved keys');
  });

  it('a read error (the path is a folder) is unreadable: one line', async () => {
    const { log, lines } = logSpy();
    expect(await readSettingsFile(dir, { log })).toEqual({});
    expect(lines).toEqual([SETTINGS_UNREADABLE_MESSAGE]);
  });

  it('an injected read error other than ENOENT logs the message only, never the error text', async () => {
    const { log, lines } = logSpy();
    const fs = { readFile: () => Promise.reject(Object.assign(new Error(`EACCES ${SECRET}`), { code: 'EACCES' })) };
    expect(await readSettingsFile('/x/settings.json', { fs, log })).toEqual({});
    expect(lines).toEqual([SETTINGS_UNREADABLE_MESSAGE]);
  });

  it('logs through console.error by default, once, without the content', async () => {
    const file = join(dir, 'settings.json');
    await writeFile(file, `not json ${SECRET}`);
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const logSpyConsole = vi.spyOn(console, 'log').mockImplementation(() => {});
    expect(await readSettingsFile(file)).toEqual({});
    expect(error.mock.calls).toEqual([[SETTINGS_UNREADABLE_MESSAGE]]);
    expect(logSpyConsole).not.toHaveBeenCalled();
  });
});

describe('writeSettingsFile (AC3)', () => {
  it('creates the folder and writes version 1 with the known keys only', async () => {
    const file = join(dir, 'a', 'b', 'settings.json');
    await writeSettingsFile(file, {
      ANTHROPIC_API_KEY: SECRET,
      REDDIT_USERNAME: 'me',
      ...({ PORT: '1' } as Record<string, string>),
    });
    expect(JSON.parse(await readFile(file, 'utf8'))).toEqual({ version: 1, values: { ANTHROPIC_API_KEY: SECRET, REDDIT_USERNAME: 'me' } });
    expect(await readSettingsFile(file)).toEqual({ ANTHROPIC_API_KEY: SECRET, REDDIT_USERNAME: 'me' });
    // No temp file is left behind.
    expect(await readdir(dirname(file))).toEqual(['settings.json']);
  });

  it('replaces an existing (even unreadable) file', async () => {
    const file = join(dir, 'settings.json');
    await writeFile(file, '{broken');
    await writeSettingsFile(file, { REDDIT_USERNAME: 'me' });
    expect(await readSettingsFile(file, { log: () => {} })).toEqual({ REDDIT_USERNAME: 'me' });
    await writeSettingsFile(file, {});
    expect(JSON.parse(await readFile(file, 'utf8'))).toEqual({ version: 1, values: {} });
    expect(await readdir(dir)).toEqual(['settings.json']);
  });

  it.skipIf(process.platform === 'win32')('the file mode is 0o600', async () => {
    const file = join(dir, 'settings.json');
    await writeSettingsFile(file, { REDDIT_USERNAME: 'me' });
    expect((await stat(file)).mode & 0o777).toBe(0o600);
  });

  it('is atomic: mkdir, then a new temp file in the same folder (0o600), then a rename over the file', async () => {
    const calls: unknown[][] = [];
    const fs: SettingsFs = {
      readFile: async () => '',
      mkdir: async (...args) => void calls.push(['mkdir', ...args]),
      writeFile: async (...args) => void calls.push(['writeFile', ...args]),
      rename: async (...args) => void calls.push(['rename', ...args]),
      rm: async (...args) => void calls.push(['rm', ...args]),
    };
    const file = join(dir, 'conf', 'settings.json');
    await writeSettingsFile(file, { REDDIT_USERNAME: 'me' }, fs);
    expect(calls.map((c) => c[0])).toEqual(['mkdir', 'writeFile', 'rename']);
    expect(calls[0]).toEqual(['mkdir', join(dir, 'conf'), { recursive: true }]);
    const [, temp, data, options] = calls[1] as [string, string, string, unknown];
    expect(dirname(temp)).toBe(join(dir, 'conf'));
    expect(temp).not.toBe(file);
    expect(temp.endsWith('.tmp')).toBe(true);
    expect(data).toBe(serializeSettings({ REDDIT_USERNAME: 'me' }));
    expect(options).toEqual({ encoding: 'utf8', mode: 0o600, flag: 'wx' });
    expect(calls[2]).toEqual(['rename', temp, file]);
  });

  it('a failed rename removes the temp file, rethrows, and leaves the old file as it was', async () => {
    const file = join(dir, 'settings.json');
    await writeSettingsFile(file, { REDDIT_USERNAME: 'old' });
    const failing: SettingsFs = {
      ...nodeSettingsFs,
      rename: () => Promise.reject(Object.assign(new Error('nope'), { code: 'EPERM' })),
    };
    await expect(writeSettingsFile(file, { REDDIT_USERNAME: 'new' }, failing)).rejects.toMatchObject({ code: 'EPERM' });
    expect(await readSettingsFile(file)).toEqual({ REDDIT_USERNAME: 'old' });
    expect(await readdir(dir)).toEqual(['settings.json']);
  });

  it('fails when the folder cannot be created (a file is in the way)', async () => {
    const blocker = join(dir, 'blocker');
    await writeFile(blocker, 'x');
    await expect(writeSettingsFile(join(blocker, 'settings.json'), { REDDIT_USERNAME: 'me' })).rejects.toHaveProperty('code');
    await mkdir(join(dir, 'ok'));
    await writeSettingsFile(join(dir, 'ok', 'settings.json'), { REDDIT_USERNAME: 'me' });
  });
});

describe('renameWithRetry (Windows transient locks)', () => {
  const busy = (code: string) => Object.assign(new Error(code), { code });

  it('retries EPERM / EBUSY / EACCES on win32 with 50, 150, 400 ms waits, then succeeds', async () => {
    const codes = ['EPERM', 'EBUSY', 'EACCES'];
    const waits: number[] = [];
    let calls = 0;
    const fs = { rename: async () => { calls++; const code = codes.shift(); if (code) throw busy(code); } };
    await renameWithRetry(fs, 'a', 'b', 'win32', async (ms) => { waits.push(ms); });
    expect(calls).toBe(4);
    expect(waits).toEqual([50, 150, 400]);
  });

  it('gives up after the last wait and rethrows', async () => {
    const fs = { rename: async () => { throw busy('EBUSY'); } };
    await expect(renameWithRetry(fs, 'a', 'b', 'win32', async () => {})).rejects.toMatchObject({ code: 'EBUSY' });
  });

  it('never retries on other platforms or other codes', async () => {
    let calls = 0;
    const fs = { rename: async () => { calls++; throw busy('EPERM'); } };
    await expect(renameWithRetry(fs, 'a', 'b', 'linux', async () => {})).rejects.toMatchObject({ code: 'EPERM' });
    const fs2 = { rename: async () => { calls++; throw busy('ENOSPC'); } };
    await expect(renameWithRetry(fs2, 'a', 'b', 'win32', async () => {})).rejects.toMatchObject({ code: 'ENOSPC' });
    expect(calls).toBe(2);
  });
});
