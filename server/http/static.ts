import type { IncomingMessage, ServerResponse } from 'node:http';
import { readFile, realpath, stat } from 'node:fs/promises';
import { extname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { sendText } from './respond.ts';

export const CONTENT_TYPES: Readonly<Record<string, string>> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json; charset=utf-8',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
};

export const UI_NOT_BUILT = 'UI not built; run npm run build';

/** True when `target` is `root` itself or somewhere below it. */
export function isInside(root: string, target: string): boolean {
  const rel = relative(root, target);
  return rel === '' || (rel !== '..' && !rel.startsWith('..' + sep) && !isAbsolute(rel));
}

async function statOrNull(path: string) {
  try {
    return await stat(path);
  } catch {
    return null;
  }
}

async function sendFile(req: IncomingMessage, res: ServerResponse, file: string): Promise<void> {
  const data = await readFile(file);
  const type = CONTENT_TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream';
  res.writeHead(200, {
    'Content-Type': type,
    'Content-Length': data.length,
    // The shell must be revalidated so a rebuild is picked up; hashed assets may be cached normally.
    ...(type.startsWith('text/html') ? { 'Cache-Control': 'no-cache' } : {}),
  });
  res.end(req.method === 'HEAD' ? undefined : data);
}

/**
 * Serves GET/HEAD for non-API paths from `distDir`. A path that resolves outside `distDir`
 * (including through a symlink) is a 404; an unknown extension-less path gets `index.html`.
 */
export async function serveStatic(req: IncomingMessage, res: ServerResponse, distDir: string, pathname: string): Promise<void> {
  const root = resolve(distDir);
  const rootStat = await statOrNull(root);
  if (!rootStat?.isDirectory()) {
    sendText(res, 503, UI_NOT_BUILT);
    return;
  }
  const realRoot = await realpath(root);

  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    sendText(res, 404, 'Not found');
    return;
  }
  if (decoded.includes('\0')) {
    sendText(res, 404, 'Not found');
    return;
  }

  const target = resolve(root, '.' + decoded);
  if (!isInside(root, target)) {
    sendText(res, 404, 'Not found');
    return;
  }

  const targetStat = await statOrNull(target);
  if (targetStat?.isFile()) {
    if (!isInside(realRoot, await realpath(target))) {
      sendText(res, 404, 'Not found');
      return;
    }
    await sendFile(req, res, target);
    return;
  }

  // SPA fallback: paths that do not look like files get the app shell.
  if (extname(decoded) !== '') {
    sendText(res, 404, 'Not found');
    return;
  }
  const index = join(root, 'index.html');
  const indexStat = await statOrNull(index);
  if (!indexStat?.isFile()) {
    sendText(res, 503, UI_NOT_BUILT);
    return;
  }
  await sendFile(req, res, index);
}
