// Starts the sellscout HTTP server (API + built UI). No side effects on import, so the desktop
// app's bundle can import it without starting anything.
import { createServer } from 'node:http';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { readFileSync } from 'node:fs';
import { join, resolve as resolvePath } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from './app.ts';
import type { AppStatus, RequestHandler, SettingsController } from './app.ts';
import { createClaudePlanner } from './claude/index.ts';
import { hasClaudeKey, hasEbayKeys, hasRedditKeys, readConfig } from './config.ts';
import type { AppConfig } from './config.ts';
import { createEbaySearch } from './ebay/index.ts';
import { createFixtureStore } from './reddit/fixtures/store.ts';
import type { FixtureStore } from './reddit/fixtures/store.ts';
import { createBuyerSearch } from './reddit/index.ts';
import { createSearchService } from './search.ts';
import { applySettingsUpdate, mergedEnv, readOnlySettingsResponse, settingsResponse } from './settings/merge.ts';
import { readSettingsFile, writeSettingsFile } from './settings/store.ts';
import type { SettingValues } from './settings/store.ts';
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
  /** Injected search (tests): used as is for the server's lifetime, never rebuilt. */
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
  /** The fetch for every outbound request (tests). Default: late-bound globalThis.fetch. */
  fetch?: typeof globalThis.fetch;
}

/** What one config gives the server: rebuilt as a whole after each save. */
interface Runtime {
  config: AppConfig;
  search: SearchFn;
  status: AppStatus;
}

interface RuntimeDeps {
  version: string;
  fetch: typeof globalThis.fetch;
  fixtureStore: FixtureStore | undefined;
  /** An injected search stays fixed across rebuilds. */
  search: SearchFn | undefined;
}

/** The search service and status for a config. The Reddit, eBay and Claude clients are new objects. */
function buildRuntime(config: AppConfig, deps: RuntimeDeps): Runtime {
  const search =
    deps.search ??
    createSearchService({
      venues: searchVenues,
      buyers: createBuyerSearch({
        config,
        version: deps.version,
        fetch: deps.fetch,
        fixtureStore: deps.fixtureStore,
      }),
      ebay: createEbaySearch({ config, fetch: deps.fetch }),
      // Off without a key (no SDK client is built); the stand-in client in fixture mode.
      planner: createClaudePlanner({ config, fetch: deps.fetch }),
    });
  return {
    config,
    search,
    status: {
      redditAuth: hasRedditKeys(config),
      fixtures: config.fixtures,
      ebay: hasEbayKeys(config),
      claude: hasClaudeKey(config),
    },
  };
}

const errorCode = (err: unknown): string => {
  const code = (err as NodeJS.ErrnoException | undefined)?.code;
  return typeof code === 'string' && /^[A-Z0-9_]{1,40}$/.test(code) ? code : 'unknown error';
};

/** Starts listening; resolves once bound, rejects with the listen error (e.g. EADDRINUSE). */
export async function startServer(options: StartOptions): Promise<Server> {
  const host = options.host ?? HOST;
  const version = options.version ?? readVersion();
  const settingsOption = options.settings;
  const env = settingsOption ? { ...settingsOption.env } : {};
  const file = settingsOption?.file ? resolvePath(settingsOption.file) : null;
  let saved: SettingValues = file ? await readSettingsFile(file) : {};
  const config = settingsOption ? readConfig(mergedEnv(env, saved)) : (options.config ?? readConfig({}));
  // Fixture mode: one store shared by the buyer search and POST /api/__fixtures for the server's
  // lifetime (fixture mode comes from the environment, so a save never changes it). Off, or an
  // injected `search` that would never read it: no store, so that route 404s.
  const fixtureStore = config.fixtures && options.search === undefined ? createFixtureStore() : undefined;
  // Late-bound so the fixture-mode fetch guard applies to every request.
  const lateFetch: typeof globalThis.fetch = (input, init) => globalThis.fetch(input, init);
  const deps: RuntimeDeps = { version, fetch: options.fetch ?? lateFetch, fixtureStore, search: options.search };
  let runtime = buildRuntime(config, deps);

  let settings: SettingsController;
  if (!settingsOption) {
    settings = {
      get: () => readOnlySettingsResponse(runtime.config),
      update: async () => ({ ok: false, reason: 'read-only' }),
    };
  } else {
    const get = () => settingsResponse(env, saved, file);
    // Saves run one at a time, so two quick saves cannot lose each other's values.
    let queue: Promise<unknown> = Promise.resolve();
    const save: SettingsController['update'] = async (update) => {
      if (file === null) return { ok: false, reason: 'read-only' };
      // Re-read first: `npm start` and the desktop app share the file, so another process may
      // have saved since this one started. Unreadable here is {} silently (logged at start).
      const current = await readSettingsFile(file, { log: () => {} });
      const next = applySettingsUpdate(current, update);
      try {
        await writeSettingsFile(file, next);
      } catch (err) {
        // The error code only: never the values or the path's content.
        console.error(`sellscout: couldn't save settings (${errorCode(err)})`);
        return { ok: false, reason: 'write-failed' };
      }
      saved = next;
      // A search already running keeps the runtime it started with; the next one gets this.
      runtime = buildRuntime(readConfig(mergedEnv(env, saved)), deps);
      return { ok: true, settings: get() };
    };
    settings = {
      get,
      update: (update) => {
        const result = queue.then(() => save(update));
        queue = result.catch(() => {});
        return result;
      },
    };
  }

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
        // Each search uses the runtime current when it starts.
        search: (input) => runtime.search(input),
        version,
        port,
        distDir: options.distDir ?? DIST_DIR,
        status: () => runtime.status,
        fixtures: fixtureStore,
        settings,
      });
      resolve(server);
    });
  });
}
