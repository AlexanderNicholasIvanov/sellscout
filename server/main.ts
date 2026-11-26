// Stub server: u3 replaces this with the real API server.
import { createServer } from 'node:http';
import type { ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ErrorResponse, StatusResponse } from './types.ts';

const root = fileURLToPath(new URL('..', import.meta.url));
const distDir = resolve(root, 'dist');
const { version } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { version: string };

const HOST = '127.0.0.1';
const port = Number(process.env.PORT) || 5180;

const contentTypes: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json; charset=utf-8',
};

function sendJson(res: ServerResponse, status: number, body: StatusResponse | ErrorResponse): void {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

const server = createServer((req, res) => {
  const pathname = new URL(req.url ?? '/', `http://${HOST}:${port}`).pathname;

  if (req.method !== 'GET') {
    sendJson(res, 405, { error: 'Method not allowed' });
    return;
  }
  if (pathname === '/api/status') {
    sendJson(res, 200, { version });
    return;
  }
  if (pathname.startsWith('/api/')) {
    sendJson(res, 404, { error: 'Not found' });
    return;
  }

  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    res.writeHead(400).end('Bad request');
    return;
  }
  const file = resolve(distDir, '.' + (decoded === '/' ? '/index.html' : decoded));
  if (!file.startsWith(distDir + sep)) {
    res.writeHead(404).end('Not found');
    return;
  }
  readFile(file).then(
    (data) => {
      res.writeHead(200, { 'Content-Type': contentTypes[extname(file)] ?? 'application/octet-stream' });
      res.end(data);
    },
    () => {
      res.writeHead(404).end('Not found');
    },
  );
});

server.on('error', (err: NodeJS.ErrnoException) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`Port ${port} is in use; set PORT to another port`);
    process.exit(1);
  }
  throw err;
});

server.listen(port, HOST, () => {
  console.log(`sellscout running at http://${HOST}:${port}`);
});
