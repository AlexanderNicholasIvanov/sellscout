// The sellscout://app -> loopback proxy, against real local servers (no Electron, no network).
import { createServer } from 'node:http';
import type { IncomingHttpHeaders, Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { forwardToServer } from '../../desktop/proxy.ts';
import { readConfig } from '../../server/config.ts';
import { startServer } from '../../server/start.ts';
import { closeServer } from '../server/helpers.ts';

interface Seen {
  method: string;
  url: string;
  headers: IncomingHttpHeaders;
  body: string;
}

let servers: Server[] = [];
afterEach(async () => {
  await Promise.all(servers.map((server) => closeServer(server)));
  servers = [];
});

/** An echo server that records each request and answers 201 with a few headers. */
async function echoServer(): Promise<{ port: number; seen: Seen[] }> {
  const seen: Seen[] = [];
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      seen.push({ method: req.method ?? '', url: req.url ?? '', headers: req.headers, body: Buffer.concat(chunks).toString('utf8') });
      res.writeHead(201, { 'Content-Type': 'application/json', 'X-Echo': 'yes', 'Set-Cookie': ['a=1', 'b=2'] });
      res.end('{"ok":true}');
    });
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { port: (server.address() as AddressInfo).port, seen };
}

describe('forwardToServer', () => {
  it('forwards a GET with its path, query and headers, and Host 127.0.0.1:<port>', async () => {
    const { port, seen } = await echoServer();
    const res = await forwardToServer(
      new Request('sellscout://app/api/status?x=1&y=a%20b', { headers: { Accept: 'application/json', 'X-Test': 't' } }),
      port,
    );
    expect(res.status).toBe(201);
    expect(res.headers.get('x-echo')).toBe('yes');
    expect(res.headers.get('content-type')).toBe('application/json');
    expect(await res.json()).toEqual({ ok: true });
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ method: 'GET', url: '/api/status?x=1&y=a%20b', body: '' });
    expect(seen[0]?.headers.host).toBe(`127.0.0.1:${port}`);
    expect(seen[0]?.headers['x-test']).toBe('t');
    expect(seen[0]?.headers.origin).toBeUndefined();
  });

  it('forwards a PUT body with Origin sellscout://app, replacing any other Origin', async () => {
    const { port, seen } = await echoServer();
    const body = JSON.stringify({ values: { SELLSCOUT_CLAUDE_MODEL: 'm' } });
    const res = await forwardToServer(
      new Request('sellscout://app/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Origin: 'https://evil.example' },
        body,
      }),
      port,
    );
    expect(res.status).toBe(201);
    expect(seen[0]).toMatchObject({ method: 'PUT', url: '/api/settings', body });
    expect(seen[0]?.headers.origin).toBe('sellscout://app');
    expect(seen[0]?.headers['content-type']).toBe('application/json');
    expect(seen[0]?.headers['content-length']).toBe(String(Buffer.byteLength(body)));
  });

  it('answers 404 for another host without calling the server', async () => {
    const { port, seen } = await echoServer();
    const res = await forwardToServer(new Request('sellscout://elsewhere/api/status'), port);
    expect(res.status).toBe(404);
    expect(seen).toHaveLength(0);
  });

  it('answers 502 when the server is gone', async () => {
    const { port } = await echoServer();
    await closeServer(servers.pop() as Server);
    const res = await forwardToServer(new Request('sellscout://app/api/status'), port);
    expect(res.status).toBe(502);
  });

  it('reaches the real sellscout server: status, search and its Host check passes', async () => {
    const server = await startServer({ port: 0, version: '9.9.9', distDir: '/nonexistent-sellscout-dist', config: readConfig({}) });
    servers.push(server);
    const { port } = server.address() as AddressInfo;

    const status = await forwardToServer(new Request('sellscout://app/api/status'), port);
    expect(status.status).toBe(200);
    expect(await status.json()).toMatchObject({ version: '9.9.9', fixtures: false });

    const search = await forwardToServer(
      new Request('sellscout://app/api/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ item: 'mechanical keyboard', delivery: 'ship', window: 30 }),
      }),
      port,
    );
    expect(search.status).toBe(200);
    const result = (await search.json()) as { venues: Array<{ name: string }> };
    expect(result.venues.some((venue) => venue.name === 'r/mechmarket')).toBe(true);

    const wrongType = await forwardToServer(
      new Request('sellscout://app/api/search', { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: 'x' }),
      port,
    );
    expect(wrongType.status).toBe(400);
  });
});
