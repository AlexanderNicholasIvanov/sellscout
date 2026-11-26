// AC12 + AC13: classification and snippets.
import { describe, expect, it } from 'vitest';
import { buyerPosts, isBuyerPost, itemAppears, MAX_POSTS } from '../../server/reddit/classify.ts';
import { snippet } from '../../server/reddit/snippet.ts';
import { child } from './helpers.ts';

const NOW = Date.UTC(2026, 10, 25, 12);
const nowS = NOW / 1000;

describe('isBuyerPost (AC12)', () => {
  it.each([
    ['[USA-CA] [H] PayPal [W] RTX 3080', '', 'RTX 3080', true],
    ['[USA-CA] [W] RTX 3080 [H] PayPal', '', 'RTX 3080', true],
    ['[usa-ca] [h] paypal [w] rtx 3080', '', 'RTX 3080', true],
    ['[USA-CA] [H] RTX 3080 [W] PayPal', '', 'RTX 3080', false],
    ['[USA-CA] [H] RTX 3080 [W] RTX 3090 or 3080 Ti', '', 'RTX 3080', false],
    ['[USA-CA] [H] PayPal [W] Steam Deck', 'WTB RTX 3080 too', 'RTX 3080', false],
    ['WTB Sony A7 III', '', 'Sony A7 III', true],
    ['ISO: a7iii', '', 'Sony A7 III', true],
    ['Looking for a 3080', '', 'RTX 3080', true],
    ['Shot at ISO 6400 with my Sony A7 III', '', 'Sony A7 III', false],
    ['Shot at ISO6400 with my Sony A7 III', '', 'Sony A7 III', false],
    ['iso: a7iii', '', 'Sony A7 III', false],
    ['WTS RTX 3080', '', 'RTX 3080', false],
    ['WTS RTX 3080, looking for offers', '', 'RTX 3080', false],
    ['FS: RTX 3080, wanted gone', '', 'RTX 3080', false],
    ['[FS] RTX 3080 wanted gone', '', 'RTX 3080', false],
    ['For sale: RTX 3080 looking for a home', '', 'RTX 3080', false],
    ['Selling RTX 3080, looking for offers', '', 'RTX 3080', false],
    ['Anyone want to buy a used RTX 3080?', '', 'RTX 3080', true],
    ['Wanted: RTX 3080', '', 'RTX 3080', true],
    ['In search of an RTX 3080', '', 'RTX 3080', true],
    ['Help with my build', 'Looking for an RTX 3080 under $400', 'RTX 3080', true],
    ['WTB something else', 'Nothing relevant here', 'RTX 3080', false],
    ['Looking for a Pokémon card', '', 'Pokemon card', true],
    ['WTBX RTX 3080', '', 'RTX 3080', false],
  ])('%j / %j (term %j) -> %s', (title, body, term, expected) => {
    expect(isBuyerPost(term, title, body)).toBe(expected);
  });

  it('needs max(1, ceil(n/2)) significant tokens: 2 of 3', () => {
    expect(itemAppears('Sony A7 III', 'sony camera')).toBe(false);
    expect(itemAppears('Sony A7 III', 'sony a7')).toBe(true);
    expect(itemAppears('Sony A7 III', 'a7iii')).toBe(true);
    expect(itemAppears('RTX 3080', '3080')).toBe(true);
  });
});

