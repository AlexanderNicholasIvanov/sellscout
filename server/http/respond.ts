import type { OutgoingHttpHeaders, ServerResponse } from 'node:http';

/** Headers sent on every response. No Access-Control-* header is ever set. */
export const SECURITY_HEADERS: Readonly<Record<string, string>> = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'X-Frame-Options': 'DENY',
};

export function setSecurityHeaders(res: ServerResponse): void {
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) res.setHeader(name, value);
}

export function sendJson(res: ServerResponse, status: number, body: unknown, extra: OutgoingHttpHeaders = {}): void {
  const payload = Buffer.from(JSON.stringify(body), 'utf8');
  res.writeHead(status, {
    ...extra,
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Length': payload.length,
  });
  res.end(payload);
}

export function sendText(res: ServerResponse, status: number, text: string, extra: OutgoingHttpHeaders = {}): void {
  const payload = Buffer.from(text, 'utf8');
  res.writeHead(status, {
    ...extra,
    'Content-Type': 'text/plain; charset=utf-8',
    'Content-Length': payload.length,
  });
  res.end(payload);
}
