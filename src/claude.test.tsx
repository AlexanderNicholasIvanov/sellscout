// Run 4: the "via Claude" line, the Claude chip, the api guards for `source`, `aiSuggested`
// and `claude`, and the "AI suggested" badge on a venue row.
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SearchResult, Venue } from '../server/types.ts';
import { App } from './App.tsx';
import { isSearchResult, status } from './api.ts';
import { statusChips, understoodAs } from './format.ts';

const AI_VENUE: Venue = {
  id: 'ai-r-mechanicalkeyboards',
  name: 'r/MechanicalKeyboards',
  kind: 'subreddit',
  url: 'https://www.reddit.com/r/MechanicalKeyboards/',
  ships: true,
  local: true,
  tips: [],
  why: ['Suggested by Claude'],
  categoryIds: [],
  aiSuggested: true,
};

const CATALOG_VENUE: Venue = {
  id: 'r-mechmarket',
  name: 'r/mechmarket',
  kind: 'subreddit',
  url: 'https://www.reddit.com/r/mechmarket/',
  searchUrl: 'https://www.reddit.com/r/mechmarket/search/?q=mechanical%20keyboard&restrict_sr=1',
  ships: true,
  local: false,
  tips: [],
  why: ['mechanical keyboard'],
  categoryIds: ['keyboards'],
};

function result(venues: Venue[], source: 'claude' | 'catalog' = 'claude', notices: string[] = []): SearchResult {
  return {
    plan: { source, categories: [{ id: 'keyboards', name: 'Mechanical keyboards' }], searchTerm: 'mechanical keyboard' },
    venues,
    buyers: { status: 'disabled', term: 'mechanical keyboard', windowDays: 30, posts: [], links: [] },
    ebay: {
      status: 'disabled',
      term: 'mechanical keyboard',
      listings: [],
      searchUrl: 'https://www.ebay.com/sch/i.html?_nkw=mechanical%20keyboard',
    },
    notices,
  };
}

describe('format helpers: Claude', () => {
  it('ends the "Understood as" line with "via Claude" for a Claude plan', () => {
    expect(
      understoodAs({ source: 'claude', categories: [{ id: 'keyboards', name: 'Mechanical keyboards' }], searchTerm: 'x' }),
    ).toBe('Understood as: Mechanical keyboards · via Claude');
    expect(understoodAs({ source: 'claude', categories: [], searchTerm: 'x' })).toBe(
      'Understood as: general item · via Claude',
    );
    expect(understoodAs({ source: 'catalog', categories: [], searchTerm: 'x' })).toBe(
      'Understood as: general item · via built-in catalog',
    );
  });

  it('puts the Claude chip after eBay and before "Fixture data"', () => {
    expect(statusChips({ redditAuth: true, fixtures: false, ebay: true, claude: true })).toEqual([
      'Reddit: on',
      'eBay: on',
      'Claude: on',
    ]);
    expect(statusChips({ redditAuth: false, fixtures: false, ebay: false, claude: false })).toEqual([
      'Reddit: off (no keys)',
      'eBay: off (no keys)',
      'Claude: off (no key)',
    ]);
    expect(statusChips({ redditAuth: false, fixtures: true, ebay: false, claude: false })).toEqual([
      'Reddit: fixture',
      'eBay: fixture',
      'Claude: fixture',
      'Fixture data',
    ]);
    // A missing claude field reads as off.
    expect(statusChips({ redditAuth: false, fixtures: false, ebay: false })).toContain('Claude: off (no key)');
  });
});

