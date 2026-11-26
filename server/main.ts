// sellscout API + UI server: node:http only, loopback only.
import { createServer } from 'node:http';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createApp } from './app.ts';
import type { RequestHandler } from './app.ts';
import { createClaudePlanner } from './claude/index.ts';
import { hasClaudeKey, hasEbayKeys, hasRedditKeys, readConfig } from './config.ts';
import type { AppConfig } from './config.ts';
import { createEbaySearch } from './ebay/index.ts';
import { installFetchGuard } from './fetch-guard.ts';
import { createFixtureStore } from './reddit/fixtures/store.ts';
import { createBuyerSearch } from './reddit/index.ts';
import { createSearchService } from './search.ts';
import type { SearchFn } from './types.ts';
import { searchVenues } from './venues/index.ts';

// parsePort moved to config.ts; re-exported so existing imports keep working.
export { DEFAULT_PORT, parsePort } from './config.ts';
export const HOST = '127.0.0.1';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
export const DIST_DIR = join(repoRoot, 'dist');
export const DOTENV_PATH = join(repoRoot, '.env');

export const FIXTURE_MODE_MESSAGE = 'sellscout: fixture mode (canned Reddit data, outbound requests blocked)';

export function readVersion(): string {
  const pkg = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8')) as { version: string };
  return pkg.version;
}

export interface DotEnvDeps {
  /** The real environment, before any `.env` is loaded. */
  env: Record<string, string | undefined>;
  exists: (path: string) => boolean;
  load: (path: string) => void;
  path: string;
}

/**
 * Loads `.env` only when the file exists, fixture mode is off (`SELLSCOUT_FIXTURES` is not `1`)
 * and `NODE_ENV` is not `test`. Returns whether it loaded the file.
 */
export function loadDotEnv(deps: DotEnvDeps): boolean {
  if (deps.env.SELLSCOUT_FIXTURES === '1' || deps.env.NODE_ENV === 'test') return false;
  if (!deps.exists(deps.path)) return false;
  deps.load(deps.path);
  return true;
}

export interface PrepareDeps extends Omit<DotEnvDeps, 'env'> {
  /** The process environment; `.env` values are loaded into it. */
  env: Record<string, string | undefined>;
  installGuard: () => void;
  log: (message: string) => void;
}

/**
 * Start-up order that keeps fixture mode safe: read `SELLSCOUT_FIXTURES` from the real
 * environment, then maybe load `.env`, then read the config with fixture mode forced to the real
 * value (so `.env` cannot switch it on), then install the fetch guard in fixture mode.
 */
export function prepareConfig(deps: PrepareDeps): AppConfig {
  const fixtures = deps.env.SELLSCOUT_FIXTURES === '1';
  loadDotEnv(deps);
  const config = readConfig({ ...deps.env, SELLSCOUT_FIXTURES: fixtures ? '1' : '' });
  if (config.fixtures) {
    deps.installGuard();
    deps.log(FIXTURE_MODE_MESSAGE);
  }
  return config;
}

export interface StartOptions {
  /** 0 picks a free port (tests). */
  port: number;
  host?: string;
  search?: SearchFn;
  version?: string;
  distDir?: string;
  /** Default: no Reddit keys, fixtures off. */
  config?: AppConfig;
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

async function main(): Promise<void> {
  // Fixture mode comes from the real environment only: setting it in .env has no effect.
  const config = prepareConfig({
    env: process.env,
    exists: existsSync,
    load: (path) => process.loadEnvFile(path),
    path: DOTENV_PATH,
    installGuard: () => {
      installFetchGuard();
    },
    log: (message) => console.log(message),
  });
  const { port } = config;
  if (port === null) {
    console.error('PORT must be a number between 1 and 65535');
    process.exitCode = 1;
    return;
  }
  try {
    const server = await startServer({ port, config });
    const { port: bound } = server.address() as AddressInfo;
    console.log(`sellscout running at http://${HOST}:${bound}`);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'EADDRINUSE') {
      console.error(`Port ${port} is in use; set PORT to another port`);
      process.exitCode = 1;
      return;
    }
    throw err;
  }
}

function isEntryPoint(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return pathToFileURL(realpathSync(entry)).href === import.meta.url;
  } catch {
    return false;
  }
}

if (isEntryPoint()) {
  main().catch((err: unknown) => {
    console.error(err instanceof Error ? (err.stack ?? err.message) : 'Server failed to start');
    process.exitCode = 1;
  });
}
