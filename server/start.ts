// Starts the sellscout HTTP server (API + built UI). No side effects on import, so the desktop
// app's bundle can import it without starting anything.
import { createServer } from 'node:http';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from './app.ts';
import type { RequestHandler } from './app.ts';
import { createClaudePlanner } from './claude/index.ts';
import { hasClaudeKey, hasEbayKeys, hasRedditKeys, readConfig } from './config.ts';
import type { AppConfig } from './config.ts';
import { createEbaySearch } from './ebay/index.ts';
import { createFixtureStore } from './reddit/fixtures/store.ts';
import { createBuyerSearch } from './reddit/index.ts';
import { createSearchService } from './search.ts';
import type { SearchFn } from './types.ts';
import { searchVenues } from './venues/index.ts';

export const HOST = '127.0.0.1';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
export const DIST_DIR = join(repoRoot, 'dist');

export function readVersion(): string {
  const pkg = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8')) as { version: string };
  return pkg.version;
}

export interface StartOptions {
  /** 0 picks a free port (tests). */
  port: number;
  host?: string;
  search?: SearchFn;
  version?: string;
  distDir?: string;
  /** Default: no Reddit keys, fixtures off. Ignored when `settings` is set. */
  config?: AppConfig;
  /**
   * The Settings screen (spec "Settings API"). `env`: the environment after `.env`, with
   * SELLSCOUT_FIXTURES already forced to the real value; its non-empty values win over the file.
   * `file`: where keys are saved, or null (read-only). When set, the config is read from
   * env + file at start and again after every save, and `config` is ignored.
   */
  settings?: { file: string | null; env: Record<string, string | undefined> };
}

/** Starts listening; resolves once bound, rejects with the listen error (e.g. EADDRINUSE). */
export function startServer(options: StartOptions): Promise<Server> {
  const host = options.host ?? HOST;
  const config = options.config ?? readConfig({});
  const version = options.version ?? readVersion();
  // Fixture mode: one store shared by the buyer search and POST /api/__fixtures. Off, or an
  // injected `search` that would never read it: no store, so that route 404s.
  const fixtureStore = config.fixtures && options.search === undefined ? createFixtureStore() : undefined;
  // Late-bound so the fixture-mode fetch guard applies to every request.
  const lateFetch: typeof globalThis.fetch = (input, init) => globalThis.fetch(input, init);
  const search =
    options.search ??
    createSearchService({
      venues: searchVenues,
      buyers: createBuyerSearch({
        config,
        version,
        fetch: lateFetch,
        fixtureStore,
      }),
      ebay: createEbaySearch({ config, fetch: lateFetch }),
      // Off without a key (no SDK client is built); the stand-in client in fixture mode.
      planner: createClaudePlanner({ config, fetch: lateFetch }),
    });
  // The app needs the bound port for its Host check, which is only known after listen (port 0).
  let app: RequestHandler | undefined;
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    if (app) app(req, res);
    else res.writeHead(503).end();
  });

  return new Promise((resolve, reject) => {
    const onListenError = (err: Error): void => reject(err);
    server.once('error', onListenError);
    server.listen(options.port, host, () => {
      server.off('error', onListenError);
      server.on('error', (err) => console.error(err.stack ?? err.message));
      const { port } = server.address() as AddressInfo;
      app = createApp({
        search,
        version,
        port,
        distDir: options.distDir ?? DIST_DIR,
        status: {
          redditAuth: hasRedditKeys(config),
          fixtures: config.fixtures,
          ebay: hasEbayKeys(config),
          claude: hasClaudeKey(config),
        },
        fixtures: fixtureStore,
      });
      resolve(server);
    });
  });
}
