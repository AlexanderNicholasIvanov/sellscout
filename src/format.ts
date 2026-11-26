import type { PriceRange, SearchPlan, VenueKind } from '../server/types.ts';

const KIND_LABELS: Record<VenueKind, string> = {
  marketplace: 'marketplace',
  subreddit: 'subreddit',
  forum: 'forum',
  facebook: 'facebook',
  'local-classifieds': 'local classifieds',
};

export function kindLabel(kind: VenueKind): string {
  return KIND_LABELS[kind] ?? String(kind);
}

export function understoodAs(plan: SearchPlan): string {
  const names = plan.categories.map((c) => c.name).filter((n) => n !== '');
  const via = plan.source === 'claude' ? 'Claude' : 'built-in catalog';
  return `Understood as: ${names.length > 0 ? names.join(', ') : 'general item'} · via ${via}`;
}

export function whyText(why: string[]): string {
  return `Why: ${why.join(', ')}`;
}

/** Returns the URL when it is an absolute http(s) URL, else null (blocks javascript: and friends). */
export function safeHref(url: string | undefined): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? url : null;
  } catch {
    return null;
  }
}

export function searchLinkText(searchTerm: string): string {
  return `Search for '${searchTerm}' there`;
}

/** "1 point" / "3 points": the count and the noun, pluralised with a trailing "s". */
export function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

/** How long ago a Reddit post was made; a future time counts as "just now". */
export function ageText(createdUtcSeconds: number, nowMs: number): string {
  const elapsed = nowMs - createdUtcSeconds * 1000;
  if (!(elapsed >= MINUTE_MS)) return 'just now';
  if (elapsed < HOUR_MS) return `${plural(Math.floor(elapsed / MINUTE_MS), 'minute')} ago`;
  if (elapsed < DAY_MS) return `${plural(Math.floor(elapsed / HOUR_MS), 'hour')} ago`;
  return `${plural(Math.floor(elapsed / DAY_MS), 'day')} ago`;
}

export function postMetaText(subreddit: string, author: string, createdUtcSeconds: number, nowMs: number): string {
  return `r/${subreddit} · u/${author} · ${ageText(createdUtcSeconds, nowMs)}`;
}

export function postStatsText(score: number, numComments: number): string {
  return `${plural(score, 'point')} · ${plural(numComments, 'comment')}`;
}

export function buyersSearchedText(term: string, windowDays: number): string {
  return `Searched Reddit for "${term}" (last ${windowDays} days)`;
}

const USD = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });

/** A US-dollar amount: 1234.56 -> "$1,234.56". */
export function money(value: number): string {
  return USD.format(value);
}

export function ebaySearchedText(term: string): string {
  return `Searched eBay for "${term}" (fixed-price listings in US dollars)`;
}

/** The asking-price range line of the eBay section. */
export function priceRangeText(range: PriceRange): string {
  return `Asking prices of ${range.count} active listings (not sold prices): ${money(range.p25)} to ${money(range.p75)}, median ${money(range.median)}`;
}

export function ebayNoListingsText(term: string): string {
  return `No fixed-price eBay listings found for "${term}".`;
}

/** The header chips for GET /api/status: Reddit, then eBay, then Claude, then "Fixture data". */
export function statusChips(status: { redditAuth: boolean; fixtures: boolean; ebay: boolean; claude?: boolean }): string[] {
  const reddit = status.redditAuth ? 'Reddit: on' : status.fixtures ? 'Reddit: fixture' : 'Reddit: off (no keys)';
  const ebay = status.ebay ? 'eBay: on' : status.fixtures ? 'eBay: fixture' : 'eBay: off (no keys)';
  const claude = status.claude === true ? 'Claude: on' : status.fixtures ? 'Claude: fixture' : 'Claude: off (no key)';
  return status.fixtures ? [reddit, ebay, claude, 'Fixture data'] : [reddit, ebay, claude];
}
