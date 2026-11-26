import type { Catalog, Metro } from '../../server/types.ts';

// Small injected catalog for the exact ordering rules. Catalog order is deliberate:
// a general venue comes first, and the music venue comes before the keyboard venues.
export const fixtureCatalog: Catalog = {
  reviewed: '2026-11-25',
  categories: [
    { id: 'kb', name: 'Keyboards', keywords: ['keyboard', 'mechanical keyboard', 'keycap'] },
    { id: 'music', name: 'Music', keywords: ['synth', 'keyboard'] },
    { id: 'watches', name: 'Watches', keywords: ['watch'] },
    { id: 'photo', name: 'Photo', keywords: ['camera', 'lens'] },
  ],
  venues: [
    {
      id: 'ebay', name: 'eBay', kind: 'marketplace', url: 'https://www.ebay.com/',
      searchUrlTemplate: 'https://www.ebay.com/sch/i.html?_nkw={q}', ships: true, local: false,
      tips: ['tip'], categoryIds: [], general: true,
    },
    {
      id: 'music-sub', name: 'r/music', kind: 'subreddit', url: 'https://www.reddit.com/r/music/',
      searchUrlTemplate: 'https://www.reddit.com/r/music/search/?q={q}&restrict_sr=1', ships: true, local: false,
      tips: ['tip'], categoryIds: ['music'],
    },
    {
      id: 'kb-a', name: 'Keyboards A', kind: 'subreddit', url: 'https://www.reddit.com/r/kba/',
      searchUrlTemplate: 'https://www.reddit.com/r/kba/search/?q={q}&restrict_sr=1', ships: true, local: false,
      feeNote: 'No fees', tips: ['tip'], categoryIds: ['kb'],
    },
    {
      id: 'kb-b', name: 'Keyboards B', kind: 'forum', url: 'https://kb-b.example.com/',
      ships: true, local: true, tips: ['tip'], categoryIds: ['kb'],
    },
    {
      id: 'craigslist', name: 'Craigslist', kind: 'local-classifieds', url: 'https://www.craigslist.org/about/sites',
      ships: false, local: true, tips: ['tip'], categoryIds: [], general: true,
    },
    {
      id: 'facebook-marketplace', name: 'Facebook Marketplace', kind: 'facebook', url: 'https://www.facebook.com/marketplace/',
      searchUrlTemplate: 'https://www.facebook.com/marketplace/search/?query={q}', ships: true, local: true,
      tips: ['tip'], categoryIds: [], general: true,
    },
    {
      id: 'photo-shop', name: 'Photo shop', kind: 'marketplace', url: 'https://photo.example.com/',
      ships: false, local: true, tips: ['tip'], categoryIds: ['photo'],
    },
  ],
};

export const fixtureMetros: Metro[] = [
  {
    id: 'gotham', name: 'Gotham', state: 'NJ', aliases: ['gotham', 'arlington va'], zipPrefixes: ['123'],
    craigslist: 'gotham', buySellSubreddit: 'GothamBuySell',
  },
  { id: 'metropolis', name: 'Metropolis', state: 'NY', aliases: ['metropolis'], zipPrefixes: ['456'], craigslist: 'metropolis' },
];
