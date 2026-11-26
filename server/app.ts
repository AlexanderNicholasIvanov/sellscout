import type { IncomingMessage, ServerResponse } from 'node:http';
import type { ErrorResponse, FixturesResponse, SearchFn, StatusResponse } from './types.ts';
import type { FixtureStore } from './reddit/fixtures/store.ts';
import { ClientAbortError, readBody } from './http/body.ts';
import { parseFixtureRequest } from './http/fixtures.ts';
import { isAllowedHost } from './http/host.ts';
import { sendJson, setSecurityHeaders } from './http/respond.ts';
import { serveStatic } from './http/static.ts';
import { isJsonContentType, parseSearchRequest } from './http/validate.ts';

export const BODY_LIMIT = 10 * 1024;

export interface AppOptions {
  search: SearchFn;
  version: string;
  /** The port the server listens on; the Host header must name it. */
  port: number;
  distDir: string;
  /** What GET /api/status reports. Default: Reddit off, fixtures off. */
  status?: { redditAuth: boolean; fixtures: boolean };
  /** Fixture mode only: enables POST /api/__fixtures on this store. Unset: that path is a 404. */
  fixtures?: FixtureStore;
}

export type RequestHandler = (req: IncomingMessage, res: ServerResponse) => void;

const error = (message: string): ErrorResponse => ({ error: message });

function methodNotAllowed(res: ServerResponse, allow: string): void {
  sendJson(res, 405, error('Method not allowed'), { Allow: allow });
}

/** Builds the request handler. It holds no global state, so tests can inject a fake `search`. */
export function createApp(opts: AppOptions): RequestHandler {
  /** The JSON-only POST steps: content type (400), body cap (413). Returns the text, or null once answered. */
  async function readJsonBody(req: IncomingMessage, res: ServerResponse): Promise<string | null> {
    if (!isJsonContentType(req.headers['content-type'])) {
      sendJson(res, 400, error('Content-Type must be application/json'));
      return null;
    }
    const body = await readBody(req, BODY_LIMIT);
    if (body.kind === 'too-large') {
      sendJson(res, 413, error('Request too large'), { Connection: 'close' });
      return null;
    }
    return body.body.toString('utf8');
  }

  async function handleSearch(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const text = await readJsonBody(req, res);
    if (text === null) return;
    const parsed = parseSearchRequest(text);
    if (!parsed.ok) {
      sendJson(res, 400, error(parsed.error));
      return;
    }
    sendJson(res, 200, await opts.search(parsed.value));
  }

  async function handleFixtures(req: IncomingMessage, res: ServerResponse, store: FixtureStore): Promise<void> {
    const text = await readJsonBody(req, res);
    if (text === null) return;
    const parsed = parseFixtureRequest(text);
    if (!parsed.ok) {
      sendJson(res, 400, error(parsed.error));
      return;
    }
    const posts = parsed.value.kind === 'reset' ? store.reset() : store.upsert(parsed.value.post);
    const response: FixturesResponse = { ok: true, posts };
    sendJson(res, 200, response);
  }

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (!isAllowedHost(req.headers.host, opts.port)) {
      sendJson(res, 403, error('Forbidden host'));
      return;
    }

    const url = req.url ?? '';
    const pathname = url.split(/[?#]/, 1)[0] ?? '';

    if (pathname === '/api' || pathname.startsWith('/api/')) {
      if (pathname === '/api/status') {
        if (req.method !== 'GET') return methodNotAllowed(res, 'GET');
        const status: StatusResponse = {
          version: opts.version,
          redditAuth: opts.status?.redditAuth === true,
          fixtures: opts.status?.fixtures === true,
        };
        sendJson(res, 200, status);
        return;
      }
      if (pathname === '/api/search') {
        if (req.method !== 'POST') return methodNotAllowed(res, 'POST');
        await handleSearch(req, res);
        return;
      }
      // Exists only in fixture mode; otherwise it falls through to the 404 below.
      if (pathname === '/api/__fixtures' && opts.fixtures) {
        if (req.method !== 'POST') return methodNotAllowed(res, 'POST');
        await handleFixtures(req, res, opts.fixtures);
        return;
      }
      sendJson(res, 404, error('Not found'));
      return;
    }

    if (!pathname.startsWith('/')) {
      sendJson(res, 404, error('Not found'));
      return;
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') return methodNotAllowed(res, 'GET, HEAD');
    await serveStatic(req, res, opts.distDir, pathname);
  }

  return (req, res) => {
    setSecurityHeaders(res);
    handle(req, res).catch((err: unknown) => {
      if (err instanceof ClientAbortError) return;
      // Log the stack only: never the request body.
      console.error(err instanceof Error ? (err.stack ?? err.message) : 'Non-error value thrown');
      if (!res.headersSent) sendJson(res, 500, error('Internal error'));
      else res.destroy();
    });
  };
}
