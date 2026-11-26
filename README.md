# sellscout

Describe something you want to sell. sellscout lists the boards, marketplaces and communities
where it would sell, such as specialist subreddits, forums, dealer buy-backs and local
classifieds for your city. Each entry shows why it fits, its fees, posting tips and links.

It runs on your own machine. In this version nothing leaves it: there are no accounts, no API
keys and no calls to other sites.

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

### Using it

The UI is a single page:
1. Describe the item.
2. Optionally give a US city or ZIP.
3. Choose **Ship it**, **Local pickup** or **Both**.
4. Press **Search**.

Results show any notices first, then what the item was understood as, then the ranked boards
under **Where to post it**. Each board lists why it fits, its fees, collapsible posting tips
and links that open in a new tab.

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

## Privacy

- Everything runs locally and the server listens on 127.0.0.1 only. It rejects requests whose
  `Host` header isn't its own and sends no CORS headers, so other websites can't drive it.
- The item text and location are processed on your machine and are not sent anywhere.
- Your last location is kept only in this browser's localStorage (`sellscout.location.v1`) and
  prefilled next time. Clearing the site data removes it.
- Links to other sites open in a new tab with `rel="noopener noreferrer"`. sellscout never
  scrapes or posts to any site.

## Roadmap

sellscout is being built in four steps, each its own pull request:
1. **Where to post it.** Board catalog, local boards for your city, the app and CI (this
   version).
2. **People looking for it.** Live "WTB / ISO / looking for" posts from Reddit (no key needed,
   optional Reddit credentials), plus saved searches that mark new posts.
3. **Similar listings on eBay.** Active listings and a typical asking-price range (optional free
   eBay developer key).
4. **Smarter matching with Claude.** With your own `ANTHROPIC_API_KEY`, Claude picks boards and
   search terms. Without a key, the built-in catalog still works.
