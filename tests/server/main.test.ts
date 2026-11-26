import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import type { AddressInfo, Server as NetServer } from 'node:net';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DOTENV_PATH, FIXTURE_MODE_MESSAGE, loadDotEnv, parsePort, prepareConfig, startServer } from '../../server/main.ts';
import { readConfig } from '../../server/config.ts';
import { FIXTURE_POSTS } from '../../server/reddit/fixtures/posts.ts';
import type { SearchResult } from '../../server/types.ts';
import { closeServer, fakeResult, json, postFixtures, postSearch, rawRequest } from './helpers.ts';

const repoRoot = fileURLToPath(new URL('../../', import.meta.url));
const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as { version: string };

/** Binds a TCP server on 127.0.0.1 at a free port and keeps it open. */
function occupyPort(): Promise<NetServer> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

async function freePort(): Promise<number> {
  const server = await occupyPort();
  const { port } = server.address() as AddressInfo;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}

interface Spawned {
  child: ChildProcess;
  stdout: () => string;
  stderr: () => string;
  exit: Promise<number | null>;
}

/** The test runner's environment without any sellscout, Reddit or eBay setting from the developer's shell. */
function cleanEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  for (const name of Object.keys(env)) {
    if (name.startsWith('SELLSCOUT_') || name.startsWith('REDDIT_') || name.startsWith('EBAY_')) delete env[name];
  }
  return env;
}

/** Spawns `node server/main.ts` (no shell, so the PID is node's own). */
function spawnMain(port: string, extraEnv: Record<string, string> = {}): Spawned {
  const child = spawn(process.execPath, ['server/main.ts'], {
    cwd: repoRoot,
    env: { ...cleanEnv(), NODE_ENV: 'test', PORT: port, ...extraEnv },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let out = '';
  let err = '';
  child.stdout?.on('data', (c: Buffer) => (out += c.toString('utf8')));
  child.stderr?.on('data', (c: Buffer) => (err += c.toString('utf8')));
  const exit = new Promise<number | null>((resolve) => child.on('exit', (code) => resolve(code)));
  spawned.push(child);
  return { child, stdout: () => out, stderr: () => err, exit };
}

async function waitFor(check: () => boolean, ms: number): Promise<void> {
  const deadline = Date.now() + ms;
  while (!check()) {
    if (Date.now() > deadline) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 50));
  }
}

const spawned: ChildProcess[] = [];
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const child of spawned.splice(0)) {
    if (child.exitCode === null && child.signalCode === null) {
      const exited = new Promise((r) => child.once('exit', r));
      child.kill();
      await exited;
    }
  }
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

describe('startServer (AC3)', () => {
  it('listens on 127.0.0.1 on an ephemeral port and serves the app', async () => {
    const server = await startServer({ port: 0, search: fakeResult, version: '1.2.3' });
    cleanups.push(() => closeServer(server));
    const address = server.address() as AddressInfo;
    expect(address.address).toBe('127.0.0.1');
    expect(address.port).toBeGreaterThan(0);
    const res = await rawRequest(address.port, { path: '/api/status' });
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ version: '1.2.3', redditAuth: false, fixtures: false, ebay: false });
  });

  it('reports ebay: true with eBay keys and fixtures off, and sends nothing at start-up (run 3 AC3)', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const config = readConfig({ EBAY_CLIENT_ID: 'SENTINEL-EBAY-ID', EBAY_CLIENT_SECRET: 'SENTINEL-EBAY-SECRET' });
    const server = await startServer({ port: 0, version: '1.2.3', config });
    cleanups.push(() => closeServer(server));
    const { port } = server.address() as AddressInfo;
    const res = await rawRequest(port, { path: '/api/status' });
    expect(json(res)).toEqual({ version: '1.2.3', redditAuth: false, fixtures: false, ebay: true });
    expect(res.body).not.toContain('SENTINEL');
    expect(fetchSpy.mock.calls.map((call) => String(call[0])).filter((url) => !url.startsWith('http://127.0.0.1'))).toEqual([]);
    fetchSpy.mockRestore();
  });

  it('rejects with EADDRINUSE when the port is taken', async () => {
    const blocker = await occupyPort();
    cleanups.push(() => new Promise((r) => blocker.close(() => r())));
    const { port } = blocker.address() as AddressInfo;
    await expect(startServer({ port })).rejects.toMatchObject({ code: 'EADDRINUSE' });
  });
});

