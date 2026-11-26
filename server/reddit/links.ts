// Reddit search queries and the "look yourself" links (spec "Look-yourself links").
import type { BuyerContext, BuyerWindow, Delivery, FallbackLink } from '../types.ts';
import { encodeTerm } from '../venues/links.ts';

export const MAX_SUBREDDITS = 3;

const WINDOW_T: Record<BuyerWindow, 'week' | 'month' | 'year'> = { 7: 'week', 30: 'month', 90: 'year' };

/** Reddit's `t` parameter for a window: week / month / year. */
export function windowT(windowDays: BuyerWindow): 'week' | 'month' | 'year' {
  return WINDOW_T[windowDays];
}

/** The site-wide query: `(WTB OR ISO OR "looking for") <term>`. */
export function siteWideQuery(term: string): string {
  return `(WTB OR ISO OR "looking for") ${term}`;
}

/** The context subreddits that are safe in a URL path, max 3, in order. */
export function contextSubreddits(context: BuyerContext): string[] {
  return context.subreddits.filter((name) => /^[A-Za-z0-9_]{2,21}$/.test(name)).slice(0, MAX_SUBREDDITS);
}

const CRAIGSLIST_SUBDOMAIN = /^[a-z0-9-]+$/;

export function buyerLinks(term: string, windowDays: BuyerWindow, delivery: Delivery, context: BuyerContext): FallbackLink[] {
  const t = windowT(windowDays);
  const links: FallbackLink[] = [
    {
      label: 'Search Reddit for buyers',
      url: `https://www.reddit.com/search/?q=${encodeTerm(siteWideQuery(term))}&sort=new&t=${t}`,
    },
  ];
  for (const sub of contextSubreddits(context)) {
    links.push({
      label: `Search r/${sub}`,
      url: `https://www.reddit.com/r/${sub}/search/?q=${encodeTerm(term)}&restrict_sr=1&sort=new&t=${t}`,
    });
  }
  if (delivery !== 'ship') {
    const metro = context.craigslist;
    if (metro !== undefined && CRAIGSLIST_SUBDOMAIN.test(metro)) {
      links.push({
        label: "Craigslist 'wanted' posts",
        url: `https://${metro}.craigslist.org/search/waa?query=${encodeTerm(term)}`,
      });
    } else {
      links.push({ label: "Craigslist 'wanted' (pick your city)", url: 'https://www.craigslist.org/about/sites' });
    }
  }
  return links;
}

/** The term as sent to the API: brackets become spaces ("No brackets in queries"). */
function apiTerm(term: string): string {
  return term.replace(/[[\]]/g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * The API search URLs of one buyer search, at most 4: site-wide first, then one per context
 * subreddit. Only the term and the subreddit names go in; never anything from the location.
 */
export function searchUrls(term: string, windowDays: BuyerWindow, context: BuyerContext, base = 'https://oauth.reddit.com'): string[] {
  const common = { sort: 'new', t: windowT(windowDays), limit: '100', type: 'link', raw_json: '1' };
  const q = apiTerm(term);
  const urls = [`${base}/search?${new URLSearchParams({ q: siteWideQuery(q), ...common })}`];
  for (const sub of contextSubreddits(context)) {
    urls.push(`${base}/r/${sub}/search?${new URLSearchParams({ q, restrict_sr: '1', ...common })}`);
  }
  return urls;
}
