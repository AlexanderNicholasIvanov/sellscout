// The one place server code reads configuration from the environment. Tests inject objects.

export const DEFAULT_PORT = 5180;

export interface RedditConfig { clientId: string; clientSecret: string; username: string } // trimmed, '' when unset
export interface EbayConfig { clientId: string; clientSecret: string } // trimmed, '' when unset
export interface AppConfig { port: number | null; fixtures: boolean; fixtureDelayMs: number; reddit: RedditConfig; ebay: EbayConfig }

/** `PORT` from the environment: unset or empty means 5180; anything but an integer 1-65535 is `null`. */
export function parsePort(value: string | undefined): number | null {
  if (value === undefined || value.trim() === '') return DEFAULT_PORT;
  if (!/^\d+$/.test(value.trim())) return null;
  const port = Number(value.trim());
  return port >= 1 && port <= 65535 ? port : null;
}

/** An integer >= 0 written only with digits; anything else, or unset, is 0. */
function parseDelay(value: string | undefined): number {
  if (value === undefined || !/^\d+$/.test(value)) return 0;
  const delay = Number(value);
  return Number.isSafeInteger(delay) ? delay : 0;
}

const trimmed = (value: string | undefined): string => (typeof value === 'string' ? value.trim() : '');

/** Fixture mode = env.SELLSCOUT_FIXTURES === '1' exactly; then every Reddit and eBay field is ''. */
export function readConfig(env: Record<string, string | undefined>): AppConfig {
  const fixtures = env.SELLSCOUT_FIXTURES === '1';
  return {
    port: parsePort(env.PORT),
    fixtures,
    fixtureDelayMs: parseDelay(env.SELLSCOUT_FIXTURE_DELAY_MS),
    reddit: fixtures
      ? { clientId: '', clientSecret: '', username: '' }
      : {
          clientId: trimmed(env.REDDIT_CLIENT_ID),
          clientSecret: trimmed(env.REDDIT_CLIENT_SECRET),
          username: trimmed(env.REDDIT_USERNAME),
        },
    ebay: fixtures
      ? { clientId: '', clientSecret: '' }
      : { clientId: trimmed(env.EBAY_CLIENT_ID), clientSecret: trimmed(env.EBAY_CLIENT_SECRET) },
  };
}

/** true only when fixtures is off and clientId and clientSecret are both non-empty. */
export function hasRedditKeys(config: AppConfig): boolean {
  return !config.fixtures && config.reddit.clientId !== '' && config.reddit.clientSecret !== '';
}

/** true only when fixtures is off and the eBay clientId and clientSecret are both non-empty. */
export function hasEbayKeys(config: AppConfig): boolean {
  return !config.fixtures && config.ebay.clientId !== '' && config.ebay.clientSecret !== '';
}
