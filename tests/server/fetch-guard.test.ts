import { afterEach, describe, expect, it } from 'vitest';
import { installFetchGuard } from '../../server/fetch-guard.ts';

const original = globalThis.fetch;
let restore: (() => void) | undefined;
afterEach(() => {
  restore?.();
  restore = undefined;
  globalThis.fetch = original;
});

describe('installFetchGuard (AC16)', () => {
  it('makes fetch reject with the guard message for any URL', async () => {
    restore = installFetchGuard();
    await expect(fetch('https://www.reddit.com/x')).rejects.toThrow(
      'Outbound request blocked in fixture mode: https://www.reddit.com/x',
    );
    await expect(fetch(new URL('https://oauth.reddit.com/search?q=a'))).rejects.toThrow(
      'Outbound request blocked in fixture mode: https://oauth.reddit.com/search?q=a',
    );
    await expect(fetch(new Request('https://www.ebay.com/'))).rejects.toThrow(
      'Outbound request blocked in fixture mode: https://www.ebay.com/',
    );
    await expect(globalThis.fetch('http://127.0.0.1:1/', { method: 'POST' })).rejects.toBeInstanceOf(Error);
  });

  it('returns a rejected promise rather than throwing synchronously', () => {
    restore = installFetchGuard();
    let result: Promise<Response> | undefined;
    expect(() => {
      result = fetch('https://www.reddit.com/x');
    }).not.toThrow();
    expect(result).toBeInstanceOf(Promise);
    return expect(result).rejects.toThrow('Outbound request blocked in fixture mode');
  });

  it('restores the original fetch', () => {
    const undo = installFetchGuard();
    expect(globalThis.fetch).not.toBe(original);
    undo();
    expect(globalThis.fetch).toBe(original);
  });
});
