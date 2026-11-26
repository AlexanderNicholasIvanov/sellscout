import type { IncomingMessage } from 'node:http';

/** Past this many bytes we stop draining the body and answer straight away (the connection is then closed). */
const DRAIN_CAP = 1024 * 1024;

export type BodyResult = { kind: 'ok'; body: Buffer } | { kind: 'too-large' };

/** The client went away before the body was complete; there is nobody to answer. */
export class ClientAbortError extends Error {
  constructor() {
    super('Client closed the request before the body was read');
    this.name = 'ClientAbortError';
  }
}

/**
 * Reads the request body, keeping at most `limit` bytes. A body over the limit is drained
 * (not kept) so the 413 answer reaches the client cleanly; a huge one is cut off early.
 */
export function readBody(req: IncomingMessage, limit: number): Promise<BodyResult> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (result: BodyResult): void => {
      if (!settled) {
        settled = true;
        resolve(result);
      }
    };
    const fail = (err: Error): void => {
      if (!settled) {
        settled = true;
        reject(err);
      }
    };

    const declared = Number(req.headers['content-length']);
    if (Number.isFinite(declared) && declared > DRAIN_CAP) {
      finish({ kind: 'too-large' });
      req.resume();
      return;
    }

    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > limit) {
        chunks.length = 0;
        if (size > DRAIN_CAP) finish({ kind: 'too-large' });
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => finish(size > limit ? { kind: 'too-large' } : { kind: 'ok', body: Buffer.concat(chunks) }));
    req.on('error', () => fail(new ClientAbortError()));
    req.on('close', () => fail(new ClientAbortError()));
  });
}
