import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import type { AddressInfo, Server as NetServer } from 'node:net';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { DOTENV_PATH, FIXTURE_MODE_MESSAGE, loadDotEnv, parsePort, prepareConfig, startServer } from '../../server/main.ts';
import { closeServer, fakeResult, rawRequest } from './helpers.ts';

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

/** The test runner's environment without any sellscout or Reddit setting from the developer's shell. */
function cleanEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  for (const name of Object.keys(env)) {
    if (name.startsWith('SELLSCOUT_') || name.startsWith('REDDIT_')) delete env[name];
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
    expect(JSON.parse(res.body)).toEqual({ version: '1.2.3', redditAuth: false, fixtures: false });
  });

  it('rejects with EADDRINUSE when the port is taken', async () => {
    const blocker = await occupyPort();
    cleanups.push(() => new Promise((r) => blocker.close(() => r())));
    const { port } = blocker.address() as AddressInfo;
    await expect(startServer({ port })).rejects.toMatchObject({ code: 'EADDRINUSE' });
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
    expect(await res.json()).toEqual({ version: pkg.version, redditAuth: false, fixtures: false });
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
    });
    await waitFor(() => proc.stdout().includes(`127.0.0.1:${port}`) || proc.child.exitCode !== null, 15_000);
    expect(proc.stdout().trim().split(/\r?\n/)).toEqual([
      FIXTURE_MODE_MESSAGE,
      `sellscout running at http://127.0.0.1:${port}`,
    ]);
    expect(FIXTURE_MODE_MESSAGE).toBe('sellscout: fixture mode (canned Reddit data, outbound requests blocked)');
    const status = await fetch(`http://127.0.0.1:${port}/api/status`);
    expect(await status.json()).toEqual({ version: pkg.version, redditAuth: false, fixtures: true });
    const res = await fetch(`http://127.0.0.1:${port}/api/search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ item: 'mechanical keyboard', window: 30 }),
    });
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).not.toContain('SENTINEL');
    const body = JSON.parse(text) as { buyers: { term: string; windowDays: number } };
    expect(body.buyers).toMatchObject({ term: 'mechanical keyboard', windowDays: 30 });
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
    const { config, calls } = run({ SELLSCOUT_FIXTURES: '1', REDDIT_CLIENT_ID: 'id', REDDIT_CLIENT_SECRET: 'secret' }, {});
    expect(config.fixtures).toBe(true);
    expect(config.reddit.clientSecret).toBe('');
    expect(calls).toEqual(['guard', `log:${FIXTURE_MODE_MESSAGE}`]);
  });

  it('a .env that sets SELLSCOUT_FIXTURES=1 does not turn fixture mode on, and its keys are read', () => {
    const { config, calls } = run(
      {},
      { SELLSCOUT_FIXTURES: '1', REDDIT_CLIENT_ID: 'from-dotenv', REDDIT_CLIENT_SECRET: 'dotenv-secret' },
    );
    expect(config.fixtures).toBe(false);
    expect(config.reddit.clientId).toBe('from-dotenv');
    expect(calls).toEqual(['load']);
  });

  it('without fixture mode the guard is never installed', () => {
    const { config, calls } = run({ SELLSCOUT_FIXTURES: '0' }, null);
    expect(config.fixtures).toBe(false);
    expect(calls).toEqual([]);
  });
});
