// sellscout API + UI server: node:http only, loopback only. `node server/main.ts` starts it.
import { existsSync, realpathSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { readConfig } from './config.ts';
import type { AppConfig } from './config.ts';
import { installFetchGuard } from './fetch-guard.ts';
import { resolveSettingsFile } from './settings/path.ts';
import { HOST, startServer } from './start.ts';

// parsePort moved to config.ts; re-exported so existing imports keep working.
export { DEFAULT_PORT, parsePort } from './config.ts';
// startServer moved to start.ts; re-exported so existing imports keep working.
export { DIST_DIR, HOST, readVersion, startServer } from './start.ts';
export type { StartOptions } from './start.ts';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
export const DOTENV_PATH = join(repoRoot, '.env');

export const FIXTURE_MODE_MESSAGE = 'sellscout: fixture mode (canned Reddit data, outbound requests blocked)';

/** Printed at start when Settings can save keys (the file is not null). */
export const settingsFileMessage = (file: string): string => `sellscout: settings file ${file}`;

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
 * environment, then maybe load `.env`, then copy the environment with fixture mode forced to the
 * real value (so `.env` cannot switch it on), then install the fetch guard in fixture mode.
 * Returns that copy: what `readConfig` and the Settings screen read.
 */
export function prepareEnv(deps: PrepareDeps): Record<string, string | undefined> {
  const fixtures = deps.env.SELLSCOUT_FIXTURES === '1';
  loadDotEnv(deps);
  const env = { ...deps.env, SELLSCOUT_FIXTURES: fixtures ? '1' : '' };
  if (fixtures) {
    deps.installGuard();
    deps.log(FIXTURE_MODE_MESSAGE);
  }
  return env;
}

/** `prepareEnv`, then the config it gives. */
export function prepareConfig(deps: PrepareDeps): AppConfig {
  return readConfig(prepareEnv(deps));
}

/** The settings file `npm start` uses (absolute), or null when Settings is read-only. */
export function startSettingsFile(env: Record<string, string | undefined>): string | null {
  const file = resolveSettingsFile(env);
  return file === null ? null : resolve(file);
}

async function main(): Promise<void> {
  // Fixture mode comes from the real environment only: setting it in .env has no effect.
  const env = prepareEnv({
    env: process.env,
    exists: existsSync,
    load: (path) => process.loadEnvFile(path),
    path: DOTENV_PATH,
    installGuard: () => {
      installFetchGuard();
    },
    log: (message) => console.log(message),
  });
  const config = readConfig(env);
  const { port } = config;
  if (port === null) {
    console.error('PORT must be a number between 1 and 65535');
    process.exitCode = 1;
    return;
  }
  // After `.env`, so SELLSCOUT_SETTINGS_FILE works there too.
  const file = startSettingsFile(env);
  if (file !== null) console.log(settingsFileMessage(file));
  try {
    const server = await startServer({ port, config, settings: { file, env } });
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
