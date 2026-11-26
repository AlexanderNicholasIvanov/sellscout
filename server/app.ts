import type { IncomingMessage, ServerResponse } from 'node:http';
import type { ErrorResponse, FixturesResponse, SearchFn, SettingsResponse, SettingsUpdate, StatusResponse } from './types.ts';
import type { FixtureStore } from './reddit/fixtures/store.ts';
import { ClientAbortError, readBody } from './http/body.ts';
import { parseFixtureRequest } from './http/fixtures.ts';
import { isAllowedHost } from './http/host.ts';
import { isAllowedOrigin } from './http/origin.ts';
import { parseSettingsUpdate, SETTINGS_ERRORS } from './http/settings.ts';
import { sendJson, setSecurityHeaders } from './http/respond.ts';
import { serveStatic } from './http/static.ts';
import { isJsonContentType, parseSearchRequest } from './http/validate.ts';

export const BODY_LIMIT = 10 * 1024;

export interface AppStatus { redditAuth: boolean; fixtures: boolean; ebay?: boolean; claude?: boolean }

/** The outcome of a PUT /api/settings that passed validation. */
export type SettingsSaveResult =
  | { ok: true; settings: SettingsResponse }
  | { ok: false; reason: 'read-only' | 'write-failed' };

/** What /api/settings needs from the server (start.ts builds it). */
export interface SettingsController {
  get(): SettingsResponse;
  /** Writes the merged values and reloads the config; never rejects. */
  update(values: SettingsUpdate['values']): Promise<SettingsSaveResult>;
}

export interface AppOptions {
  search: SearchFn;
  version: string;
  /** The port the server listens on; the Host header must name it. */
  port: number;
  distDir: string;
  /** What GET /api/status reports, or a getter read on every request. Default: Reddit off, fixtures off. */
  status?: AppStatus | (() => AppStatus);
  /** Fixture mode only: enables POST /api/__fixtures on this store. Unset: that path is a 404. */
  fixtures?: FixtureStore;
  /** Enables GET / PUT /api/settings. Unset: that path is a 404. */
  settings?: SettingsController;
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

  async function handleSettingsPut(req: IncomingMessage, res: ServerResponse, settings: SettingsController): Promise<void> {
    // Before the body is read: a foreign page must not get as far as the content-type check.
    if (!isAllowedOrigin(req.headers.origin, opts.port)) {
      sendJson(res, 403, error(SETTINGS_ERRORS.forbiddenOrigin));
      return;
    }
    if (!settings.get().editable) {
      sendJson(res, 409, error(SETTINGS_ERRORS.readOnly));
      return;
    }
    const text = await readJsonBody(req, res);
    if (text === null) return;
    const parsed = parseSettingsUpdate(text);
    if (!parsed.ok) {
      sendJson(res, 400, error(parsed.error));
      return;
    }
    const result = await settings.update(parsed.value);
    if (result.ok) sendJson(res, 200, result.settings);
    else if (result.reason === 'read-only') sendJson(res, 409, error(SETTINGS_ERRORS.readOnly));
    else sendJson(res, 500, error(SETTINGS_ERRORS.saveFailed));
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
        const current = typeof opts.status === 'function' ? opts.status() : opts.status;
        const status: StatusResponse = {
          version: opts.version,
          redditAuth: current?.redditAuth === true,
          fixtures: current?.fixtures === true,
          ebay: current?.ebay === true,
          claude: current?.claude === true,
        };
        sendJson(res, 200, status);
        return;
      }
      if (pathname === '/api/search') {
        if (req.method !== 'POST') return methodNotAllowed(res, 'POST');
        await handleSearch(req, res);
        return;
      }
      if (pathname === '/api/settings' && opts.settings) {
        if (req.method === 'GET') {
          sendJson(res, 200, opts.settings.get());
          return;
        }
        if (req.method !== 'PUT') return methodNotAllowed(res, 'GET, PUT');
        await handleSettingsPut(req, res, opts.settings);
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
