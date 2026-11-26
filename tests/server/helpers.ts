import { createServer, request as httpRequest } from 'node:http';
import type { IncomingHttpHeaders, IncomingMessage, Server, ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createApp } from '../../server/app.ts';
import type { AppOptions, RequestHandler } from '../../server/app.ts';
import type { SearchFn, SearchInput, SearchResult } from '../../server/types.ts';

export const fakeResult = async (input: SearchInput): Promise<SearchResult> => ({
  plan: { source: 'catalog', categories: [], searchTerm: input.item },
  venues: [],
  buyers: { status: 'disabled', term: input.item, windowDays: input.window, posts: [], links: [] },
  ebay: { status: 'disabled', term: input.item, listings: [], searchUrl: 'https://www.ebay.com/sch/i.html?_nkw=x' },
  notices: [],
});

export interface TestApp {
  port: number;
  calls: SearchInput[];
  close: () => Promise<void>;
}

/** Runs createApp on a real loopback socket on an ephemeral port. */
export async function listenApp(overrides: Partial<Omit<AppOptions, 'port'>> = {}): Promise<TestApp> {
  const calls: SearchInput[] = [];
  const recordingSearch: SearchFn = async (input) => {
    calls.push(input);
    return (overrides.search ?? fakeResult)(input);
  };
  // The Host check needs the bound port, which is only known after listen.
  const holder: { app?: RequestHandler } = {};
  const server: Server = createServer((req: IncomingMessage, res: ServerResponse) => holder.app?.(req, res));
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  holder.app = createApp({
    version: overrides.version ?? '9.9.9',
    distDir: overrides.distDir ?? '/nonexistent-sellscout-dist',
    search: recordingSearch,
    port,
    ...(overrides.status ? { status: overrides.status } : {}),
    ...(overrides.fixtures ? { fixtures: overrides.fixtures } : {}),
  });
  return { port, calls, close: () => closeServer(server) };
}

export function closeServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
    server.closeAllConnections();
  });
}

export interface RawResponse {
  status: number;
  headers: IncomingHttpHeaders;
  body: string;
}

/**
 * Sends one request over loopback with the path sent verbatim (no URL normalisation, so
 * `/../x` and `%2e%2e` reach the server as typed). Host defaults to 127.0.0.1:<port>.
 */
export function rawRequest(
  port: number,
  opts: { method?: string; path?: string; headers?: Record<string, string | number>; body?: string | Buffer } = {},
): Promise<RawResponse> {
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      {
        host: '127.0.0.1',
        port,
        method: opts.method ?? 'GET',
        path: opts.path ?? '/',
        headers: { Host: `127.0.0.1:${port}`, ...opts.headers },
        agent: false,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () =>
          resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') }),
        );
        res.on('error', reject);
      },
    );
    req.on('error', reject);
    if (opts.body !== undefined) req.write(opts.body);
    req.end();
  });
}

/** POST /api/search with a JSON content type. */
export function postSearch(port: number, body: unknown, headers: Record<string, string> = {}): Promise<RawResponse> {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  return rawRequest(port, {
    method: 'POST',
    path: '/api/search',
    headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(text), ...headers },
    body: text,
  });
}

/** POST /api/__fixtures with a JSON content type. */
export function postFixtures(port: number, body: unknown, headers: Record<string, string> = {}): Promise<RawResponse> {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  return rawRequest(port, {
    method: 'POST',
    path: '/api/__fixtures',
    headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(text), ...headers },
    body: text,
  });
}

export const json = (res: RawResponse): unknown => JSON.parse(res.body);
