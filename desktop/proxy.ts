// Forwards a `sellscout://app/...` request from the window to the loopback server. No `electron`
// import, so vitest can test it against a real local server.
//
// It uses node:http rather than Electron's net.fetch: net.fetch runs the forwarded request through
// Chromium's CORS checks, so the UI's own `crossorigin` script and stylesheet failed
// (net::ERR_FAILED) and a request with an `Origin` header and a JSON body is preflighted with
// `Origin: null`. node:http sends the request as is, and the fixture-mode fetch guard (which
// replaces globalThis.fetch) doesn't touch it.
//
// Electron hands the handler no `Origin` header, so every request other than GET and HEAD gets
// `Origin: sellscout://app`, as a browser would send for a same-origin write. The body is read
// whole first: the UI's bodies are small and the server caps them at 10 KB anyway.
import { request as httpRequest } from 'node:http';
import type { IncomingHttpHeaders, OutgoingHttpHeaders } from 'node:http';
import { Readable } from 'node:stream';
import { APP_ORIGIN, toServerUrl } from './helpers.ts';

/** Never forwarded: node:http sets them itself (Host is 127.0.0.1:<port>, as the Host check expects). */
const DROP_REQUEST = new Set(['host', 'origin', 'connection', 'keep-alive', 'transfer-encoding', 'content-length', 'upgrade']);
const DROP_RESPONSE = new Set(['connection', 'keep-alive', 'transfer-encoding']);
/** Statuses whose Response must have no body. */
const NULL_BODY = new Set([204, 205, 304]);

function notFound(): Response {
  return new Response('Not found', { status: 404, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
}

function requestHeaders(headers: Headers): OutgoingHttpHeaders {
  const out: OutgoingHttpHeaders = {};
  headers.forEach((value, name) => {
    if (!DROP_REQUEST.has(name.toLowerCase())) out[name] = value;
  });
  return out;
}

function responseHeaders(headers: IncomingHttpHeaders): Headers {
  const out = new Headers();
  for (const [name, value] of Object.entries(headers)) {
    if (value === undefined || DROP_RESPONSE.has(name)) continue;
    for (const item of Array.isArray(value) ? value : [value]) out.append(name, item);
  }
  return out;
}

/**
 * Sends `request` to `http://127.0.0.1:<port>` with the same method, path, query, headers and
 * body, and returns the server's answer. A URL that isn't `sellscout://app/...` gets a 404; a
 * server that can't be reached gets a 502.
 */
export async function forwardToServer(request: Request, port: number): Promise<Response> {
  const target = toServerUrl(request.url, port);
  if (target === null) return notFound();
  const method = request.method.toUpperCase();
  const isRead = method === 'GET' || method === 'HEAD';
  const body = !isRead && request.body !== null ? await request.arrayBuffer() : null;

  return new Promise<Response>((resolve) => {
    const headers = requestHeaders(request.headers);
    if (!isRead) headers.origin = APP_ORIGIN;
    if (body !== null) headers['content-length'] = String(body.byteLength);
    const outgoing = httpRequest(target, { method, headers }, (res) => {
      // A Response can only carry 200-599.
      const status = res.statusCode !== undefined && res.statusCode >= 200 && res.statusCode <= 599 ? res.statusCode : 502;
      const noBody = method === 'HEAD' || NULL_BODY.has(status);
      if (noBody) res.resume();
      const stream = noBody ? null : (Readable.toWeb(res) as unknown as ReadableStream<Uint8Array>);
      resolve(new Response(stream, { status, statusText: res.statusMessage ?? '', headers: responseHeaders(res.headers) }));
    });
    outgoing.on('error', () => {
      resolve(new Response('sellscout server unavailable', { status: 502, headers: { 'Content-Type': 'text/plain; charset=utf-8' } }));
    });
    outgoing.end(body === null ? undefined : Buffer.from(body));
  });
}
