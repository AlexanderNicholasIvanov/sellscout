// AC4-AC7: GET / PUT /api/settings and the reload without restart, through startServer on port 0
// with a temp settings file and an injected fetch. Nothing leaves the machine, and no test reads
// or writes the real user settings file.
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readConfig } from '../../server/config.ts';
import { isAllowedOrigin } from '../../server/http/origin.ts';
import { SETTING_KEYS } from '../../server/settings/keys.ts';
import { SETTINGS_UNREADABLE_MESSAGE } from '../../server/settings/store.ts';
import { startServer } from '../../server/start.ts';
import type { StartOptions } from '../../server/start.ts';
import type { SearchFn, SearchResult, SettingsResponse } from '../../server/types.ts';
import { answerBody, jsonResponse, recordingFetch } from '../claude/helpers.ts';
import type { RecordedCall } from '../claude/helpers.ts';
import { closeServer, fakeResult, json, postFixtures, postSearch, putSettings, rawRequest } from './helpers.ts';
import type { RawResponse } from './helpers.ts';

const KEY = 'SENTINEL-SETTINGS-KEY';
const KEY_B = 'SENTINEL-SETTINGS-KEY-B';
const ENV_KEY = 'SENTINEL-SETTINGS-KEY-ENV';
const GOOD = { categoryIds: ['keyboards'], searchTerm: 'mechanical keyboard', subreddits: [] };

let dir = '';
let file = '';
const servers: Server[] = [];
const consoleCalls: unknown[][] = [];

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'sellscout-settings-'));
  file = join(dir, 'profile', 'settings.json');
  consoleCalls.length = 0;
  // AC7: every console call is recorded (and kept quiet) so the afterEach can look for a key.
  for (const method of ['log', 'error', 'warn', 'info', 'debug'] as const) {
    vi.spyOn(console, method).mockImplementation((...args: unknown[]) => {
      consoleCalls.push(args);
    });
  }
});

afterEach(async () => {
  for (const server of servers.splice(0)) await closeServer(server);
  // AC7: no key value in any console.* call during these tests.
  const logged = consoleCalls.map((args) => args.map((a) => (a instanceof Error ? `${a.message} ${a.stack ?? ''}` : String(a))).join(' ')).join('\n');
  expect(logged).not.toContain('SENTINEL');
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  await rm(dir, { recursive: true, force: true });
});

async function start(options: Partial<StartOptions> = {}): Promise<number> {
  const server = await startServer({ port: 0, version: '1.2.3', ...options });
  servers.push(server);
  return (server.address() as AddressInfo).port;
}

const startWith = (env: Record<string, string | undefined> = {}, extra: Partial<StartOptions> = {}): Promise<number> =>
  start({ settings: { file, env }, ...extra });

const getSettings = async (port: number): Promise<RawResponse> => rawRequest(port, { path: '/api/settings' });
const settingsOf = (res: RawResponse): SettingsResponse => json(res) as SettingsResponse;
const status = async (port: number): Promise<unknown> => json(await rawRequest(port, { path: '/api/status' }));
const saveFile = async (values: Record<string, unknown>): Promise<void> => {
  await rm(join(dir, 'profile'), { recursive: true, force: true });
  await mkdir(join(dir, 'profile'), { recursive: true });
  await writeFile(file, JSON.stringify({ version: 1, values }));
};
const fileValues = async (): Promise<unknown> => (JSON.parse(await readFile(file, 'utf8')) as { values: unknown }).values;
const fileExists = async (): Promise<boolean> =>
  readFile(file).then(
    () => true,
    () => false,
  );

