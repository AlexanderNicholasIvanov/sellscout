# sellscout

Describe something you want to sell. sellscout lists the boards, marketplaces and communities
where it would sell, such as specialist subreddits, forums, dealer buy-backs and local
classifieds for your city. Each entry shows why it fits, its fees, posting tips and links.

It also shows **People looking for it**: recent Reddit posts from people who want to buy the
item ("WTB", "ISO", "looking for"), plus ready-made links to search Reddit and Craigslist
yourself.

It runs on your own machine. Without Reddit app keys nothing leaves it: no accounts and no
calls to other sites. With keys, only the search term goes to Reddit (see [Reddit](#reddit)).

## Setup

Requires Node.js 24 or newer.

```sh
npm ci
npx playwright install chromium   # only needed for the e2e tests
```

## Running

```sh
npm start
```

This builds the UI and serves sellscout at <http://127.0.0.1:5180>, on loopback only. Set
`PORT` to use another port, for example `PORT=5190 npm start` (PowerShell:
`$env:PORT=5190; npm start`). If it prints `Port 5180 is in use; set PORT to another port`,
another program already has that port: stop it, or start sellscout with a different `PORT`.

For development, `npm run dev` runs the API server with `--watch` on 5180 and the Vite dev
server on 5173, which proxies `/api` to the API. Ctrl+C stops both.

`npm start` and `npm run dev` load `.env` from the repo root when it exists (copy
`.env.example`). It holds the optional [Reddit](#reddit) keys.

### Fixture mode

Fixture mode serves canned Reddit posts and blocks every outbound request. It is for demos and
the e2e tests, and needs no keys:

```sh
SELLSCOUT_FIXTURES=1 npm start
SELLSCOUT_FIXTURES=1 SELLSCOUT_FIXTURE_DELAY_MS=1500 npm start   # slow answers
```

In PowerShell: `$env:SELLSCOUT_FIXTURES=1; npm start`.

- Set these variables in the shell. In `.env` they have no effect.
- In fixture mode `.env` is not loaded, any Reddit keys are ignored and every outbound `fetch`
  fails with "Outbound request blocked in fixture mode".
- The header shows "Reddit: fixture" and "Fixture data".
- Try "mechanical keyboard", "RTX 3080" or "Sony A7 III".
- The items `reddit-403`, `reddit-429`, `reddit-html` and `reddit-timeout` show those failures.
- `SELLSCOUT_FIXTURE_DELAY_MS` (a whole number of milliseconds, default 0) delays each canned
  answer.

### Using it

The UI is a single page:
1. Describe the item.
2. Optionally give a US city or ZIP.
3. Choose **Ship it**, **Local pickup** or **Both**.
4. Choose how far back to look for buyer posts: 7, 30 (the default) or 90 days.
5. Press **Search**.

Results show any notices first, then what the item was understood as, then the ranked boards
under **Where to post it**. Each board lists why it fits, its fees, collapsible posting tips
and links that open in a new tab.

**People looking for it** comes next. It shows the Reddit search term and, with Reddit keys,
the matching posts: title, subreddit, author, age, score, comments and the start of the text.
Its **Look yourself** links work with or without keys. Header chips show whether Reddit is on.

The page works with the keyboard alone and on narrow (375 px) screens.

## Checks

```sh
npm run lint        # eslint
npm run typecheck   # tsc over src, server, tests, e2e and configs
npm test            # vitest: server, engine, data and UI helper tests
npm run build       # type check + Vite production build
npm run e2e         # Playwright (chromium); starts its own server on port 5181
```

CI (`.github/workflows/ci.yml`) runs the same commands on every pull request and on every push
to `main`. No test makes a real network call:
- The UI e2e tests in `e2e/ui-*.spec.ts` replace `/api/search` with fixtures from
  `e2e/fixtures/`.
- `e2e/live.spec.ts` uses the real server and catalog.
- Both block every request that isn't to `127.0.0.1:5181`.
- The Playwright server runs in [fixture mode](#fixture-mode), and the Reddit unit tests use a
  fake `fetch`.

## Editing the catalog and metros

**Board catalog: `server/data/catalog.ts`**
- Each category has a lower-case `id`, a `name` and `keywords`. Keywords match whole words,
  case-insensitively and ignoring accents, and also their simple plurals (`keyboard` matches
  `keyboards`). Multi-word keywords match as phrases. Avoid generic words like `case`, `set`
  or `ring`; use phrases such as `engagement ring` instead.
- Each venue needs a unique `id`, a `kind`, an `https://` `url`, `ships`/`local` flags (at least
  one true), 1-3 `tips` and the `categoryIds` it serves. Add a `searchUrlTemplate` containing
  `{q}` only if the site has a query-string search. Set `general: true` with `categoryIds: []`
  only for boards that fit every item.
- Brand-only boards (e.g. Patagonia Worn Wear) get their own narrow category, so they don't
  outrank general boards for other brands.
- Venues with the same score keep their order in the file, so list the best board for a
  category first.
- Bump `reviewed` whenever you re-check fees or rules. They change, and the catalog is only as
  current as its last review.

**Metros: `server/data/metros.ts`**
- Each metro has lower-case `aliases`, 3-digit `zipPrefixes` that no other metro uses, and the
  real `craigslist` subdomain.
- If a user types a state ("Portland, ME"), a bare alias only matches a metro in that state.
  Give suburbs in another state a state-qualified alias such as `"jersey city nj"`.
- Set `buySellSubreddit` only for a local buy/sell subreddit you have checked is real and
  active.

`npm test` checks both files: unique ids, https URLs, the `{q}` placeholder, and no shared ZIP
prefixes or aliases.

## Reddit

**People looking for it** uses Reddit's official API, which needs app keys. Anonymous access is
shut off: keyless requests to Reddit's JSON pages got HTTP 403 (checked on 2026-11-25). Without
keys sellscout makes no Reddit request at all. It says "Add Reddit app keys to see live posts
here" and still gives the look-yourself links.

**Getting keys**
1. Sign in to Reddit and open <https://www.reddit.com/prefs/apps>.
2. Create an app of type **script**. sellscout uses app-only access: it never signs in as you
   and never posts.
3. Reddit approves new API apps by hand under its Responsible Builder Policy, so access can take
   a while or be refused.
4. Put the keys in `.env` in the repo root (see `.env.example`), then restart sellscout:

```sh
REDDIT_CLIENT_ID=<the id shown under the app name>
REDDIT_CLIENT_SECRET=<the secret>
REDDIT_USERNAME=<your Reddit username, optional, used only in the User-Agent>
```

The header then shows "Reddit: on". `.env` is git-ignored: never commit it or paste keys into
an issue.

**What is searched**
- Only the search term. It is the item text up to the first `,` `;` `(` `|` or ` - `, without
  filler words such as "the", "used" or "mint", and at most 6 words. "Sony A7 III body, low
  shutter count" becomes "Sony A7 III".
- One site-wide search for `(WTB OR ISO OR "looking for") <term>`, plus one in each of the
  item's top catalog subreddits (up to 3), such as r/hardwareswap for "RTX 3080".
- Your location is never sent to Reddit. It is used only for the Craigslist link.
- Results are filtered on your machine. A trade post (`[H] ... [W] ...`) counts only when the
  item is in the `[W]` (want) part; other posts need a buy phrase such as "WTB" or "looking
  for". NSFW, pinned and deleted posts are dropped. It is a keyword rule, so expect the odd
  false match.

**Rate limits**
- At most 4 searches per item, one at a time and at least 500 ms apart.
- sellscout follows Reddit's `X-Ratelimit-*` headers. When the allowance runs out, or Reddit
  answers HTTP 429, it stops asking until the reset (60 s if Reddit gives none) and says
  "Reddit rate limit reached; try again in N s".
- Each request gives up after 10 s, and the whole Reddit search after 25 s.

**Look yourself.** Every result has links to Reddit's own search (site-wide and per subreddit)
and to Craigslist's "wanted" section for your city. They need no keys.

## Privacy

- Everything runs locally and the server listens on 127.0.0.1 only. It rejects requests whose
  `Host` header isn't its own and sends no CORS headers, so other websites can't drive it.
- The item text and location are processed on your machine.
- The buyer search term (derived from the item text) is sent to Reddit's API only when Reddit
  keys are set. Without keys nothing is sent. The location is never sent to Reddit or anywhere
  else; it only picks local boards and the Craigslist link.
- Reddit keys stay in `.env` and in the server's memory. They are never logged or sent to the
  browser.
- Your last location is kept only in this browser's localStorage (`sellscout.location.v1`) and
  prefilled next time. Clearing the site data removes it.
- Links to other sites open in a new tab with `rel="noopener noreferrer"`. sellscout never
  scrapes or posts to any site.

## Roadmap

sellscout is being built in steps, each its own pull request:
1. **Where to post it.** Board catalog, local boards for your city, the app and CI (done).
2. **People looking for it.**
   - 2a. Reddit buyer posts with your own Reddit app keys, look-yourself links, fixture mode
     and status chips (done, this version).
   - 2b. Saved searches, with "New" badges on posts you haven't seen yet (next).
3. **Similar listings on eBay.** Active listings and a typical asking-price range (optional free
   eBay developer key).
4. **Smarter matching with Claude.** With your own `ANTHROPIC_API_KEY`, Claude picks boards and
   search terms. Without a key, the built-in catalog still works.
