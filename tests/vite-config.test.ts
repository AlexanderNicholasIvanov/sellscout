import { describe, expect, it } from 'vitest';
import { isDevPageOrigin } from '../vite.config.ts';

describe('the dev proxy origin rewrite (npm run dev)', () => {
  it('rewrites only the Vite page itself on loopback', () => {
    expect(isDevPageOrigin('http://localhost:5173', 'localhost:5173')).toBe(true);
    expect(isDevPageOrigin('http://127.0.0.1:5173', '127.0.0.1:5173')).toBe(true);
  });

  it('leaves other sites, rebinding hosts and missing headers alone', () => {
    expect(isDevPageOrigin('https://evil.example', 'localhost:5173')).toBe(false);
    expect(isDevPageOrigin('http://evil.example:5173', 'evil.example:5173')).toBe(false);
    expect(isDevPageOrigin('http://localhost:5174', 'localhost:5173')).toBe(false);
    expect(isDevPageOrigin(undefined, 'localhost:5173')).toBe(false);
    expect(isDevPageOrigin('http://localhost:5173', undefined)).toBe(false);
  });
});