describe('GET /api/settings (AC4)', () => {
  it('reports each source, the environment winning, values only for the non-secret keys', async () => {
    await saveFile({
      ANTHROPIC_API_KEY: KEY,
      SELLSCOUT_CLAUDE_MODEL: 'claude-sonnet-5-5',
      EBAY_CLIENT_ID: `${KEY}-EBAY-ID`,
      REDDIT_USERNAME: 'file_user',
      REDDIT_CLIENT_SECRET: `${KEY}-REDDIT`,
      PORT: '1',
    });
    const port = await startWith({ ANTHROPIC_API_KEY: ENV_KEY, REDDIT_USERNAME: 'env_user', REDDIT_CLIENT_SECRET: '   ' });
    const res = await getSettings(port);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('application/json; charset=utf-8');
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.body).not.toContain('SENTINEL');
    const body = settingsOf(res);
    expect(body).toEqual({
      editable: true,
      file,
      settings: {
        ANTHROPIC_API_KEY: { source: 'environment', secret: true },
        SELLSCOUT_CLAUDE_MODEL: { source: 'settings', secret: false, value: 'claude-sonnet-5-5' },
        EBAY_CLIENT_ID: { source: 'settings', secret: true },
        EBAY_CLIENT_SECRET: { source: 'none', secret: true },
        REDDIT_CLIENT_ID: { source: 'none', secret: true },
        REDDIT_CLIENT_SECRET: { source: 'settings', secret: true },
        REDDIT_USERNAME: { source: 'environment', secret: false, value: 'env_user' },
      },
    });
    expect(Object.keys(body.settings)).toEqual([...SETTING_KEYS]);
  });

  it('the saved values feed the config at start: the Claude chip is on from the file alone', async () => {
    await saveFile({ ANTHROPIC_API_KEY: KEY });
    const port = await startWith({});
    expect(await status(port)).toEqual({ version: '1.2.3', redditAuth: false, fixtures: false, ebay: false, claude: true });
  });

  it('a missing file is no saved values, and `config` is ignored when `settings` is given', async () => {
    const port = await startWith({}, { config: readConfig({ ANTHROPIC_API_KEY: KEY }) });
    const body = settingsOf(await getSettings(port));
    expect(body.editable).toBe(true);
    expect(Object.values(body.settings).every((s) => s.source === 'none')).toBe(true);
    expect(await status(port)).toMatchObject({ claude: false });
    expect(await fileExists()).toBe(false);
  });

  it('an unreadable file: no saved values, one log line without the content, and the next save replaces it', async () => {
    await saveFile({});
    await writeFile(file, `{"version": 1, "values": {"ANTHROPIC_API_KEY": "${KEY}"`);
    const port = await startWith({});
    expect(consoleCalls).toEqual([[SETTINGS_UNREADABLE_MESSAGE]]);
    expect(settingsOf(await getSettings(port)).settings.ANTHROPIC_API_KEY.source).toBe('none');
    const res = await putSettings(port, { values: { REDDIT_USERNAME: 'me' } });
    expect(res.status).toBe(200);
    expect(await fileValues()).toEqual({ REDDIT_USERNAME: 'me' });
    consoleCalls.length = 0;
  });

  it('started without `settings`: read-only, sources from the injected config', async () => {
    const port = await start({ config: readConfig({ ANTHROPIC_API_KEY: KEY, REDDIT_USERNAME: 'me' }) });
    const res = await getSettings(port);
    expect(res.status).toBe(200);
    expect(res.body).not.toContain('SENTINEL');
    const body = settingsOf(res);
    expect(body.editable).toBe(false);
    expect(body.file).toBeNull();
    expect(body.settings.ANTHROPIC_API_KEY).toEqual({ source: 'environment', secret: true });
    expect(body.settings.REDDIT_USERNAME).toEqual({ source: 'environment', secret: false, value: 'me' });
    expect(body.settings.EBAY_CLIENT_ID).toEqual({ source: 'none', secret: true });
    expect(body.settings.SELLSCOUT_CLAUDE_MODEL).toEqual({ source: 'none', secret: false });
  });

  it('started without `settings` or `config`: everything none', async () => {
    const port = await start({ search: fakeResult });
    const body = settingsOf(await getSettings(port));
    expect(body.editable).toBe(false);
    expect(Object.values(body.settings).map((s) => s.source)).toEqual(SETTING_KEYS.map(() => 'none'));
  });

  it('a null file is read-only', async () => {
    const port = await start({ settings: { file: null, env: { REDDIT_USERNAME: 'me' } } });
    const body = settingsOf(await getSettings(port));
    expect(body).toMatchObject({ editable: false, file: null });
    expect(body.settings.REDDIT_USERNAME).toEqual({ source: 'environment', secret: false, value: 'me' });
  });

  it('a relative file is reported as an absolute path', async () => {
    const relative = join('.', 'never-written-sellscout-settings.json');
    const port = await start({ settings: { file: relative, env: {} } });
    const body = settingsOf(await getSettings(port));
    expect(body.file).toBe(join(process.cwd(), 'never-written-sellscout-settings.json'));
  });

  it('checks the Host header like every route', async () => {
    const port = await startWith({});
    const res = await rawRequest(port, { path: '/api/settings', headers: { Host: 'evil.example' } });
    expect(res.status).toBe(403);
    expect(json(res)).toEqual({ error: 'Forbidden host' });
  });
});

