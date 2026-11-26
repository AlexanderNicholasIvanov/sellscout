// sellscout API + UI server: node:http only, loopback only.
import { createServer } from 'node:http';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { readFileSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createApp } from './app.ts';
import type { RequestHandler } from './app.ts';
import type { SearchFn } from './types.ts';
import { searchVenues } from './venues/index.ts';

export const DEFAULT_PORT = 5180;
export const HOST = '127.0.0.1';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
export const DIST_DIR = join(repoRoot, 'dist');

export function readVersion(): string {
  const pkg = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8')) as { version: string };
  return pkg.version;
}

/** `PORT` from the environment: unset or empty means 5180; anything but an integer 1-65535 is `null`. */
export function parsePort(value: string | undefined): number | null {
  if (value === undefined || value.trim() === '') return DEFAULT_PORT;
  if (!/^\d+$/.test(value.trim())) return null;
  const port = Number(value.trim());
  return port >= 1 && port <= 65535 ? port : null;
}

export interface StartOptions {
  /** 0 picks a free port (tests). */
  port: number;
  host?: string;
  search?: SearchFn;
  version?: string;
  distDir?: string;
}

/** Starts listening; resolves once bound, rejects with the listen error (e.g. EADDRINUSE). */
export function startServer(options: StartOptions): Promise<Server> {
  const host = options.host ?? HOST;
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
        search: options.search ?? searchVenues,
        version: options.version ?? readVersion(),
        port,
        distDir: options.distDir ?? DIST_DIR,
      });
      resolve(server);
    });
  });
}

async function main(): Promise<void> {
  const port = parsePort(process.env.PORT);
  if (port === null) {
    console.error('PORT must be a number between 1 and 65535');
    process.exitCode = 1;
    return;
  }
  try {
    const server = await startServer({ port });
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
