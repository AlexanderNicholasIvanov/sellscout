import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { isJsonContentType, parseSearchRequest } from '../../server/http/validate.ts';
import { json, listenApp, postSearch, rawRequest } from './helpers.ts';
import type { TestApp } from './helpers.ts';

let app: TestApp;
beforeAll(async () => {
  app = await listenApp();
});
afterAll(async () => {
  await app.close();
});

async function expect400(res: Awaited<ReturnType<typeof postSearch>>): Promise<string> {
  expect(res.status).toBe(400);
  const body = json(res) as { error: unknown };
  expect(typeof body.error).toBe('string');
  expect((body.error as string).length).toBeGreaterThan(0);
  return body.error as string;
}

describe('POST /api/search rejects bad input with 400 (AC6)', () => {
  it('invalid JSON', async () => {
    expect(await expect400(await postSearch(app.port, '{"item": "bike"'))).toBe('Body must be JSON');
  });

  it('wrong content type', async () => {
    const res = await rawRequest(app.port, {
      method: 'POST',
      path: '/api/search',
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify({ item: 'bike' }),
    });
    expect(await expect400(res)).toBe('Content-Type must be application/json');
  });

  it('missing content type', async () => {
    const res = await rawRequest(app.port, { method: 'POST', path: '/api/search', body: '{"item":"bike"}' });
    expect(await expect400(res)).toBe('Content-Type must be application/json');
  });

  it('a JSON body that is not an object', async () => {
    expect(await expect400(await postSearch(app.port, '["bike"]'))).toBe('Body must be a JSON object');
    await expect400(await postSearch(app.port, 'null'));
    await expect400(await postSearch(app.port, '"bike"'));
  });

  it('missing item', async () => {
    expect(await expect400(await postSearch(app.port, { location: 'Seattle' }))).toBe(
      "Describe what you're selling (item is required)",
    );
  });

  it('non-string item', async () => {
    expect(await expect400(await postSearch(app.port, { item: 42 }))).toBe('item must be a string');
  });

  it('blank item', async () => {
    expect(await expect400(await postSearch(app.port, { item: '   \t\n ' }))).toBe(
      "Describe what you're selling (item is required)",
    );
  });

  it('201-character item', async () => {
    expect(await expect400(await postSearch(app.port, { item: 'a'.repeat(201) }))).toBe(
      'item must be 200 characters or fewer',
    );
  });

  it('non-string location', async () => {
    expect(await expect400(await postSearch(app.port, { item: 'bike', location: 98101 }))).toBe(
      'location must be a string',
    );
  });

  it('101-character location', async () => {
    expect(await expect400(await postSearch(app.port, { item: 'bike', location: 'b'.repeat(101) }))).toBe(
      'location must be 100 characters or fewer',
    );
  });

  it('bad delivery', async () => {
    expect(await expect400(await postSearch(app.port, { item: 'bike', delivery: 'pigeon' }))).toBe(
      'delivery must be ship, local or both',
    );
    await expect400(await postSearch(app.port, { item: 'bike', delivery: null }));
  });

  it('never calls search for a rejected request', () => {
    expect(app.calls).toEqual([]);
  });
});

describe('POST /api/search accepts valid input (AC6)', () => {
  it('defaults a missing delivery to both', async () => {
    app.calls.length = 0;
    const res = await postSearch(app.port, { item: 'road bike' });
    expect(res.status).toBe(200);
    expect(app.calls).toEqual([{ item: 'road bike', delivery: 'both' }]);
  });

  it('accepts a 200-character item and a 100-character location', async () => {
    app.calls.length = 0;
    const item = 'a'.repeat(200);
    const location = 'b'.repeat(100);
    const res = await postSearch(app.port, { item, location, delivery: 'ship' });
    expect(res.status).toBe(200);
    expect(app.calls).toEqual([{ item, location, delivery: 'ship' }]);
  });

  it('treats a blank location as no location', async () => {
    app.calls.length = 0;
    const res = await postSearch(app.port, { item: 'bike', location: '   ' });
    expect(res.status).toBe(200);
    expect(app.calls).toEqual([{ item: 'bike', delivery: 'both' }]);
  });

  it('allows a charset=utf-8 suffix on the content type', async () => {
    const res = await postSearch(app.port, { item: 'bike' }, { 'Content-Type': 'application/json; charset=utf-8' });
    expect(res.status).toBe(200);
  });
});

describe('POST /api/search body size', () => {
  it('answers a body over 10 KB with 413', async () => {
    const res = await postSearch(app.port, { item: 'bike', padding: 'x'.repeat(10 * 1024) });
    expect(res.status).toBe(413);
    expect(json(res)).toEqual({ error: 'Request too large' });
  });

  it('answers a chunked body over 10 KB with 413', async () => {
    const res = await rawRequest(app.port, {
      method: 'POST',
      path: '/api/search',
      headers: { 'Content-Type': 'application/json', 'Transfer-Encoding': 'chunked' },
      body: JSON.stringify({ item: 'bike', padding: 'x'.repeat(20 * 1024) }),
    });
    expect(res.status).toBe(413);
  });

  it('accepts a body just under 10 KB', async () => {
    const res = await postSearch(app.port, { item: 'bike', padding: 'x'.repeat(10 * 1024 - 100) });
    expect(res.status).toBe(200);
  });
});

describe('validation helpers', () => {
  it.each([
    ['application/json', true],
    ['application/json; charset=utf-8', true],
    ['Application/JSON; Charset=UTF-8', true],
    ['application/json; charset=latin1', false],
    ['application/jsonp', false],
    ['text/json', false],
    [undefined, false],
  ])('isJsonContentType(%s) is %s', (header, expected) => {
    expect(isJsonContentType(header)).toBe(expected);
  });

  it('trims item and location before passing them on', () => {
    expect(parseSearchRequest('{"item":"  bike  ","location":" Seattle "}')).toEqual({
      ok: true,
      value: { item: 'bike', location: 'Seattle', delivery: 'both' },
    });
  });
});
