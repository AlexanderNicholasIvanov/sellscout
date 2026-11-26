import type { IncomingMessage, ServerResponse } from 'node:http';
import type { ErrorResponse, SearchFn, StatusResponse } from './types.ts';
import { ClientAbortError, readBody } from './http/body.ts';
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
}

export type RequestHandler = (req: IncomingMessage, res: ServerResponse) => void;

const error = (message: string): ErrorResponse => ({ error: message });

function methodNotAllowed(res: ServerResponse, allow: string): void {
  sendJson(res, 405, error('Method not allowed'), { Allow: allow });
}

/** Builds the request handler. It holds no global state, so tests can inject a fake `search`. */
export function createApp(opts: AppOptions): RequestHandler {
  async function handleSearch(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (!isJsonContentType(req.headers['content-type'])) {
      sendJson(res, 400, error('Content-Type must be application/json'));
      return;
    }
    const body = await readBody(req, BODY_LIMIT);
    if (body.kind === 'too-large') {
      sendJson(res, 413, error('Request too large'), { Connection: 'close' });
      return;
    }
    const parsed = parseSearchRequest(body.body.toString('utf8'));
    if (!parsed.ok) {
      sendJson(res, 400, error(parsed.error));
      return;
    }
    sendJson(res, 200, opts.search(parsed.value));
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
        const status: StatusResponse = { version: opts.version };
        sendJson(res, 200, status);
        return;
      }
      if (pathname === '/api/search') {
        if (req.method !== 'POST') return methodNotAllowed(res, 'POST');
        await handleSearch(req, res);
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
