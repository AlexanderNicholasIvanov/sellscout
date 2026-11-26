// Run 4 AC11: in fixture mode the real planner runs on the in-repo stand-in client (real request
// building, response reading and validation) with no outbound fetch. These are the "Fixture data
// agreement" values the e2e tests assert.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readConfig } from '../../server/config.ts';
import { catalog } from '../../server/data/catalog.ts';
import { createClaudePlanner } from '../../server/claude/index.ts';
import { createFixtureClient } from '../../server/claude/fixtures.ts';
import type { Planner } from '../../server/claude/types.ts';
import { createEbaySearch } from '../../server/ebay/index.ts';
import { createBuyerSearch } from '../../server/reddit/index.ts';
import { buyerTerm } from '../../server/reddit/term.ts';
import { createSearchService } from '../../server/search.ts';
import type { SearchFn } from '../../server/types.ts';
import { searchVenues } from '../../server/venues/index.ts';
import { compileCategories, matchCategories } from '../../server/venues/match.ts';

const original = globalThis.fetch;
let globalSpy: ReturnType<typeof vi.fn<typeof globalThis.fetch>>;

beforeEach(() => {
  // Any global fetch at all fails the test: fixture mode sends nothing.
  globalSpy = vi.fn<typeof globalThis.fetch>(() => Promise.reject(new Error('global fetch must not be called')));
  globalThis.fetch = globalSpy;
});
afterEach(() => {
  globalThis.fetch = original;
  vi.restoreAllMocks();
});

function fixturePlanner(): { planner: Planner; fetchSpy: ReturnType<typeof vi.fn<typeof globalThis.fetch>> } {
  const fetchSpy = vi.fn<typeof globalThis.fetch>(() => Promise.reject(new Error('options.fetch must not be called')));
  const planner = createClaudePlanner({ config: readConfig({ SELLSCOUT_FIXTURES: '1' }), fetch: fetchSpy });
  if (!planner) throw new Error('fixture mode must have a planner');
  return { planner, fetchSpy };
}

/** The whole search service as startServer builds it in fixture mode, with or without the planner. */
function fixtureService(withPlanner: boolean): SearchFn {
  const config = readConfig({ SELLSCOUT_FIXTURES: '1' });
  const fetch = vi.fn<typeof globalThis.fetch>(() => Promise.reject(new Error('options.fetch must not be called')));
  const planner = withPlanner ? createClaudePlanner({ config, fetch }) : undefined;
  return createSearchService({
    venues: searchVenues,
    buyers: createBuyerSearch({ config, version: '1.2.3', fetch }),
    ebay: createEbaySearch({ config, fetch }),
    ...(planner ? { planner } : {}),
  });
}

describe('the stand-in client (run 4 "Fixture mode")', () => {
  it('answers "mechanical keyboard" with the agreed raw picks', async () => {
    const client = createFixtureClient(catalog);
    const message = (await client.beta.messages.create({
      model: 'claude-opus-5-5',
      max_tokens: 8000,
      messages: [{ role: 'user', content: 'Used MECHANICAL Keyboard' }],
    })) as { stop_reason: string; content: { type: string; text: string }[] };
    expect(message.stop_reason).toBe('end_turn');
    expect(JSON.parse(message.content[0]?.text ?? '')).toEqual({
      categoryIds: ['keyboards', 'not-a-category'],
      searchTerm: 'mechanical keyboard',
      subreddits: ['MechanicalKeyboards', 'r/mechmarket', 'bad name!'],
    });
  });
});

