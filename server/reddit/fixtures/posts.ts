// Fixture Reddit posts for fixture mode (tests, e2e, demos). Ages are hours before "now" at
// serve time. The fx_mk* posts are the "Fixture data agreement" that the e2e tests assert:
// change them only together with e2e/.

export interface FixturePost {
  id: string;
  subreddit: string;
  title: string;
  author: string;
  ageHours: number;
  score: number;
  numComments: number;
  selftext: string;
  over18?: boolean;
  stickied?: boolean;
  /** Defaults to `/r/<subreddit>/comments/<id>/<slug of the title>/`. */
  permalink?: string;
}

export const FIXTURE_POSTS: readonly FixturePost[] = [
  // "mechanical keyboard": r/mechmarket + site-wide.
  {
    id: 'fx_mk1',
    subreddit: 'mechmarket',
    title: '[US-CA] [H] PayPal [W] Mechanical keyboard, 65% layout preferred',
    author: 'keeb_buyer',
    ageHours: 5,
    score: 12,
    numComments: 3,
    selftext: 'Looking for a **hot-swap** board. See [my wishlist](https://example.com/list).',
  },
  {
    id: 'fx_mk2',
    subreddit: 'mechmarket',
    title: '[US-NY] [H] Mechanical keyboard, Keychron Q1 [W] PayPal',
    author: 'keeb_seller',
    ageHours: 8,
    score: 2,
    numComments: 1,
    selftext: 'Selling my Q1, lightly used. Timestamps in the comments.',
  },
  {
    id: 'fx_mk3',
    subreddit: 'MechanicalKeyboards',
    title: 'WTB a mechanical keyboard for a beginner',
    author: 'first_keeb',
    ageHours: 30,
    score: 4,
    numComments: 9,
    selftext: '',
  },
  {
    id: 'fx_mk4',
    subreddit: 'MechanicalKeyboards',
    title: 'WTB mechanical keyboard (nsfw test)',
    author: 'nsfw_user',
    ageHours: 2,
    score: 1,
    numComments: 0,
    selftext: '',
    over18: true,
  },
  {
    id: 'fx_mk5',
    subreddit: 'mechmarket',
    title: 'Looking for a mechanical keyboard - monthly thread',
    author: 'AutoModerator',
    ageHours: 1,
    score: 1,
    numComments: 0,
    selftext: '',
    stickied: true,
  },
  {
    id: 'fx_mk6',
    subreddit: 'MechanicalKeyboards',
    title: 'WTB mechanical keyboard, older post',
    author: 'old_keeb',
    ageHours: 960,
    score: 3,
    numComments: 2,
    selftext: '',
  },

  // "RTX 3080": r/hardwareswap + site-wide.
  {
    id: 'fx_gpu1',
    subreddit: 'hardwareswap',
    title: '[USA-TX] [H] PayPal, Local Cash [W] RTX 3080',
    author: 'gpu_hunter',
    ageHours: 3,
    score: 7,
    numComments: 4,
    selftext: 'Want a 3080 *10GB* or 12GB. Will pay shipping.',
  },
  {
    id: 'fx_gpu2',
    subreddit: 'hardwareswap',
    title: '[USA-WA] [H] RTX 3080 Founders Edition [W] PayPal, Local Cash',
    author: 'gpu_seller',
    ageHours: 6,
    score: 3,
    numComments: 2,
    selftext: 'Timestamps: imgur link. Never mined on.',
  },
  {
    id: 'fx_gpu3',
    subreddit: 'buildapc',
    title: 'Looking for a 3080 for my first build',
    author: 'new_builder',
    ageHours: 20,
    score: 15,
    numComments: 11,
    selftext: 'Budget is $400. Is a used card a good idea?',
  },
  {
    id: 'fx_gpu4',
    subreddit: 'hardwareswap',
    title: 'WTS RTX 3080, looking for offers',
    author: 'gpu_flipper',
    ageHours: 10,
    score: 0,
    numComments: 5,
    selftext: '',
  },
  {
    id: 'fx_gpu5',
    subreddit: 'hardwareswap',
    title: 'WTB RTX 3080 (deleted account)',
    author: '[deleted]',
    ageHours: 12,
    score: 1,
    numComments: 0,
    selftext: '',
  },

  // "Sony A7 III": r/photomarket + site-wide.
  {
    id: 'fx_cam1',
    subreddit: 'photomarket',
    title: 'WTB Sony A7 III, body only',
    author: 'shutterbug',
    ageHours: 4,
    score: 5,
    numComments: 2,
    selftext: 'Under 30k shutter count, US only. ~$900 budget.',
  },
  {
    id: 'fx_cam2',
    subreddit: 'photomarket',
    title: '[FS] [US-WA] Sony A7 III, 20k shutter count',
    author: 'camera_seller',
    ageHours: 9,
    score: 4,
    numComments: 3,
    selftext: 'Comes with two batteries and the box.',
  },
  {
    id: 'fx_cam3',
    subreddit: 'SonyAlpha',
    title: 'ISO: a7iii in good shape',
    author: 'alpha_seeker',
    ageHours: 50,
    score: 8,
    numComments: 6,
    selftext: '> Prefer a local sale in **Portland**.',
  },
  {
    id: 'fx_cam4',
    subreddit: 'SonyAlpha',
    title: 'Shot at ISO 6400 with my Sony A7 III',
    author: 'night_shooter',
    ageHours: 14,
    score: 120,
    numComments: 30,
    selftext: 'Noise is very manageable.',
  },
];