describe('startServer in fixture mode: eBay (run 3 AC3, AC11)', () => {
  it('answers "mechanical keyboard" with the agreed listings, range and category venue over HTTP', async () => {
    const config = readConfig({ SELLSCOUT_FIXTURES: '1', EBAY_CLIENT_ID: 'SENTINEL-EBAY-ID', EBAY_CLIENT_SECRET: 'SENTINEL-EBAY-SECRET' });
    const server = await startServer({ port: 0, version: '1.2.3', config });
    cleanups.push(() => closeServer(server));
    const { port } = server.address() as AddressInfo;
    expect(json(await rawRequest(port, { path: '/api/status' }))).toEqual({ version: '1.2.3', redditAuth: false, fixtures: true, ebay: false });

    const res = await postSearch(port, { item: 'mechanical keyboard', delivery: 'both', window: 30 });
    expect(res.status).toBe(200);
    expect(res.body).not.toContain('SENTINEL');
    const result = json(res) as SearchResult;
    expect(result.ebay.status).toBe('ok');
    expect(result.ebay.term).toBe('mechanical keyboard');
    expect(result.ebay.listings.map((l) => [l.id, l.price])).toEqual([
      ['fx_eb1', 50],
      ['fx_eb2', 80],
      ['fx_eb3', 100],
      ['fx_eb4', 120],
      ['fx_eb5', 150],
      ['fx_eb6', 400],
    ]);
    expect(result.ebay.priceRange).toEqual({ count: 6, p25: 85, median: 110, p75: 142.5 });
    expect(result.ebay.searchUrl).toBe('https://www.ebay.com/sch/i.html?_nkw=mechanical%20keyboard');
    const ids = result.venues.map((v) => v.id);
    const at = ids.indexOf('ebay-category');
    expect(at).toBe(ids.indexOf('ebay') + 1);
    expect(result.venues[at]).toMatchObject({
      name: 'eBay - Keyboards & Keypads',
      url: 'https://www.ebay.com/sch/i.html?_nkw=mechanical%20keyboard&_sacat=33963',
    });
    // The buyers still come from the Reddit fixtures.
    expect(result.buyers.status).toBe('ok');
  });

  it('a failure term gives its reason and the venues and buyers still show', async () => {
    const server = await startServer({ port: 0, version: '1.2.3', config: readConfig({ SELLSCOUT_FIXTURES: '1' }) });
    cleanups.push(() => closeServer(server));
    const { port } = server.address() as AddressInfo;
    const result = json(await postSearch(port, { item: 'ebay-429 widget', window: 30 })) as SearchResult;
    expect(result.ebay).toMatchObject({ status: 'unavailable', reason: 'eBay rate limit reached (HTTP 429)', listings: [] });
    expect(result.venues.length).toBeGreaterThan(0);
    expect(result.venues.map((v) => v.id)).not.toContain('ebay-category');
    expect(result.buyers.status).toBe('ok');
  });
});

describe('startServer and POST /api/__fixtures (run 2b AC5)', () => {
  const searchIds = async (port: number, item: string): Promise<string[]> => {
    const res = await postSearch(port, { item, window: 30 });
    expect(res.status).toBe(200);
    const result = json(res) as SearchResult;
    expect(result.buyers.status).toBe('ok');
    return result.buyers.posts.map((p) => p.id);
  };

  it('in fixture mode the buyer search and the app share one store', async () => {
    const server = await startServer({ port: 0, version: '1.2.3', config: readConfig({ SELLSCOUT_FIXTURES: '1' }) });
    cleanups.push(() => closeServer(server));
    const { port } = server.address() as AddressInfo;
    expect(await searchIds(port, 'zorblax widget')).toEqual([]);

    const added = await postFixtures(port, { post: { id: 'zx_main', title: 'WTB zorblax widget', subreddit: 'hardwareswap' } });
    expect(added.status).toBe(200);
    expect(json(added)).toEqual({ ok: true, posts: FIXTURE_POSTS.length + 1 });
    expect(await searchIds(port, 'zorblax widget')).toEqual(['zx_main']);

    const reset = await postFixtures(port, { reset: true });
    expect(json(reset)).toEqual({ ok: true, posts: FIXTURE_POSTS.length });
    expect(await searchIds(port, 'zorblax widget')).toEqual([]);
  });

  it('two fixture-mode servers do not share added posts', async () => {
    const a = await startServer({ port: 0, version: '1.2.3', config: readConfig({ SELLSCOUT_FIXTURES: '1' }) });
    cleanups.push(() => closeServer(a));
    const b = await startServer({ port: 0, version: '1.2.3', config: readConfig({ SELLSCOUT_FIXTURES: '1' }) });
    cleanups.push(() => closeServer(b));
    const portA = (a.address() as AddressInfo).port;
    const portB = (b.address() as AddressInfo).port;
    await postFixtures(portA, { post: { id: 'zx_a', title: 'WTB zorblax widget', subreddit: 'hardwareswap' } });
    expect(await searchIds(portA, 'zorblax widget')).toEqual(['zx_a']);
    expect(await searchIds(portB, 'zorblax widget')).toEqual([]);
  });

  it('with fixtures off /api/__fixtures is a 404', async () => {
    const server = await startServer({ port: 0, version: '1.2.3', config: readConfig({}) });
    cleanups.push(() => closeServer(server));
    const { port } = server.address() as AddressInfo;
    const res = await postFixtures(port, { reset: true });
    expect(res.status).toBe(404);
    expect(json(res)).toEqual({ error: 'Not found' });
    expect((await rawRequest(port, { path: '/api/__fixtures' })).status).toBe(404);
  });

  it('the default config (no config given) has no /api/__fixtures either', async () => {
    const server = await startServer({ port: 0, search: fakeResult, version: '1.2.3' });
    cleanups.push(() => closeServer(server));
    const { port } = server.address() as AddressInfo;
    expect((await postFixtures(port, { reset: true })).status).toBe(404);
  });
});

