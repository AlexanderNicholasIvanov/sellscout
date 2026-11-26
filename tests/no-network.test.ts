import { describe, expect, it } from 'vitest';

describe('unit-test network guard (AC27)', () => {
  it('rejects fetch to any non-loopback host', async () => {
    await expect(fetch('https://www.reddit.com/search.json')).rejects.toThrow(
      'Network access in unit tests is blocked: https://www.reddit.com/search.json',
    );
    await expect(fetch(new URL('https://oauth.reddit.com/'))).rejects.toThrow('blocked');
    await expect(fetch('https://api.ebay.com/identity/v1/oauth2/token')).rejects.toThrow(
      'Network access in unit tests is blocked: https://api.ebay.com/identity/v1/oauth2/token',
    );
  });
});
