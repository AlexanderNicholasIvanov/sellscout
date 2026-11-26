import type { SearchPlan, VenueKind } from '../server/types.ts';

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
  return `Understood as: ${names.length > 0 ? names.join(', ') : 'general item'} · via built-in catalog`;
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

/** The header chips for GET /api/status. */
export function statusChips(status: { redditAuth: boolean; fixtures: boolean }): string[] {
  const reddit = status.redditAuth ? 'Reddit: on' : status.fixtures ? 'Reddit: fixture' : 'Reddit: off (no keys)';
  return status.fixtures ? [reddit, 'Fixture data'] : [reddit];
}