describe('api guards: Claude', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('accepts both plan sources and rejects any other', () => {
    expect(isSearchResult(result([], 'claude'))).toBe(true);
    expect(isSearchResult(result([], 'catalog'))).toBe(true);
    const base = result([]);
    for (const source of ['Claude', 'ai', '', 1, null, undefined]) {
      expect(isSearchResult({ ...base, plan: { ...base.plan, source } })).toBe(false);
    }
  });

  it('accepts aiSuggested only as true or absent', () => {
    expect(isSearchResult(result([AI_VENUE, CATALOG_VENUE]))).toBe(true);
    for (const aiSuggested of [false, 'true', 1, null]) {
      expect(isSearchResult(result([{ ...AI_VENUE, aiSuggested } as unknown as Venue]))).toBe(false);
    }
    expect(isSearchResult(result([null as unknown as Venue]))).toBe(false);
  });

  it('reads the claude field of the status, a missing one as false', async () => {
    const base = { version: '0.1.0', redditAuth: false, fixtures: false, ebay: false };
    const respond = (body: unknown) =>
      vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(body), { status: 200 })));

    respond({ ...base, claude: true });
    await expect(status()).resolves.toEqual({ ...base, claude: true });
    respond({ ...base, claude: false });
    await expect(status()).resolves.toEqual({ ...base, claude: false });
    respond(base);
    await expect(status()).resolves.toEqual({ ...base, claude: false });
    for (const claude of ['true', 1, null]) {
      respond({ ...base, claude });
      await expect(status()).resolves.toBeNull();
    }
  });
});

describe('venue row: AI suggested badge', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    window.localStorage.clear();
  });

  async function searchWith(body: SearchResult) {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) =>
        url === '/api/status'
          ? new Response(JSON.stringify({ version: '0.1.0', redditAuth: false, fixtures: true, ebay: false, claude: false }))
          : new Response(JSON.stringify(body), { status: 200 }),
      ),
    );
    render(<App />);
    await userEvent.type(screen.getByLabelText('What are you selling?'), 'mechanical keyboard');
    await userEvent.click(screen.getByRole('button', { name: 'Search' }));
    await screen.findByRole('heading', { name: 'Where to post it' });
  }

  const row = (name: string) => screen.getByRole('heading', { level: 3, name }).closest('li') as HTMLElement;

  it('shows the badge as plain text and only the board link', async () => {
    await searchWith(result([CATALOG_VENUE, AI_VENUE]));

    expect(screen.getByText('Understood as: Mechanical keyboards · via Claude')).toBeInTheDocument();
    expect(await screen.findByText('Claude: fixture')).toBeInTheDocument();

    const ai = row('r/MechanicalKeyboards');
    const badge = within(ai).getByText('AI suggested');
    expect(badge.tagName).toBe('SPAN');
    expect(badge).toHaveClass('badge', 'badge-ai');
    expect(badge.closest('a, button')).toBeNull();
    expect(within(ai).getByText('Why: Suggested by Claude')).toBeInTheDocument();
    const links = within(ai).getAllByRole('link');
    expect(links).toHaveLength(1);
    expect(links[0]).toHaveTextContent('Open board');
    expect(links[0]).toHaveAttribute('href', 'https://www.reddit.com/r/MechanicalKeyboards/');
    expect(links[0]).toHaveAttribute('rel', 'noopener noreferrer');

    // A catalog venue has no badge and keeps its search link.
    const catalog = row('r/mechmarket');
    expect(within(catalog).queryByText('AI suggested')).toBeNull();
    expect(within(catalog).getAllByRole('link')).toHaveLength(2);
  });

  it('never shows a search link on an AI venue, and keeps safeHref on its board link', async () => {
    await searchWith(
      result([
        { ...AI_VENUE, searchUrl: 'https://www.reddit.com/r/MechanicalKeyboards/search/?q=x' },
        { ...AI_VENUE, id: 'ai-r-bad', name: 'r/BadLink', url: 'javascript:alert(1)' },
      ]),
    );
    expect(within(row('r/MechanicalKeyboards')).getAllByRole('link')).toHaveLength(1);
    const bad = row('r/BadLink');
    expect(within(bad).getByText('AI suggested')).toBeInTheDocument();
    expect(within(bad).queryAllByRole('link')).toHaveLength(0);
  });

  it('shows the Claude notice in the notices region', async () => {
    const notice = "Claude couldn't help with this search (rate limited); used the built-in catalog.";
    await searchWith(result([CATALOG_VENUE], 'catalog', [notice]));
    expect(screen.getByText('Understood as: Mechanical keyboards · via built-in catalog')).toBeInTheDocument();
    const region = document.querySelector('.notices[role="status"]') as HTMLElement;
    expect(within(region).getByText(notice)).toBeInTheDocument();
  });
});
