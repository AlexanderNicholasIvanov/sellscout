import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { listenApp, rawRequest } from './helpers.ts';
import type { TestApp } from './helpers.ts';

// Layout: <tmp>/secret.txt sits next to <tmp>/dist, so a traversal one level up would reach it.
let tmp: string;
let distDir: string;
let app: TestApp;

const INDEX = '<!doctype html><title>sellscout</title>';
const SECRET = 'TOP-SECRET-OUTSIDE-DIST';

beforeAll(async () => {
  tmp = mkdtempSync(join(tmpdir(), 'sellscout-static-'));
  distDir = join(tmp, 'dist');
  mkdirSync(join(distDir, 'assets'), { recursive: true });
  writeFileSync(join(distDir, 'index.html'), INDEX);
  writeFileSync(join(distDir, 'assets', 'x.js'), 'console.log(1);');
  writeFileSync(join(distDir, 'assets', 'x.css'), 'body{}');
  writeFileSync(join(distDir, 'assets', 'font.woff2'), 'woff2');
  writeFileSync(join(distDir, 'favicon.svg'), '<svg/>');
  writeFileSync(join(tmp, 'secret.txt'), SECRET);
  writeFileSync(join(tmp, 'package.json'), `{"secret":"${SECRET}"}`);
  app = await listenApp({ distDir });
});

afterAll(async () => {
  await app.close();
  rmSync(tmp, { recursive: true, force: true });
});

describe('static files', () => {
  it('serves index.html at /', async () => {
    const res = await rawRequest(app.port, { path: '/' });
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('text/html; charset=utf-8');
    expect(res.body).toBe(INDEX);
  });

  it('serves /assets/x.js with a JavaScript content type', async () => {
    const res = await rawRequest(app.port, { path: '/assets/x.js' });
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('text/javascript; charset=utf-8');
    expect(res.body).toBe('console.log(1);');
  });

  it.each([
    ['/assets/x.css', 'text/css; charset=utf-8'],
    ['/assets/font.woff2', 'font/woff2'],
    ['/favicon.svg', 'image/svg+xml'],
  ])('serves %s as %s', async (path, type) => {
    const res = await rawRequest(app.port, { path });
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe(type);
  });

  it('answers HEAD with headers and no body', async () => {
    const res = await rawRequest(app.port, { method: 'HEAD', path: '/assets/x.js' });
    expect(res.status).toBe(200);
    expect(res.headers['content-length']).toBe(String('console.log(1);'.length));
    expect(res.body).toBe('');
  });

  it('falls back to index.html for an unknown app route', async () => {
    const res = await rawRequest(app.port, { path: '/results?item=bike' });
    expect(res.status).toBe(200);
    expect(res.body).toBe(INDEX);
  });

  it('gives 404 for a missing file with an extension', async () => {
    const res = await rawRequest(app.port, { path: '/assets/missing.js' });
    expect(res.status).toBe(404);
  });

  it('answers POST to a page with 405', async () => {
    const res = await rawRequest(app.port, { method: 'POST', path: '/' });
    expect(res.status).toBe(405);
  });

  it.each([
    '/../secret.txt',
    '/../../package.json',
    '/../package.json',
    '/assets/../../secret.txt',
    '/%2e%2e/secret.txt',
    '/%2E%2E/%2e%2e/package.json',
    '/%2e%2e%2fsecret.txt',
    '/..%2fsecret.txt',
    '/..%5csecret.txt',
    '/..\\secret.txt',
    '/%2e%2e%5c%2e%2e%5cpackage.json',
    '/assets/%2e%2e/%2e%2e/secret.txt',
    '/%00../secret.txt',
    '/%zz',
  ])('never serves a file outside distDir for %s', async (path) => {
    const res = await rawRequest(app.port, { path });
    expect([200, 404]).toContain(res.status);
    expect(res.body).not.toContain(SECRET);
    if (res.status === 200) expect(res.body).toBe(INDEX);
  });
});

describe('missing dist', () => {
  it('answers 503 with a hint when distDir does not exist', async () => {
    const missing = await listenApp({ distDir: join(tmp, 'no-such-dist') });
    try {
      const res = await rawRequest(missing.port, { path: '/' });
      expect(res.status).toBe(503);
      expect(res.body).toBe('UI not built; run npm run build');
      const api = await rawRequest(missing.port, { path: '/api/status' });
      expect(api.status).toBe(200);
    } finally {
      await missing.close();
    }
  });
});
