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
