import type { Catalog, CatalogVenue, Category } from '../types.ts';

// Hand-curated board catalog. Facts (fees, title formats, posting rules) go stale:
// re-check them and bump `reviewed` whenever you edit this file.
// Keywords are lower-case; multi-word keywords match as phrases, and every keyword also
// matches its simple plural (keyboard ~ keyboards, watch ~ watches). Avoid generic words
// such as "case" or "set" on their own: they mis-rank unrelated items.

const categories: Category[] = [
  {
    id: 'electronics',
    name: 'Electronics',
    keywords: [
      'electronics', 'laptop', 'macbook', 'chromebook', 'television', 'tv', 'oled tv', 'monitor',
      'projector', 'drone', 'dji', 'kindle', 'e-reader', 'smart home', 'vr headset', 'meta quest',
    ],
  },
  {
    id: 'photo',
    name: 'Cameras & photo',
    keywords: [
      'camera', 'lens', 'sony a7', 'a7', 'a7 iii', 'a7 iv', 'a7r', 'a7c', 'a6400', 'a6000', 'canon', 'nikon',
      'fujifilm', 'fuji', 'x100v', 'x100vi', 'mirrorless', 'dslr', 'leica', 'hasselblad', 'olympus',
      'lumix', 'gopro', 'tripod', 'film camera', 'medium format', 'speedlight',
    ],
  },
  {
    id: 'audio',
    name: 'Audio & headphones',
    keywords: [
      'headphone', 'earbud', 'iem', 'in-ear monitor', 'dac', 'headphone amp', 'amplifier', 'turntable',
      'speaker', 'bookshelf speaker', 'subwoofer', 'soundbar', 'hifi', 'hi-fi', 'audiophile', 'sennheiser',
      'focal', 'audeze', 'hifiman', 'airpods', 'bose', 'sonos', 'klipsch', 'stereo receiver',
    ],
  },
  {
    id: 'pc-parts',
    name: 'PC parts & computers',
    keywords: [
      'gpu', 'rtx', 'gtx', 'radeon', 'graphics card', 'video card', 'cpu', 'processor', 'ryzen',
      'intel core', 'motherboard', 'ram', 'ddr4', 'ddr5', 'ssd', 'nvme', 'hard drive', 'power supply',
      'psu', 'pc case', 'gaming pc', 'desktop pc', 'pc build', 'cpu cooler',
    ],
  },
  {
    id: 'servers',
    name: 'Servers & networking',
    keywords: [
      'server', 'homelab', 'rack server', 'nas', 'synology', 'ubiquiti', 'unifi', 'network switch',
      'poweredge', 'proliant', 'xeon', 'epyc', 'raspberry pi', 'firewall appliance',
    ],
  },
  {
    id: 'keyboards',
    name: 'Mechanical keyboards',
    keywords: [
      'mechanical keyboard', 'keyboard', 'keycap', 'gmk', 'keychron', 'custom keyboard', 'artisan keycap',
      'keyboard switch', 'tkl', 'hhkb',
    ],
  },
  {
    id: 'phones',
    name: 'Phones & tablets',
    keywords: [
      'iphone', 'ipad', 'phone', 'smartphone', 'android phone', 'samsung galaxy', 'galaxy s', 'google pixel',
      'pixel', 'oneplus', 'tablet', 'apple watch', 'smartwatch', 'galaxy tab',
    ],
  },
  {
    id: 'video-games',
    name: 'Video games & consoles',
    keywords: [
      'video game', 'game console', 'console', 'playstation', 'ps5', 'ps4', 'ps2', 'xbox', 'nintendo',
      'nintendo switch', 'switch 2', 'game boy', 'gameboy', 'gamecube', 'n64', 'snes', 'nes', 'steam deck',
      'retro game', 'game cartridge',
    ],
  },
  {
    id: 'watches',
    name: 'Watches',
    keywords: [
      'watch', 'wristwatch', 'rolex', 'omega', 'seiko', 'grand seiko', 'tudor', 'cartier', 'casio',
      'g-shock', 'chronograph', 'automatic watch', 'tag heuer', 'breitling', 'patek', 'audemars piguet',
      'speedmaster', 'submariner',
    ],
  },
  {
    id: 'sneakers',
    name: 'Sneakers',
    keywords: [
      'sneaker', 'jordan', 'air jordan', 'yeezy', 'nike', 'adidas', 'new balance', 'dunk', 'air max',
      'air force 1', 'asics', 'trainer', 'deadstock',
    ],
  },
  {
    id: 'fashion',
    name: 'Clothing & fashion',
    keywords: [
      'clothing', 'clothes', 'jacket', 'coat', 'jeans', 'denim', 'dress', 'shirt', 'hoodie', 'sweater',
      'boots', 'shoes', 'handbag', 'purse', 'designer', 'vintage clothing', 'streetwear', 'supreme',
      'louis vuitton', 'gucci', 'prada', 'chanel', 'hermes', 'patagonia', 'arcteryx', 'levis',
    ],
  },
  {
    id: 'furniture',
    name: 'Furniture',
    keywords: [
      'furniture', 'sofa', 'couch', 'sectional', 'dresser', 'desk', 'dining table', 'coffee table',
      'side table', 'chair', 'office chair', 'armchair', 'bookshelf', 'bookcase', 'bed frame', 'mattress',
      'cabinet', 'nightstand', 'credenza', 'mid-century', 'mid century', 'herman miller', 'eames', 'rug',
    ],
  },
  {
    id: 'books',
    name: 'Books',
    keywords: [
      'book', 'textbook', 'hardcover', 'paperback', 'first edition', 'isbn', 'novel', 'rare book',
      'signed copy', 'cookbook',
    ],
  },
  {
    id: 'trading-cards',
    name: 'Trading cards & collectibles',
    keywords: [
      'trading card', 'pokemon card', 'pokemon', 'tcg', 'magic the gathering', 'mtg', 'yu-gi-oh', 'yugioh',
      'lorcana', 'sports card', 'baseball card', 'basketball card', 'football card', 'graded card',
      'psa 10', 'psa', 'bgs', 'booster box', 'booster pack', 'collectible', 'rookie card',
    ],
  },
  {
    id: 'comics',
    name: 'Comics & manga',
    keywords: [
      'comic', 'comic book', 'graphic novel', 'manga', 'cgc', 'marvel', 'dc comics', 'first appearance',
      'variant cover', 'back issue',
    ],
  },
  {
    id: 'records',
    name: 'Records & music media',
    keywords: [
      'vinyl', 'record', 'vinyl record', 'lp', 'first pressing', 'cd', 'cassette', 'album', 'box set',
    ],
  },
  {
    id: 'instruments',
    name: 'Musical instruments',
    keywords: [
      'guitar', 'electric guitar', 'acoustic guitar', 'bass guitar', 'fender', 'gibson', 'stratocaster',
      'telecaster', 'les paul', 'guitar amp', 'guitar pedal', 'effects pedal', 'drum', 'drum kit', 'cymbal',
      'synth', 'synthesizer', 'midi keyboard', 'digital piano', 'piano', 'violin', 'cello', 'saxophone',
      'trumpet', 'ukulele', 'banjo', 'mandolin', 'moog', 'korg', 'roland',
    ],
  },
  {
    id: 'bikes',
    name: 'Bikes & cycling',
    keywords: [
      'bike', 'bicycle', 'road bike', 'mountain bike', 'mtb', 'gravel bike', 'e-bike', 'ebike', 'bmx',
      'cannondale', 'specialized', 'trek', 'shimano', 'sram', 'frameset', 'groupset', 'wheelset',
    ],
  },
  {
    id: 'tools',
    name: 'Tools',
    keywords: [
      'tool', 'power tool', 'drill', 'impact driver', 'table saw', 'miter saw', 'circular saw', 'chainsaw',
      'dewalt', 'milwaukee', 'makita', 'ryobi', 'festool', 'snap-on', 'wrench', 'socket set', 'toolbox',
      'tool chest', 'air compressor', 'generator', 'welder', 'lathe', 'lawn mower', 'leaf blower',
    ],
  },
  {
    id: 'outdoor',
    name: 'Outdoor gear',
    keywords: [
      'tent', 'backpacking', 'backpack', 'sleeping bag', 'sleeping pad', 'hiking', 'camping', 'ultralight',
      'climbing', 'climbing shoes', 'carabiner', 'ski', 'snowboard', 'kayak', 'paddleboard', 'fishing rod',
      'fishing reel', 'osprey', 'hyperlite', 'zpacks', 'rei', 'trekking pole',
    ],
  },
  {
    id: 'toys-lego',
    name: 'Toys & LEGO',
    keywords: [
      'lego', 'lego set', 'minifigure', 'minifig', 'technic', 'toy', 'action figure', 'funko', 'hot wheels',
      'model train', 'board game',
    ],
  },
  {
    id: 'jewelry',
    name: 'Jewelry',
    keywords: [
      'jewelry', 'jewellery', 'ring', 'engagement ring', 'diamond', 'necklace', 'bracelet', 'earring',
      'pendant', 'gold chain', 'sterling silver', 'tiffany',
    ],
  },
  {
    id: 'art',
    name: 'Art',
    keywords: [
      'art', 'artwork', 'painting', 'oil painting', 'watercolor', 'canvas', 'sculpture', 'lithograph',
      'art print', 'signed print', 'vintage poster', 'framed print',
    ],
  },
  {
    id: 'pens',
    name: 'Fountain pens',
    keywords: ['fountain pen', 'pen', 'nib', 'montblanc', 'pelikan', 'lamy', 'visconti', 'parker pen'],
  },
];

