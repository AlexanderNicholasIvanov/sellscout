import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import type { AddressInfo, Server as NetServer } from 'node:net';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { parsePort, startServer } from '../../server/main.ts';
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

/** Spawns `node server/main.ts` (no shell, so the PID is node's own). */
function spawnMain(port: string): Spawned {
  const child = spawn(process.execPath, ['server/main.ts'], {
    cwd: repoRoot,
    env: { ...process.env, PORT: port },
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
    expect(JSON.parse(res.body)).toEqual({ version: '1.2.3' });
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
    expect(await res.json()).toEqual({ version: pkg.version });
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

  it('rejects a bad PORT and exits 1', async () => {
    const proc = spawnMain('not-a-port');
    expect(await proc.exit).toBe(1);
    expect(proc.stderr()).toContain('PORT must be a number between 1 and 65535');
  }, 20_000);
});