describe('PUT /api/settings (AC5)', () => {
  it.each([
    ['an array body', [], 'Body must be {"values": {...}}'],
    ['a JSON string body', '"x"', 'Body must be {"values": {...}}'],
    ['a number body', 7, 'Body must be {"values": {...}}'],
    ['a null body', null, 'Body must be {"values": {...}}'],
    ['no values', { ANTHROPIC_API_KEY: KEY }, 'Body must be {"values": {...}}'],
    ['values null', { values: null }, 'Body must be {"values": {...}}'],
    ['values an array', { values: [KEY] }, 'Body must be {"values": {...}}'],
    ['values a string', { values: KEY }, 'Body must be {"values": {...}}'],
    ['an unknown key', { values: { PORT: '1' } }, 'Unknown setting: PORT'],
    ['a long unknown key', { values: { ['X'.repeat(60)]: 'v' } }, `Unknown setting: ${'X'.repeat(40)}`],
    ['fixture mode', { values: { SELLSCOUT_FIXTURES: '1' } }, 'Unknown setting: SELLSCOUT_FIXTURES'],
    ['a lower-case key', { values: { anthropic_api_key: 'v' } }, 'Unknown setting: anthropic_api_key'],
    ['a number', { values: { REDDIT_USERNAME: 42 } }, 'REDDIT_USERNAME must be a string or null'],
    ['a boolean', { values: { ANTHROPIC_API_KEY: true } }, 'ANTHROPIC_API_KEY must be a string or null'],
    ['an object', { values: { EBAY_CLIENT_ID: { v: KEY } } }, 'EBAY_CLIENT_ID must be a string or null'],
    ['501 characters', { values: { ANTHROPIC_API_KEY: 'k'.repeat(501) } }, 'ANTHROPIC_API_KEY is too long (max 500 characters)'],
    ['a newline', { values: { ANTHROPIC_API_KEY: `${KEY}\nmore` } }, 'ANTHROPIC_API_KEY must be a single line'],
    ['a trailing newline', { values: { ANTHROPIC_API_KEY: `${KEY}\n` } }, 'ANTHROPIC_API_KEY must be a single line'],
    ['a tab', { values: { REDDIT_USERNAME: 'a\tb' } }, 'REDDIT_USERNAME must be a single line'],
    ['a NUL', { values: { REDDIT_CLIENT_ID: 'a\u0000b' } }, 'REDDIT_CLIENT_ID must be a single line'],
    ['a U+001F', { values: { REDDIT_CLIENT_SECRET: 'a\u001fb' } }, 'REDDIT_CLIENT_SECRET must be a single line'],
    ['a DEL', { values: { EBAY_CLIENT_SECRET: 'a\u007fb' } }, 'EBAY_CLIENT_SECRET must be a single line'],
    ['a good key then a bad one', { values: { REDDIT_USERNAME: 'ok', SELLSCOUT_CLAUDE_MODEL: 7 } }, 'SELLSCOUT_CLAUDE_MODEL must be a string or null'],
  ])('400 for %s, with the exact message, and nothing is written', async (_name, body, message) => {
    await saveFile({ REDDIT_USERNAME: 'before' });
    const port = await startWith({});
    const res = await putSettings(port, body);
    expect(res.status).toBe(400);
    expect(json(res)).toEqual({ error: message });
    expect(res.body).not.toContain('SENTINEL');
    expect(await fileValues()).toEqual({ REDDIT_USERNAME: 'before' });
  });

  it('400 for a body that is not JSON', async () => {
    const port = await startWith({});
    const res = await putSettings(port, '{"values": ');
    expect(res.status).toBe(400);
    expect(json(res)).toEqual({ error: 'Body must be JSON' });
    expect(await fileExists()).toBe(false);
  });

  it('500 characters after trimming are fine', async () => {
    const port = await startWith({});
    const res = await putSettings(port, { values: { SELLSCOUT_CLAUDE_MODEL: `  ${'m'.repeat(500)}  ` } });
    expect(res.status).toBe(200);
    expect(await fileValues()).toEqual({ SELLSCOUT_CLAUDE_MODEL: 'm'.repeat(500) });
  });

  it('400 for a wrong Content-Type, and nothing is written', async () => {
    const port = await startWith({});
    const text = JSON.stringify({ values: { REDDIT_USERNAME: 'me' } });
    for (const type of ['text/plain', 'application/x-www-form-urlencoded', 'application/json; charset=latin1']) {
      const res = await putSettings(port, text, { 'Content-Type': type });
      expect(res.status).toBe(400);
      expect(json(res)).toEqual({ error: 'Content-Type must be application/json' });
    }
    expect(await fileExists()).toBe(false);
  });

  it('413 over 10 KB, and nothing is written', async () => {
    const port = await startWith({});
    const res = await putSettings(port, { values: { REDDIT_USERNAME: 'x'.repeat(11 * 1024) } });
    expect(res.status).toBe(413);
    expect(json(res)).toEqual({ error: 'Request too large' });
    expect(await fileExists()).toBe(false);
  });

  it('409 when read-only (file null), and when started without `settings`', async () => {
    for (const port of [await start({ settings: { file: null, env: {} } }), await start({ config: readConfig({}) })]) {
      const res = await putSettings(port, { values: { REDDIT_USERNAME: 'me' } });
      expect(res.status).toBe(409);
      expect(json(res)).toEqual({ error: 'Settings are read-only here; set keys in .env or the environment' });
    }
  });

  it('403 for a foreign Origin, checked before the body is read, and nothing is written', async () => {
    const port = await startWith({});
    for (const origin of ['https://evil.example', `http://127.0.0.1:${port + 1}`, `https://127.0.0.1:${port}`, 'null', 'sellscout://evil', `http://localhost:${port}/`]) {
      const res = await putSettings(port, { values: { ANTHROPIC_API_KEY: KEY } }, { Origin: origin });
      expect(res.status).toBe(403);
      expect(json(res)).toEqual({ error: 'Forbidden origin' });
    }
    // Before the body: a wrong content type and an oversize body still get the 403.
    const wrongType = await putSettings(port, 'x', { Origin: 'https://evil.example', 'Content-Type': 'text/plain' });
    expect(wrongType.status).toBe(403);
    const big = await putSettings(port, { values: { REDDIT_USERNAME: 'x'.repeat(11 * 1024) } }, { Origin: 'https://evil.example' });
    expect(big.status).toBe(403);
    expect(await fileExists()).toBe(false);
    expect(settingsOf(await getSettings(port)).settings.ANTHROPIC_API_KEY.source).toBe('none');
  });

  it('accepts the 3 allowed origins, and no Origin at all', async () => {
    const port = await startWith({});
    const origins = [`http://127.0.0.1:${port}`, `http://localhost:${port}`, 'sellscout://app', undefined];
    for (const [i, origin] of origins.entries()) {
      const res = await putSettings(port, { values: { REDDIT_USERNAME: `user${i}` } }, origin ? { Origin: origin } : {});
      expect(res.status).toBe(200);
      expect(await fileValues()).toEqual({ REDDIT_USERNAME: `user${i}` });
    }
  });

  it('405 with Allow: GET, PUT for other methods', async () => {
    const port = await startWith({});
    for (const method of ['POST', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS']) {
      const res = await rawRequest(port, { method, path: '/api/settings' });
      expect(res.status).toBe(405);
      expect(res.headers.allow).toBe('GET, PUT');
    }
    expect(await fileExists()).toBe(false);
  });

  it('200 with the new state: strings trimmed, "" and null remove, a key left out keeps its value', async () => {
    await saveFile({ ANTHROPIC_API_KEY: KEY, REDDIT_USERNAME: 'old', EBAY_CLIENT_ID: `${KEY}-ID`, EBAY_CLIENT_SECRET: `${KEY}-SECRET` });
    const port = await startWith({});
    const res = await putSettings(port, { values: { SELLSCOUT_CLAUDE_MODEL: ' claude-sonnet-5-5 ', REDDIT_USERNAME: '', EBAY_CLIENT_ID: null } });
    expect(res.status).toBe(200);
    expect(res.body).not.toContain('SENTINEL');
    const body = settingsOf(res);
    expect(body.editable).toBe(true);
    expect(body.file).toBe(file);
    expect(body.settings.ANTHROPIC_API_KEY).toEqual({ source: 'settings', secret: true });
    expect(body.settings.SELLSCOUT_CLAUDE_MODEL).toEqual({ source: 'settings', secret: false, value: 'claude-sonnet-5-5' });
    expect(body.settings.REDDIT_USERNAME).toEqual({ source: 'none', secret: false });
    expect(body.settings.EBAY_CLIENT_ID).toEqual({ source: 'none', secret: true });
    expect(body.settings.EBAY_CLIENT_SECRET).toEqual({ source: 'settings', secret: true });
    expect(await fileValues()).toEqual({ ANTHROPIC_API_KEY: KEY, SELLSCOUT_CLAUDE_MODEL: 'claude-sonnet-5-5', EBAY_CLIENT_SECRET: `${KEY}-SECRET` });
    expect(settingsOf(await getSettings(port))).toEqual(body);
  });

  it('a key set in the environment: the saved value is written, and the environment keeps winning', async () => {
    const port = await startWith({ ANTHROPIC_API_KEY: ENV_KEY });
    const res = await putSettings(port, { values: { ANTHROPIC_API_KEY: KEY } });
    expect(res.status).toBe(200);
    expect(settingsOf(res).settings.ANTHROPIC_API_KEY).toEqual({ source: 'environment', secret: true });
    expect(await fileValues()).toEqual({ ANTHROPIC_API_KEY: KEY });
    expect(res.body).not.toContain('SENTINEL');
  });

  it('500 on a write failure: the old values stay in effect, and only the error code is logged', async () => {
    await saveFile({ ANTHROPIC_API_KEY: KEY });
    const port = await startWith({});
    expect(await status(port)).toMatchObject({ claude: true });
    // A file where the folder should be: the next save cannot create it.
    await rm(join(dir, 'profile'), { recursive: true, force: true });
    await writeFile(join(dir, 'profile'), 'not a folder');
    const res = await putSettings(port, { values: { ANTHROPIC_API_KEY: null, REDDIT_USERNAME: 'new' } });
    expect(res.status).toBe(500);
    expect(json(res)).toEqual({ error: "Couldn't save settings" });
    expect(await status(port)).toMatchObject({ claude: true });
    const body = settingsOf(await getSettings(port));
    expect(body.settings.ANTHROPIC_API_KEY.source).toBe('settings');
    expect(body.settings.REDDIT_USERNAME.source).toBe('none');
    expect(consoleCalls).toHaveLength(1);
    expect(consoleCalls[0]).toHaveLength(1);
    expect(String(consoleCalls[0]?.[0])).toMatch(/^sellscout: couldn't save settings \([A-Z]+\)$/);
    consoleCalls.length = 0;
  });

  it('two saves at once both land', async () => {
    const port = await startWith({});
    const [a, b] = await Promise.all([
      putSettings(port, { values: { REDDIT_USERNAME: 'me' } }),
      putSettings(port, { values: { SELLSCOUT_CLAUDE_MODEL: 'claude-sonnet-5-5' } }),
    ]);
    expect([a.status, b.status]).toEqual([200, 200]);
    expect(await fileValues()).toEqual({ SELLSCOUT_CLAUDE_MODEL: 'claude-sonnet-5-5', REDDIT_USERNAME: 'me' });
  });
});

describe('reload without restart (AC6)', () => {
  /** A Messages API stand-in: answers GOOD; anything else is refused. Every call is recorded. */
  function anthropicFetch(): { fetch: typeof globalThis.fetch; calls: RecordedCall[] } {
    vi.stubEnv('ANTHROPIC_BASE_URL', '');
    return recordingFetch((call) =>
      call.url.startsWith('https://api.anthropic.com/') ? jsonResponse(answerBody(GOOD)) : Promise.reject(new TypeError('fetch failed')),
    );
  }

  const search = async (port: number): Promise<SearchResult> => {
    const res = await postSearch(port, { item: 'mechanical keyboard', window: 30 });
    expect(res.status).toBe(200);
    expect(res.body).not.toContain('SENTINEL');
    return json(res) as SearchResult;
  };

  it('saving ANTHROPIC_API_KEY turns Claude on, a new key builds a new client, removing it turns Claude off', async () => {
    const recorded = anthropicFetch();
    const port = await startWith({}, { fetch: recorded.fetch });
    expect(await status(port)).toEqual({ version: '1.2.3', redditAuth: false, fixtures: false, ebay: false, claude: false });
    expect((await search(port)).plan.source).toBe('catalog');
    expect(recorded.calls).toEqual([]);

    expect((await putSettings(port, { values: { ANTHROPIC_API_KEY: KEY } })).status).toBe(200);
    expect(await status(port)).toEqual({ version: '1.2.3', redditAuth: false, fixtures: false, ebay: false, claude: true });
    expect((await search(port)).plan.source).toBe('claude');
    expect(recorded.calls.map((c) => c.headers.authorization)).toEqual([`Bearer ${KEY}`]);

    expect((await putSettings(port, { values: { ANTHROPIC_API_KEY: KEY_B, SELLSCOUT_CLAUDE_MODEL: 'claude-sonnet-5-5' } })).status).toBe(200);
    expect((await search(port)).plan.source).toBe('claude');
    expect(recorded.calls.map((c) => c.headers.authorization)).toEqual([`Bearer ${KEY}`, `Bearer ${KEY_B}`]);
    expect(recorded.calls[1]?.body.model).toBe('claude-sonnet-5-5');

    expect((await putSettings(port, { values: { ANTHROPIC_API_KEY: null } })).status).toBe(200);
    expect(await status(port)).toMatchObject({ claude: false });
    const result = await search(port);
    expect(result.plan.source).toBe('catalog');
    expect(result.notices).toEqual([]);
    expect(recorded.calls).toHaveLength(2);
    for (const call of recorded.calls) expect(new URL(call.url).origin).toBe('https://api.anthropic.com');
  });

  it('saving the eBay and Reddit keys turns their chips on, and nothing is sent', async () => {
    const recorded = anthropicFetch();
    const port = await startWith({}, { fetch: recorded.fetch });
    const res = await putSettings(port, {
      values: { EBAY_CLIENT_ID: `${KEY}-E1`, EBAY_CLIENT_SECRET: `${KEY}-E2`, REDDIT_CLIENT_ID: `${KEY}-R1`, REDDIT_CLIENT_SECRET: `${KEY}-R2` },
    });
    expect(res.status).toBe(200);
    expect(await status(port)).toEqual({ version: '1.2.3', redditAuth: true, fixtures: false, ebay: true, claude: false });
    expect(recorded.calls).toEqual([]);
  });

  it('a search already running finishes on the old client; the next one uses the new key', async () => {
    vi.stubEnv('ANTHROPIC_BASE_URL', '');
    let release: (() => void) | undefined;
    const held = new Promise<void>((resolve) => (release = resolve));
    let first = true;
    const recorded = recordingFetch(async () => {
      if (first) {
        first = false;
        await held;
      }
      return jsonResponse(answerBody(GOOD));
    });
    await saveFile({ ANTHROPIC_API_KEY: KEY });
    const port = await startWith({}, { fetch: recorded.fetch });
    const running = search(port);
    const deadline = Date.now() + 5000;
    while (recorded.calls.length === 0) {
      if (Date.now() > deadline) throw new Error('the search never reached the planner');
      await new Promise((r) => setTimeout(r, 10));
    }
    expect((await putSettings(port, { values: { ANTHROPIC_API_KEY: KEY_B } })).status).toBe(200);
    release?.();
    expect((await running).plan.source).toBe('claude');
    await search(port);
    expect(recorded.calls.map((c) => c.headers.authorization)).toEqual([`Bearer ${KEY}`, `Bearer ${KEY_B}`]);
  });

  it('fixture mode: saving works, the chips stay on fixture, and the fixture store survives the reload', async () => {
    const port = await startWith({ SELLSCOUT_FIXTURES: '1' });
    const fixtureStatus = { version: '1.2.3', redditAuth: false, fixtures: true, ebay: false, claude: false };
    expect(await status(port)).toEqual(fixtureStatus);
    const added = await postFixtures(port, { post: { id: 'zx_reload', title: 'WTB zorblax widget', subreddit: 'hardwareswap' } });
    expect(added.status).toBe(200);

    const res = await putSettings(port, { values: { ANTHROPIC_API_KEY: KEY, EBAY_CLIENT_ID: `${KEY}-E1`, EBAY_CLIENT_SECRET: `${KEY}-E2` } });
    expect(res.status).toBe(200);
    expect(settingsOf(res).settings.ANTHROPIC_API_KEY.source).toBe('settings');
    expect(await fileValues()).toMatchObject({ ANTHROPIC_API_KEY: KEY });
    expect(await status(port)).toEqual(fixtureStatus);

    const result = json(await postSearch(port, { item: 'zorblax widget', window: 30 })) as SearchResult;
    expect(result.buyers.posts.map((p) => p.id)).toEqual(['zx_reload']);
    expect((await postFixtures(port, { reset: true })).status).toBe(200);
    const after = json(await postSearch(port, { item: 'zorblax widget', window: 30 })) as SearchResult;
    expect(after.buyers.posts).toEqual([]);
  });

  it('an injected search stays the same after a save', async () => {
    const seen: string[] = [];
    const injected: SearchFn = async (input) => {
      seen.push(input.item);
      return fakeResult(input);
    };
    const port = await startWith({}, { search: injected });
    expect((await putSettings(port, { values: { ANTHROPIC_API_KEY: KEY } })).status).toBe(200);
    expect(await status(port)).toMatchObject({ claude: true });
    await postSearch(port, { item: 'desk', window: 30 });
    expect(seen).toEqual(['desk']);
    expect((await postFixtures(port, { reset: true })).status).toBe(404);
  });
});

describe('isAllowedOrigin', () => {
  it('passes no Origin, this server on loopback, and the desktop window; nothing else', () => {
    expect(isAllowedOrigin(undefined, 5180)).toBe(true);
    expect(isAllowedOrigin('http://127.0.0.1:5180', 5180)).toBe(true);
    expect(isAllowedOrigin('http://localhost:5180', 5180)).toBe(true);
    expect(isAllowedOrigin('sellscout://app', 5180)).toBe(true);
    for (const origin of ['', 'null', 'http://127.0.0.1:5181', 'http://localhost', 'https://localhost:5180', 'http://[::1]:5180', 'sellscout://app/', 'SELLSCOUT://APP', 'https://evil.example']) {
      expect(isAllowedOrigin(origin, 5180)).toBe(false);
    }
  });
});