describe('buyerPosts (AC12, AC13)', () => {
  const term = 'RTX 3080';

  it('maps a buyer post to its fields, url and snippet', () => {
    const posts = buyerPosts(
      [
        child({
          id: 'p1',
          title: 'WTB RTX 3080',
          selftext: 'Looking for a **hot-swap** board. See [my wishlist](https://example.com/list).',
          subreddit: 'hardwareswap',
          author: 'buyer1',
          created_utc: nowS - 60,
          score: 12,
          num_comments: 3,
          permalink: '/r/hardwareswap/comments/p1/wtb_rtx_3080/',
        }),
      ],
      term,
      30,
      NOW,
    );
    expect(posts).toEqual([
      {
        id: 'p1',
        title: 'WTB RTX 3080',
        subreddit: 'hardwareswap',
        author: 'buyer1',
        createdUtc: nowS - 60,
        score: 12,
        numComments: 3,
        snippet: 'Looking for a hot-swap board. See my wishlist.',
        url: 'https://www.reddit.com/r/hardwareswap/comments/p1/wtb_rtx_3080/',
      },
    ]);
  });

  it('drops NSFW, stickied, [deleted], non-/r/ permalink, out-of-window and duplicate posts', () => {
    const ids = buyerPosts(
      [
        child({ id: 'keep', title: 'WTB RTX 3080', created_utc: nowS - 100 }),
        child({ id: 'nsfw', title: 'WTB RTX 3080', over_18: true }),
        child({ id: 'sticky', title: 'WTB RTX 3080', stickied: true }),
        child({ id: 'deleted', title: 'WTB RTX 3080', author: '[deleted]' }),
        child({ id: 'user', title: 'WTB RTX 3080', permalink: '/user/x/comments/user/' }),
        child({ id: 'old', title: 'WTB RTX 3080', created_utc: nowS - 8 * 86_400 }),
        child({ id: 'edge', title: 'WTB RTX 3080', created_utc: nowS - 7 * 86_400 }),
        child({ id: 'keep', title: 'WTB RTX 3080 (duplicate)', created_utc: nowS - 50 }),
        { kind: 't3', data: { id: 'broken' } },
        null,
        'junk',
      ],
      term,
      7,
      NOW,
    ).map((post) => post.id);
    expect(ids).toEqual(['keep', 'edge']);
  });

  it('honours the window: 30 and 90 days', () => {
    const children = [
      child({ id: 'd20', title: 'WTB RTX 3080', created_utc: nowS - 20 * 86_400 }),
      child({ id: 'd40', title: 'WTB RTX 3080', created_utc: nowS - 40 * 86_400 }),
      child({ id: 'd100', title: 'WTB RTX 3080', created_utc: nowS - 100 * 86_400 }),
    ];
    expect(buyerPosts(children, term, 30, NOW).map((p) => p.id)).toEqual(['d20']);
    expect(buyerPosts(children, term, 90, NOW).map((p) => p.id)).toEqual(['d20', 'd40']);
  });

  it('sorts newest first and keeps at most 50', () => {
    const children = Array.from({ length: 60 }, (_, i) =>
      child({ id: `p${i}`, title: 'WTB RTX 3080', created_utc: nowS - (60 - i) * 60 }),
    );
    const posts = buyerPosts(children, term, 7, NOW);
    expect(posts).toHaveLength(MAX_POSTS);
    expect(posts[0]?.id).toBe('p59');
    expect(posts.at(-1)?.id).toBe('p10');
    for (let i = 1; i < posts.length; i++) expect(posts[i - 1]!.createdUtc).toBeGreaterThanOrEqual(posts[i]!.createdUtc);
  });

  it('excludes the seller and keeps the buyer of a trade pair', () => {
    const ids = buyerPosts(
      [
        child({ id: 'buyer', title: '[USA-CA] [H] PayPal [W] RTX 3080' }),
        child({ id: 'seller', title: '[USA-CA] [H] RTX 3080 [W] PayPal' }),
      ],
      term,
      30,
      NOW,
    ).map((p) => p.id);
    expect(ids).toEqual(['buyer']);
  });
});

describe('snippet (AC13)', () => {
  it('reduces markdown links to their text', () => {
    expect(snippet('See [my list](https://example.com/a) and [two](http://b.example)')).toBe('See my list and two');
  });

  it('removes * _ # > ` ~ and collapses whitespace', () => {
    expect(snippet('# Title\n\n> quoted **bold** _it_ `code` ~~gone~~\n\n  end')).toBe('Title quoted bold it code gone end');
  });

  it('keeps at most 200 characters', () => {
    expect(snippet('x'.repeat(500))).toHaveLength(200);
    expect(snippet(`${'y'.repeat(199)}😀`).length).toBeLessThanOrEqual(200);
  });

  it('is "" with no body', () => {
    expect(snippet('')).toBe('');
    expect(snippet(undefined)).toBe('');
    expect(snippet('  \n ')).toBe('');
  });
});