describe('the fixture agreement through the real planner (run 4 AC11)', () => {
  it('"mechanical keyboard": categories [keyboards], term "mechanical keyboard", one AI subreddit', async () => {
    const { planner, fetchSpy } = fixturePlanner();
    expect(await planner('mechanical keyboard')).toEqual({
      ok: true,
      picks: { categoryIds: ['keyboards'], searchTerm: 'mechanical keyboard', subreddits: ['MechanicalKeyboards'] },
    });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(globalSpy).not.toHaveBeenCalled();
  });

  it.each(['desk', 'road bike', 'sony a7 iii camera body', 'asdfgh', 'zorblax widget'])(
    'any other item (%j): the catalog matches best first, buyerTerm(item), no subreddits',
    async (item) => {
      const { planner } = fixturePlanner();
      const matched = matchCategories(item, compileCategories(catalog.categories)).map((m) => m.category.id);
      expect(await planner(item)).toEqual({ ok: true, picks: { categoryIds: matched, searchTerm: buyerTerm(item), subreddits: [] } });
    },
  );

  it.each([
    ['claude-timeout', 'timed out'],
    ['claude-offline', "couldn't reach Anthropic"],
    ['claude-401', 'API key rejected'],
    ['claude-429', 'rate limited'],
    ['claude-500', 'Anthropic returned HTTP 500'],
    ['claude-refusal', 'declined'],
    ['claude-max-tokens', 'answer cut off'],
    ['claude-invalid', 'unusable answer'],
  ])('%s gives "%s" (also in upper case, inside other text)', async (term, reason) => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { planner, fetchSpy } = fixturePlanner();
    expect(await planner(term)).toEqual({ ok: false, reason });
    expect(await planner(`mechanical keyboard ${term.toUpperCase()} please`)).toEqual({ ok: false, reason });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(globalSpy).not.toHaveBeenCalled();
  });
});

describe('fixture-mode searches (run 4 AC11)', () => {
  // Fixture posts are dated relative to "now": freeze the clock (Date only, no timers) so two
  // searches compared with each other can't straddle a second boundary and differ in createdUtc.
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-26T12:00:00Z'));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('"mechanical keyboard": via Claude, the AI venue right after r/mechmarket, terms and fixture data unchanged', async () => {
    const input = { item: 'mechanical keyboard', delivery: 'both', window: 30 } as const;
    const off = await fixtureService(false)(input);
    const on = await fixtureService(true)(input);

    expect(on.plan).toEqual({ source: 'claude', categories: [{ id: 'keyboards', name: 'Mechanical keyboards' }], searchTerm: 'mechanical keyboard' });
    const ids = on.venues.map((v) => v.id);
    expect(ids[0]).toBe('r-mechmarket');
    expect(ids[1]).toBe('ai-r-mechanicalkeyboards');
    expect(on.venues[1]).toEqual({
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
    });
    expect(on.venues.filter((v) => v.aiSuggested)).toHaveLength(1);
    // Everything else is as with Claude off.
    expect(on.venues.filter((v) => !v.aiSuggested)).toEqual(off.venues);
    expect(on.buyers).toEqual(off.buyers);
    expect(on.buyers.term).toBe('mechanical keyboard');
    expect(on.buyers.posts.length).toBeGreaterThan(0);
    expect(on.buyers.posts.every((p) => p.id.startsWith('fx_mk'))).toBe(true);
    expect(on.ebay).toEqual(off.ebay);
    expect(on.ebay.listings.map((l) => l.id)).toEqual(['fx_eb1', 'fx_eb2', 'fx_eb3', 'fx_eb4', 'fx_eb5', 'fx_eb6']);
    expect(on.notices).toEqual(off.notices);
    expect(globalSpy).not.toHaveBeenCalled();
  });

  it.each(['desk', 'asdfgh', 'road bike', 'RTX 3080'])('%j: same venues, terms and notices as before, only source claude', async (item) => {
    const input = { item, delivery: 'both', window: 30 } as const;
    const off = await fixtureService(false)(input);
    const on = await fixtureService(true)(input);
    expect(on.plan).toEqual({ ...off.plan, source: 'claude' });
    expect(on.venues).toEqual(off.venues);
    expect(on.buyers).toEqual(off.buyers);
    expect(on.ebay).toEqual(off.ebay);
    expect(on.notices).toEqual(off.notices);
  });

  it('claude-refusal: the catalog result plus the notice', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const input = { item: 'claude-refusal', delivery: 'both', window: 30 } as const;
    const off = await fixtureService(false)(input);
    const on = await fixtureService(true)(input);
    expect(on.plan.source).toBe('catalog');
    expect(on).toEqual({ ...off, notices: ["Claude couldn't help with this search (declined); used the built-in catalog.", ...off.notices] });
  });
});