describe('parsePort', () => {
  it.each([
    [undefined, 5180],
    ['', 5180],
    ['5181', 5181],
    ['1', 1],
    ['65535', 65535],
    ['0', null],
    ['65536', null],
    ['-1', null],
    ['80.5', null],
    ['abc', null],
    ['1e3', null],
  ])('parsePort(%s) is %s', (value, expected) => {
    expect(parsePort(value)).toBe(expected);
  });
});

describe('node server/main.ts', () => {
  it('prints the URL and answers /api/status (AC3)', async () => {
    const port = await freePort();
    const proc = spawnMain(String(port));
    await waitFor(() => proc.stdout().includes('\n') || proc.child.exitCode !== null, 15_000);
    expect(proc.stdout().trim()).toBe(`sellscout running at http://127.0.0.1:${port}`);
    const res = await fetch(`http://127.0.0.1:${port}/api/status`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ version: pkg.version, redditAuth: false, fixtures: false, ebay: false });
  }, 20_000);

  it('prints the port-in-use message and exits 1 (AC4)', async () => {
    const blocker = await occupyPort();
    cleanups.push(() => new Promise((r) => blocker.close(() => r())));
    const { port } = blocker.address() as AddressInfo;
    const proc = spawnMain(String(port));
    expect(await proc.exit).toBe(1);
    expect(proc.stderr()).toContain(`Port ${port} is in use; set PORT to another port`);
    expect(proc.stdout()).toBe('');
  }, 20_000);

  it('runs in fixture mode with SELLSCOUT_FIXTURES=1: keys ignored, notice printed (AC3, AC16)', async () => {
    const port = await freePort();
    const proc = spawnMain(String(port), {
      SELLSCOUT_FIXTURES: '1',
      REDDIT_CLIENT_ID: 'SENTINEL-ID-456',
      REDDIT_CLIENT_SECRET: 'SENTINEL-SECRET-123',
      EBAY_CLIENT_ID: 'SENTINEL-EBAY-ID',
      EBAY_CLIENT_SECRET: 'SENTINEL-EBAY-SECRET',
    });
    await waitFor(() => proc.stdout().includes(`127.0.0.1:${port}`) || proc.child.exitCode !== null, 15_000);
    expect(proc.stdout().trim().split(/\r?\n/)).toEqual([
      FIXTURE_MODE_MESSAGE,
      `sellscout running at http://127.0.0.1:${port}`,
    ]);
    expect(FIXTURE_MODE_MESSAGE).toBe('sellscout: fixture mode (canned Reddit data, outbound requests blocked)');
    const status = await fetch(`http://127.0.0.1:${port}/api/status`);
    expect(await status.json()).toEqual({ version: pkg.version, redditAuth: false, fixtures: true, ebay: false });
    const res = await fetch(`http://127.0.0.1:${port}/api/search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ item: 'mechanical keyboard', window: 30 }),
    });
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).not.toContain('SENTINEL');
    const body = JSON.parse(text) as { buyers: { term: string; windowDays: number }; ebay: SearchResult['ebay'] };
    expect(body.buyers).toMatchObject({ term: 'mechanical keyboard', windowDays: 30 });
    expect(body.ebay.listings.map((l) => l.id)).toEqual(['fx_eb1', 'fx_eb2', 'fx_eb3', 'fx_eb4', 'fx_eb5', 'fx_eb6']);
    expect(body.ebay.priceRange).toEqual({ count: 6, p25: 85, median: 110, p75: 142.5 });
    expect(proc.stderr()).not.toContain('SENTINEL');
  }, 20_000);

  it('rejects a bad PORT and exits 1', async () => {
    const proc = spawnMain('not-a-port');
    expect(await proc.exit).toBe(1);
    expect(proc.stderr()).toContain('PORT must be a number between 1 and 65535');
  }, 20_000);
});

describe('loadDotEnv (AC17)', () => {
  const path = '/repo/.env';

  it.each([
    // exists, SELLSCOUT_FIXTURES, NODE_ENV, loads
    [true, undefined, undefined, true],
    [true, undefined, 'development', true],
    [true, undefined, 'production', true],
    [true, '1', undefined, false],
    [true, undefined, 'test', false],
    [true, '1', 'test', false],
    [false, undefined, undefined, false],
    [false, '1', undefined, false],
    [false, undefined, 'test', false],
    [false, '1', 'test', false],
    [true, '0', undefined, true],
    [true, 'true', undefined, true],
  ])('exists=%s SELLSCOUT_FIXTURES=%s NODE_ENV=%s loads=%s', (exists, fixtures, nodeEnv, expected) => {
    const loaded: string[] = [];
    const checked: string[] = [];
    const result = loadDotEnv({
      env: { SELLSCOUT_FIXTURES: fixtures, NODE_ENV: nodeEnv },
      exists: (p) => {
        checked.push(p);
        return exists;
      },
      load: (p) => {
        loaded.push(p);
      },
      path,
    });
    expect(result).toBe(expected);
    expect(loaded).toEqual(expected ? [path] : []);
    for (const p of checked) expect(p).toBe(path);
  });

  it('points at <repo root>/.env', () => {
    expect(DOTENV_PATH).toBe(join(repoRoot, '.env'));
  });
});

describe('prepareConfig (AC16, AC17: start-up order)', () => {
  function run(env: Record<string, string | undefined>, dotenv: Record<string, string> | null) {
    const calls: string[] = [];
    const config = prepareConfig({
      env,
      path: '/repo/.env',
      exists: () => dotenv !== null,
      load: () => {
        calls.push('load');
        Object.assign(env, dotenv);
      },
      installGuard: () => calls.push('guard'),
      log: (message) => calls.push(`log:${message}`),
    });
    return { config, calls };
  }

  it('installs the fetch guard and ignores keys in fixture mode', () => {
    const { config, calls } = run(
      { SELLSCOUT_FIXTURES: '1', REDDIT_CLIENT_ID: 'id', REDDIT_CLIENT_SECRET: 'secret', EBAY_CLIENT_ID: 'eid', EBAY_CLIENT_SECRET: 'esecret' },
      {},
    );
    expect(config.fixtures).toBe(true);
    expect(config.reddit.clientSecret).toBe('');
    expect(config.ebay).toEqual({ clientId: '', clientSecret: '' });
    expect(calls).toEqual(['guard', `log:${FIXTURE_MODE_MESSAGE}`]);
  });

  it('a .env that sets SELLSCOUT_FIXTURES=1 does not turn fixture mode on, and its keys are read', () => {
    const { config, calls } = run(
      {},
      {
        SELLSCOUT_FIXTURES: '1',
        REDDIT_CLIENT_ID: 'from-dotenv',
        REDDIT_CLIENT_SECRET: 'dotenv-secret',
        EBAY_CLIENT_ID: ' ebay-from-dotenv ',
        EBAY_CLIENT_SECRET: 'ebay-dotenv-secret',
      },
    );
    expect(config.fixtures).toBe(false);
    expect(config.reddit.clientId).toBe('from-dotenv');
    expect(config.ebay).toEqual({ clientId: 'ebay-from-dotenv', clientSecret: 'ebay-dotenv-secret' });
    expect(calls).toEqual(['load']);
  });

  it('without fixture mode the guard is never installed', () => {
    const { config, calls } = run({ SELLSCOUT_FIXTURES: '0' }, null);
    expect(config.fixtures).toBe(false);
    expect(calls).toEqual([]);
  });
});
