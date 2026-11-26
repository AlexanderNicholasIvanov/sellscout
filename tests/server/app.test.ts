import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { json, listenApp, postSearch, rawRequest } from './helpers.ts';
import type { TestApp } from './helpers.ts';

const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as { version: string };

let app: TestApp | undefined;
afterEach(async () => {
  await app?.close();
  app = undefined;
  vi.restoreAllMocks();
});

describe('GET /api/status (AC5)', () => {
  it("returns the package.json version", async () => {
    app = await listenApp({ version: pkg.version });
    const res = await fetch(`http://127.0.0.1:${app.port}/api/status`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/json; charset=utf-8');
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(await res.json()).toEqual({ version: pkg.version });
  });

  it('accepts localhost:<port> as Host', async () => {
    app = await listenApp();
    const res = await rawRequest(app.port, { path: '/api/status', headers: { Host: `localhost:${app.port}` } });
    expect(res.status).toBe(200);
  });
});

describe('hardening (AC7)', () => {
  it('rejects a foreign Host header with 403', async () => {
    app = await listenApp();
    const res = await rawRequest(app.port, { path: '/api/status', headers: { Host: 'evil.example:5180' } });
    expect(res.status).toBe(403);
    expect(json(res)).toEqual({ error: 'Forbidden host' });
  });

  it('rejects the right host on the wrong port and a bare host', async () => {
    app = await listenApp();
    const wrongPort = await rawRequest(app.port, { path: '/api/status', headers: { Host: `127.0.0.1:${app.port + 1}` } });
    const bare = await rawRequest(app.port, { path: '/api/status', headers: { Host: '127.0.0.1' } });
    expect(wrongPort.status).toBe(403);
    expect(bare.status).toBe(403);
  });

  it('sends no CORS headers, even to a cross-origin request', async () => {
    app = await listenApp();
    const res = await rawRequest(app.port, { path: '/api/status', headers: { Origin: 'https://evil.example' } });
    expect(res.status).toBe(200);
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
    expect(Object.keys(res.headers).filter((h) => h.startsWith('access-control-'))).toEqual([]);
  });

  it('gives OPTIONS no special handling', async () => {
    app = await listenApp();
    const res = await rawRequest(app.port, {
      method: 'OPTIONS',
      path: '/api/search',
      headers: { Origin: 'https://evil.example', 'Access-Control-Request-Method': 'POST' },
    });
    expect(res.status).toBe(405);
    expect(Object.keys(res.headers).filter((h) => h.startsWith('access-control-'))).toEqual([]);
  });

  it('sets the security headers on every response', async () => {
    app = await listenApp();
    for (const res of [
      await rawRequest(app.port, { path: '/api/status' }),
      await rawRequest(app.port, { path: '/api/status', headers: { Host: 'evil.example' } }),
      await rawRequest(app.port, { path: '/' }),
    ]) {
      expect(res.headers['x-content-type-options']).toBe('nosniff');
      expect(res.headers['referrer-policy']).toBe('no-referrer');
      expect(res.headers['x-frame-options']).toBe('DENY');
    }
  });

  it('answers an unknown /api path with 404 JSON', async () => {
    app = await listenApp();
    const res = await rawRequest(app.port, { path: '/api/x' });
    expect(res.status).toBe(404);
    expect(res.headers['content-type']).toBe('application/json; charset=utf-8');
    expect(json(res)).toEqual({ error: 'Not found' });
  });

  it.each([
    ['POST', '/api/status'],
    ['DELETE', '/api/status'],
    ['GET', '/api/search'],
    ['PUT', '/api/search'],
  ])('answers %s %s with 405', async (method, path) => {
    app = await listenApp();
    const res = await rawRequest(app.port, { method, path });
    expect(res.status).toBe(405);
    expect(json(res)).toEqual({ error: 'Method not allowed' });
  });

  it('turns a throwing search into a 500 with no stack in the body', async () => {
    const stderr = vi.spyOn(console, 'error').mockImplementation(() => {});
    app = await listenApp({
      search: () => {
        throw new Error('secret engine detail');
      },
    });
    const res = await postSearch(app.port, { item: 'a private item description' });
    expect(res.status).toBe(500);
    expect(json(res)).toEqual({ error: 'Internal error' });
    expect(res.body).not.toContain('secret');
    expect(res.body).not.toContain('at ');
    expect(stderr).toHaveBeenCalledTimes(1);
    const logged = stderr.mock.calls.flat().join(' ');
    expect(logged).toContain('secret engine detail');
    expect(logged).not.toContain('a private item description');
  });
});

describe('POST /api/search happy path', () => {
  it('returns the search result as JSON', async () => {
    app = await listenApp();
    const res = await fetch(`http://127.0.0.1:${app.port}/api/search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ item: 'road bike', location: 'Seattle', delivery: 'local' }),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(await res.json()).toEqual({
      plan: { source: 'catalog', categories: [], searchTerm: 'road bike' },
      venues: [],
      notices: [],
    });
    expect(app.calls).toEqual([{ item: 'road bike', location: 'Seattle', delivery: 'local' }]);
  });
});
