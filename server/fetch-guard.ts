// Fixture mode: no request may leave the machine. Replaces globalThis.fetch with a guard.

function describeUrl(input: unknown): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.href;
  if (typeof Request !== 'undefined' && input instanceof Request) return input.url;
  return String(input);
}

/** Makes every `fetch` reject. Returns a function that puts the original back (for tests). */
export function installFetchGuard(): () => void {
  const original = globalThis.fetch;
  const guard: typeof globalThis.fetch = (input) =>
    Promise.reject(new Error('Outbound request blocked in fixture mode: ' + describeUrl(input)));
  globalThis.fetch = guard;
  return () => {
    if (globalThis.fetch === guard) globalThis.fetch = original;
  };
}