const PAYPAL_GS = 'No fees; PayPal G&S expected';

const subreddit = (
  id: string,
  sub: string,
  categoryIds: string[],
  tips: string[],
  options: { local?: boolean } = {},
): CatalogVenue => ({
  id,
  name: `r/${sub}`,
  kind: 'subreddit',
  url: `https://www.reddit.com/r/${sub}/`,
  searchUrlTemplate: `https://www.reddit.com/r/${sub}/search/?q={q}&restrict_sr=1`,
  ships: true,
  local: options.local ?? false,
  feeNote: PAYPAL_GS,
  tips,
  categoryIds,
});

const venues: CatalogVenue[] = [
  // Cameras & photo
  subreddit('r-photomarket', 'photomarket', ['photo'], [
    'Title format: [USA-XX] [H] item [W] PayPal, local cash',
    'Include a timestamp photo: the gear next to paper with your username and the date',
    'Give a price for every item; buyers check your confirmed-trades history',
  ]),
  {
    id: 'fred-miranda',
    name: 'Fred Miranda Buy & Sell',
    kind: 'forum',
    url: 'https://www.fredmiranda.com/forum/index.php',
    ships: true,
    local: false,
    feeNote: 'No sales commission',
    tips: [
      'Buy & Sell has membership-time rules for new accounts: join well before you need to sell',
      'List shutter count, condition and everything included; buyers check your feedback',
    ],
    categoryIds: ['photo'],
  },
  {
    id: 'keh',
    name: 'KEH (sell to dealer)',
    kind: 'marketplace',
    url: 'https://www.keh.com/sell',
    ships: true,
    local: false,
    feeNote: 'Dealer offer: no listing work, but less than a private sale',
    tips: [
      'Get a quote online, then ship with their prepaid label',
      'Grade honestly; they inspect on arrival and may revise the offer',
    ],
    categoryIds: ['photo'],
  },
  {
    id: 'mpb',
    name: 'MPB (sell to dealer)',
    kind: 'marketplace',
    url: 'https://www.mpb.com/en-us/sell',
    ships: true,
    local: false,
    feeNote: 'Dealer offer: no listing work, but less than a private sale',
    tips: [
      'Get an instant quote online; MPB sends a free shipping label',
      'Include batteries, chargers and caps to keep the full quote',
    ],
    categoryIds: ['photo'],
  },

  // Audio
  subreddit('r-avexchange', 'AVexchange', ['audio'], [
    'Title format: [USA-XX] [H] item [W] PayPal, local cash',
    'Include a timestamp photo with your username and the date',
  ]),
  {
    id: 'head-fi-classifieds',
    name: 'Head-Fi Classifieds',
    kind: 'forum',
    url: 'https://www.head-fi.org/classifieds/',
    ships: true,
    local: false,
    tips: [
      'Posting a listing needs a Head-Fi account in good standing',
      'Say exactly what is in the box and note any scratches or cable wear',
    ],
    categoryIds: ['audio'],
  },
  {
    id: 'audiogon',
    name: 'Audiogon',
    kind: 'marketplace',
    url: 'https://www.audiogon.com/',
    ships: true,
    local: false,
    tips: [
      'Best for high-end hi-fi: amplifiers, DACs, turntables and speakers',
      'Keep the original packaging; buyers expect gear to be double boxed',
    ],
    categoryIds: ['audio'],
  },
  {
    id: 'us-audio-mart',
    name: 'US Audio Mart',
    kind: 'marketplace',
    url: 'https://www.usaudiomart.com/',
    ships: true,
    local: true,
    tips: [
      'Audio classifieds; offer local pickup for large speakers',
      'Give the model, age and condition in the title',
    ],
    categoryIds: ['audio'],
  },

  // PC parts, servers, keyboards
  subreddit('r-hardwareswap', 'hardwareswap', ['pc-parts'], [
    'Title format: [USA-XX] [H] item [W] PayPal, local cash',
    'Include a timestamp photo: the parts next to paper with your username',
    'Use PayPal Goods & Services, never Friends & Family',
  ], { local: true }),
  subreddit('r-homelabsales', 'homelabsales', ['servers', 'pc-parts'], [
    'Title starts with [FS] and your location, e.g. [FS][US-CA] Dell R730',
    'Include prices and a timestamp photo; say whether you ship or only do local pickup',
  ]),
  {
    id: 'servethehome-forums',
    name: 'ServeTheHome Forums (FS/FT)',
    kind: 'forum',
    url: 'https://forums.servethehome.com/',
    ships: true,
    local: false,
    tips: [
      'The For Sale/For Trade forum may need a minimum post count before you can list',
      'List exact part numbers (CPU, NIC, drive model) and the condition',
    ],
    categoryIds: ['servers'],
  },
  subreddit('r-mechmarket', 'mechmarket', ['keyboards'], [
    'Title format: [US-XX] [H] item [W] PayPal',
    'Include a timestamp photo with your username and the date',
  ]),

  // Video games
  subreddit('r-gamesale', 'gamesale', ['video-games'], [
    'Title format: [USA-XX] [H] item [W] PayPal, local cash',
    'Include a timestamp photo with your username',
    'List a price for every game',
  ], { local: true }),
  {
    id: 'gamestop-trade-in',
    name: 'GameStop trade-in',
    kind: 'marketplace',
    url: 'https://www.gamestop.com/trade/',
    ships: false,
    local: true,
    feeNote: 'Instant in-store offer, below private-sale prices',
    tips: [
      'Bring consoles with controllers and cables, factory reset',
      'Choosing store credit usually gets a better offer than cash',
    ],
    categoryIds: ['video-games'],
  },

  // Phones, tablets, electronics
  {
    id: 'swappa',
    name: 'Swappa',
    kind: 'marketplace',
    url: 'https://swappa.com/',
    searchUrlTemplate: 'https://swappa.com/search?q={q}',
    ships: true,
    local: false,
    tips: [
      'The device must be fully working with a clean IMEI (not blacklisted or financed)',
      'Listings are reviewed: photograph the actual device, powered on',
    ],
    categoryIds: ['phones', 'electronics', 'video-games'],
  },
  subreddit('r-appleswap', 'appleswap', ['phones', 'electronics'], [
    'Title format: [USA-XX] [H] item [W] PayPal, local cash',
    'Include a timestamp photo with your username',
    'Turn off Find My (Activation Lock) before you ship',
  ], { local: true }),
  {
    id: 'back-market',
    name: 'Back Market (trade-in)',
    kind: 'marketplace',
    url: 'https://www.backmarket.com/',
    ships: true,
    local: false,
    feeNote: 'Fixed trade-in offer: no listing work',
    tips: [
      'Get an instant trade-in offer, then ship with the free label',
      'Sign out of iCloud or Google and factory reset first',
    ],
    categoryIds: ['phones', 'electronics'],
  },
  // Watches
  subreddit('r-watchexchange', 'Watchexchange', ['watches'], [
    'Title format: [WTS] Brand Model, with the price in the post',
    'A handwritten timestamp with your username is required',
    'Say whether box, papers and service history are included',
  ]),
  {
    id: 'chrono24',
    name: 'Chrono24',
    kind: 'marketplace',
    url: 'https://www.chrono24.com/',
    searchUrlTemplate: 'https://www.chrono24.com/search/index.htm?query={q}',
    ships: true,
    local: false,
    feeNote: 'Commission on each sale',
    tips: [
      'Private sellers are paid through Chrono24 escrow',
      'Photograph dial, caseback, clasp and papers (cover part of the serial)',
    ],
    categoryIds: ['watches'],
  },
  {
    id: 'watchuseek-sales-corner',
    name: 'WatchUSeek Sales Corner',
    kind: 'forum',
    url: 'https://www.watchuseek.com/',
    ships: true,
    local: false,
    tips: [
      'The Sales Corner has account-age and post-count rules for sellers',
      'Show the dial, caseback and clasp; mention box and papers',
    ],
    categoryIds: ['watches'],
  },

  // Jewelry
  {
    id: 'worthy',
    name: 'Worthy',
    kind: 'marketplace',
    url: 'https://www.worthy.com/',
    ships: true,
    local: false,
    feeNote: 'Commission on the final sale price',
    tips: [
      'Auctions diamonds, engagement rings and fine jewelry to dealers',
      'A grading report (e.g. GIA) gets better bids',
    ],
    categoryIds: ['jewelry'],
  },

  // Sneakers and fashion
  subreddit('r-sneakermarket', 'sneakermarket', ['sneakers'], [
    'Title format: [WTS] model, size and price',
    'Include a timestamp photo with your username',
    'Show the size tag, soles and insoles',
  ]),
  {
    id: 'stockx',
    name: 'StockX',
    kind: 'marketplace',
    url: 'https://stockx.com/',
    searchUrlTemplate: 'https://stockx.com/search?s={q}',
    ships: true,
    local: false,
    feeNote: 'Transaction fee plus payment processing',
    tips: [
      'New, unworn items only; you ship to StockX for verification',
      'Ship before the deadline after a sale or you can be charged a penalty',
    ],
    categoryIds: ['sneakers'],
  },
  {
    id: 'goat',
    name: 'GOAT',
    kind: 'marketplace',
    url: 'https://www.goat.com/',
    searchUrlTemplate: 'https://www.goat.com/search?query={q}',
    ships: true,
    local: false,
    feeNote: 'Commission plus a cash-out fee',
    tips: [
      'Sells new and used sneakers; GOAT authenticates before you are paid',
      'For used pairs, take every photo angle the app asks for',
    ],
    categoryIds: ['sneakers'],
  },
  {
    id: 'grailed',
    name: 'Grailed',
    kind: 'marketplace',
    url: 'https://www.grailed.com/',
    ships: true,
    local: false,
    feeNote: 'Commission plus payment processing',
    tips: [
      'Menswear and streetwear sell best; tag the designer and size',
      'Add measurements (pit to pit, length) and flat-lay photos',
    ],
    categoryIds: ['fashion', 'sneakers'],
  },
  {
    id: 'depop',
    name: 'Depop',
    kind: 'marketplace',
    url: 'https://www.depop.com/',
    searchUrlTemplate: 'https://www.depop.com/search/?q={q}',
    ships: true,
    local: false,
    tips: [
      'Bright, styled photos sell; the first photo is what buyers see',
      'Tag brand, size and condition so search finds it',
    ],
    categoryIds: ['fashion', 'sneakers'],
  },
  {
    id: 'poshmark',
    name: 'Poshmark',
    kind: 'marketplace',
    url: 'https://poshmark.com/',
    searchUrlTemplate: 'https://poshmark.com/search?query={q}',
    ships: true,
    local: false,
    feeNote: 'Commission on each sale; prepaid shipping label included',
    tips: [
      'Share your listings often; sharing moves them up the feed',
      'Answer offers quickly and offer bundle discounts',
    ],
    categoryIds: ['fashion', 'sneakers', 'jewelry'],
  },
  {
    id: 'thredup',
    name: 'ThredUp (clean out)',
    kind: 'marketplace',
    url: 'https://www.thredup.com/',
    ships: true,
    local: false,
    feeNote: 'Consignment: ThredUp prices and lists; payouts are low',
    tips: [
      'Order a Clean Out kit and mail clothes in bulk',
      'Best for clearing a closet, not for single valuable pieces',
    ],
    categoryIds: ['fashion'],
  },
  {
    id: 'the-realreal',
    name: 'The RealReal',
    kind: 'marketplace',
    url: 'https://www.therealreal.com/',
    ships: true,
    local: false,
    feeNote: 'Consignment commission on each sale',
    tips: [
      'Luxury consignment: they authenticate, photograph and price for you',
      'Best for designer bags, fine jewelry and luxury watches',
    ],
    categoryIds: ['fashion', 'jewelry', 'watches'],
  },
  {
    id: 'patagonia-worn-wear',
    name: 'Patagonia Worn Wear (trade-in)',
    kind: 'marketplace',
    url: 'https://wornwear.patagonia.com/',
    ships: true,
    local: true,
    feeNote: 'Trade-in for store credit',
    tips: [
      'Patagonia clothing and gear only, traded in for credit',
      'Items must be clean and fully functional',
    ],
    categoryIds: ['fashion', 'outdoor'],
  },

  // Furniture
  {
    id: 'chairish',
    name: 'Chairish',
    kind: 'marketplace',
    url: 'https://www.chairish.com/',
    ships: true,
    local: false,
    feeNote: 'Commission on each sale',
    tips: [
      'Vintage and designer furniture, decor and art',
      'Give exact dimensions, the maker and any restoration',
    ],
    categoryIds: ['furniture', 'art'],
  },
  {
    id: '1stdibs',
    name: '1stDibs',
    kind: 'marketplace',
    url: 'https://www.1stdibs.com/',
    ships: true,
    local: false,
    tips: [
      'High-end vintage furniture, art and jewelry; sellers apply to join',
      'Provenance and maker marks raise the price: photograph them',
    ],
    categoryIds: ['furniture', 'art', 'jewelry'],
  },

  // Books, comics, records
  {
    id: 'abebooks',
    name: 'AbeBooks',
    kind: 'marketplace',
    url: 'https://www.abebooks.com/',
    searchUrlTemplate: 'https://www.abebooks.com/servlet/SearchResults?kn={q}',
    ships: true,
    local: false,
    tips: [
      'Best for rare, signed and first-edition books',
      'Describe binding, edition and condition in standard book terms',
    ],
    categoryIds: ['books'],
  },
  {
    id: 'bookscouter',
    name: 'BookScouter (buyback comparison)',
    kind: 'marketplace',
    url: 'https://bookscouter.com/',
    ships: true,
    local: false,
    feeNote: 'Compares buyback offers; vendors pay shipping',
    tips: [
      'Enter the ISBN to compare offers from many buyback vendors',
      'Textbooks fetch the most at the start of a semester',
    ],
    categoryIds: ['books'],
  },
  subreddit('r-comicswap', 'comicswap', ['comics'], [
    'Title format: [H] item [W] PayPal, with your location',
    'Include a timestamp photo with your username; give the CGC grade if graded',
  ]),
  {
    id: 'mycomicshop',
    name: 'MyComicShop (sell to dealer)',
    kind: 'marketplace',
    url: 'https://www.mycomicshop.com/',
    ships: true,
    local: false,
    feeNote: 'Dealer offer: no listing work',
    tips: [
      'Check what they are buying before you ship',
      'Grade conservatively; they re-grade on arrival',
    ],
    categoryIds: ['comics'],
  },
  {
    id: 'discogs',
    name: 'Discogs',
    kind: 'marketplace',
    url: 'https://www.discogs.com/',
    searchUrlTemplate: 'https://www.discogs.com/search/?q={q}&type=all',
    ships: true,
    local: false,
    feeNote: 'Selling fee (about 9%) plus payment processing',
    tips: [
      'List against the exact pressing: match catalog and matrix numbers',
      'Grade media and sleeve separately (Goldmine scale)',
    ],
    categoryIds: ['records'],
  },

  // Trading cards
  {
    id: 'tcgplayer',
    name: 'TCGplayer',
    kind: 'marketplace',
    url: 'https://www.tcgplayer.com/',
    searchUrlTemplate: 'https://www.tcgplayer.com/search/all/product?q={q}',
    ships: true,
    local: false,
    feeNote: 'Commission plus payment processing',
    tips: [
      'List singles by exact set, number and condition (NM, LP, MP)',
      'Bulk commons sell better as a lot elsewhere',
    ],
    categoryIds: ['trading-cards'],
  },
  subreddit('r-pkmntcgtrades', 'pkmntcgtrades', ['trading-cards'], [
    'Follow the sub\'s [H]/[W] title format with your country',
    'Include timestamp photos of the cards with your username',
  ]),
  {
    id: 'comc',
    name: 'COMC (Check Out My Cards)',
    kind: 'marketplace',
    url: 'https://www.comc.com/',
    ships: true,
    local: false,
    feeNote: 'Processing fee per card plus commission',
    tips: [
      'Ship cards in; COMC scans and lists them for you',
      'Worth it for many sports cards at once',
    ],
    categoryIds: ['trading-cards'],
  },
  {
    id: 'card-kingdom-buylist',
    name: 'Card Kingdom buylist',
    kind: 'marketplace',
    url: 'https://www.cardkingdom.com/',
    ships: true,
    local: false,
    feeNote: 'Dealer buylist: fixed prices, no listing work',
    tips: [
      'Sells Magic: The Gathering singles to a dealer at posted prices',
      'Choosing store credit pays more than cash',
    ],
    categoryIds: ['trading-cards'],
  },

  // Musical instruments
  {
    id: 'reverb',
    name: 'Reverb',
    kind: 'marketplace',
    url: 'https://reverb.com/',
    searchUrlTemplate: 'https://reverb.com/marketplace?query={q}',
    ships: true,
    local: true,
    feeNote: 'Selling fee (about 5%) plus payment processing',
    tips: [
      'Check the Price Guide for recent sale prices before listing',
      'Show the serial number, frets, electronics and any repairs',
    ],
    categoryIds: ['instruments', 'audio'],
  },
  subreddit('r-gear4sale', 'Gear4Sale', ['instruments'], [
    'Follow the sub\'s [H]/[W] title format with your location',
    'Include a timestamp photo with your username',
  ], { local: true }),
  {
    id: 'sweetwater-gear-exchange',
    name: 'Sweetwater Gear Exchange',
    kind: 'marketplace',
    url: 'https://www.sweetwater.com/used/',
    ships: true,
    local: false,
    tips: [
      'List used music gear to Sweetwater\'s buyers',
      'Use clear photos and include the serial number',
    ],
    categoryIds: ['instruments'],
  },
  {
    id: 'talkbass-classifieds',
    name: 'TalkBass Classifieds',
    kind: 'forum',
    url: 'https://www.talkbass.com/',
    ships: true,
    local: true,
    tips: [
      'Classifieds need an established account before you can post',
      'For basses, bass amps, cabs and pedals',
    ],
    categoryIds: ['instruments'],
  },

  // Bikes
  {
    id: 'pinkbike-buysell',
    name: 'Pinkbike Buy/Sell',
    kind: 'marketplace',
    url: 'https://www.pinkbike.com/buysell/',
    searchUrlTemplate: 'https://www.pinkbike.com/buysell/list/?q={q}',
    ships: true,
    local: true,
    feeNote: 'Free basic listings',
    tips: [
      'Give frame size, wheel size and model year',
      'Prefer local cash or a protected payment; never wire money',
    ],
    categoryIds: ['bikes'],
  },
  subreddit('r-bikeswap', 'BikeSwap', ['bikes'], [
    'Put your location and price in the title',
    'Include a timestamp photo with your username',
  ], { local: true }),
  {
    id: 'the-pros-closet',
    name: 'The Pro\'s Closet (trade-in)',
    kind: 'marketplace',
    url: 'https://www.theproscloset.com/',
    ships: true,
    local: false,
    feeNote: 'Dealer offer or consignment',
    tips: [
      'Get a trade-in or consignment quote for a high-end bike',
      'Best for recent road, gravel and mountain bikes',
    ],
    categoryIds: ['bikes'],
  },

  // Outdoor gear
  subreddit('r-ulgeartrade', 'ULgeartrade', ['outdoor'], [
    'Start the title with the sale tag the sub requires (e.g. [WTS])',
    'List weights, condition and a timestamp photo with your username',
  ]),
  {
    id: 'geartrade',
    name: 'GearTrade',
    kind: 'marketplace',
    url: 'https://www.geartrade.com/',
    ships: true,
    local: false,
    feeNote: 'Commission on each sale',
    tips: [
      'Used outdoor gear: list it yourself or consign',
      'Clean gear and list exact model and size',
    ],
    categoryIds: ['outdoor'],
  },
  {
    id: 'rei-trade-in',
    name: 'REI Re/Supply (trade-in)',
    kind: 'marketplace',
    url: 'https://www.rei.com/used',
    ships: false,
    local: true,
    feeNote: 'Trade-in for an REI gift card',
    tips: [
      'REI members trade in gear at REI stores',
      'Gear must be clean and functional',
    ],
    categoryIds: ['outdoor'],
  },

  // Toys and LEGO
  {
    id: 'bricklink',
    name: 'BrickLink',
    kind: 'marketplace',
    url: 'https://www.bricklink.com/',
    searchUrlTemplate: 'https://www.bricklink.com/v2/search.page?q={q}',
    ships: true,
    local: false,
    feeNote: 'Commission on sales (about 3%)',
    tips: [
      'Open a store and list sets by set number, parts by part and colour',
      'Say whether a set is sealed, complete with box, or incomplete',
    ],
    categoryIds: ['toys-lego'],
  },
  {
    id: 'brick-owl',
    name: 'Brick Owl',
    kind: 'marketplace',
    url: 'https://www.brickowl.com/',
    ships: true,
    local: false,
    tips: [
      'LEGO sets, minifigures and parts',
      'Import a BrickLink inventory to list on both',
    ],
    categoryIds: ['toys-lego'],
  },
  subreddit('r-legomarket', 'legomarket', ['toys-lego'], [
    'Title format: [H] set number and name [W] PayPal, with your location',
    'Include a timestamp photo with your username',
  ]),

  // Art
  {
    id: 'etsy',
    name: 'Etsy',
    kind: 'marketplace',
    url: 'https://www.etsy.com/',
    searchUrlTemplate: 'https://www.etsy.com/search?q={q}',
    ships: true,
    local: false,
    feeNote: '$0.20 listing fee plus 6.5% transaction fee and payment processing',
    tips: [
      'Only handmade items, vintage (20+ years old) or craft supplies are allowed',
      'Use every photo slot and all 13 tags',
    ],
    categoryIds: ['art', 'jewelry', 'fashion'],
  },
  {
    id: 'saatchi-art',
    name: 'Saatchi Art',
    kind: 'marketplace',
    url: 'https://www.saatchiart.com/',
    ships: true,
    local: false,
    feeNote: 'Commission on each sale',
    tips: [
      'For artists selling their own original work',
      'Upload high-resolution photos and exact dimensions',
    ],
    categoryIds: ['art'],
  },

  // Fountain pens
  subreddit('r-pen-swap', 'Pen_Swap', ['pens'], [
    'Follow the sub\'s title format: [WTS] item, with your region and price',
    'Include a timestamp photo with your username; give the nib size and condition',
  ]),

  // Multi-category venues: after the core specialists so they lose catalog-order ties.
  {
    id: 'decluttr',
    name: 'Decluttr',
    kind: 'marketplace',
    url: 'https://www.decluttr.com/',
    ships: true,
    local: false,
    feeNote: 'Fixed buyback price: no listing work',
    tips: [
      'Type or scan the barcode for an instant price',
      'Shipping is free; you are paid after the items are checked',
    ],
    categoryIds: ['phones', 'video-games', 'books', 'records'],
  },
  {
    id: 'nextdoor',
    name: 'Nextdoor For Sale & Free',
    kind: 'local-classifieds',
    url: 'https://nextdoor.com/',
    ships: false,
    local: true,
    feeNote: 'Free to post',
    tips: [
      'Neighbours only: good for bulky items you will not ship',
      'Post a price and a pickup window',
    ],
    categoryIds: ['furniture', 'tools', 'bikes', 'toys-lego'],
  },

  // General venues: shown for every item, after the specialists.
  {
    id: 'ebay',
    name: 'eBay',
    kind: 'marketplace',
    url: 'https://www.ebay.com/',
    searchUrlTemplate: 'https://www.ebay.com/sch/i.html?_nkw={q}',
    ships: true,
    local: false,
    feeNote: 'Final value fee of roughly 13-15% in most categories, plus a per-order fee',
    tips: [
      'Price it from sold listings: search, then filter by Sold Items',
      'Photograph model numbers, serial numbers and every flaw',
    ],
    categoryIds: [],
    general: true,
  },
  {
    id: 'facebook-marketplace',
    name: 'Facebook Marketplace',
    kind: 'facebook',
    url: 'https://www.facebook.com/marketplace/',
    searchUrlTemplate: 'https://www.facebook.com/marketplace/search/?query={q}',
    ships: true,
    local: true,
    feeNote: 'Free for local pickup; a selling fee applies to shipped orders',
    tips: [
      'Meet in a public place; take cash or an instant payment in person',
      'Price a little above your floor: buyers expect to haggle',
    ],
    categoryIds: [],
    general: true,
  },
  {
    id: 'craigslist',
    name: 'Craigslist',
    kind: 'local-classifieds',
    url: 'https://www.craigslist.org/about/sites',
    ships: false,
    local: true,
    feeNote: 'Free in most for-sale categories',
    tips: [
      'Meet in a public place; many police stations have safe-exchange spots',
      'Ignore buyers who ask for a verification code or want to pay by check',
    ],
    categoryIds: [],
    general: true,
  },
  {
    id: 'offerup',
    name: 'OfferUp',
    kind: 'marketplace',
    url: 'https://offerup.com/',
    searchUrlTemplate: 'https://offerup.com/search?q={q}',
    ships: true,
    local: true,
    feeNote: 'Free for local pickup; a service fee applies to shipped sales',
    tips: [
      'Verify your profile so buyers trust you',
      'Meet at a public spot for local sales',
    ],
    categoryIds: [],
    general: true,
  },
  {
    id: 'mercari',
    name: 'Mercari',
    kind: 'marketplace',
    url: 'https://www.mercari.com/',
    searchUrlTemplate: 'https://www.mercari.com/search/?keyword={q}',
    ships: true,
    local: false,
    tips: [
      'Use the prepaid label and ship within the handling time you set',
      'Check sold listings on Mercari before pricing',
    ],
    categoryIds: [],
    general: true,
  },
];

export const catalog: Catalog = {
  reviewed: '2026-11-25',
  categories,
  venues,
};
