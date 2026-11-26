import { useEffect, useRef, useState } from 'react';
import type { FormEvent, RefObject } from 'react';
import type {
  BuyerPost,
  BuyersResult,
  BuyerWindow,
  Delivery,
  EbayListing,
  EbayResult,
  SearchInput,
  SearchResult,
  Venue,
} from '../server/types.ts';
import { BUYER_WINDOWS, DEFAULT_BUYER_WINDOW, buildSearchInput, search, status } from './api.ts';
import {
  ageText,
  buyersSearchedText,
  ebayNoListingsText,
  ebaySearchedText,
  kindLabel,
  money,
  postMetaText,
  postStatsText,
  priceRangeText,
  safeHref,
  searchLinkText,
  statusChips,
  understoodAs,
  whyText,
} from './format.ts';
import {
  SAVED_MESSAGE,
  add,
  applyRun,
  load,
  newCountText,
  newPostIds,
  remove,
  write,
} from './saved.ts';
import type { SavedSearch, SavedStorage } from './saved.ts';
import { LOCATION_MAX, loadLocation, saveLocation } from './storage.ts';

const ITEM_MAX = 200;
const ITEM_ERROR = "Describe what you're selling";

const README_REDDIT_URL = 'https://github.com/AlexanderNicholasIvanov/sellscout#reddit';
const README_EBAY_URL = 'https://github.com/AlexanderNicholasIvanov/sellscout#ebay';

const DELIVERY_OPTIONS: { value: Delivery; label: string }[] = [
  { value: 'ship', label: 'Ship it' },
  { value: 'local', label: 'Local pickup' },
  { value: 'both', label: 'Both' },
];

const deliveryLabel = (delivery: Delivery): string =>
  DELIVERY_OPTIONS.find((opt) => opt.value === delivery)?.label ?? delivery;

// localStorage is looked up on every call, so a getter that throws is caught in saved.ts.
const browserStorage: SavedStorage = {
  getItem: (key) => window.localStorage.getItem(key),
  setItem: (key, value) => window.localStorage.setItem(key, value),
};

/** A shown result, the input that produced it and, for a Run, the record's ids seen before it. */
interface Shown {
  result: SearchResult;
  input: SearchInput;
  /** When the result arrived; post ages are relative to it so rendering stays pure. */
  at: number;
  run?: { id: string; seenPostIds: string[] };
}

function ExternalLink({ href, children }: { href: string | undefined; children: string }) {
  const safe = safeHref(href);
  if (!safe) return null;
  return (
    <a href={safe} target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  );
}

function VenueRow({ venue, searchTerm }: { venue: Venue; searchTerm: string }) {
  return (
    <li className="venue">
      <div className="venue-head">
        <h3 className="venue-name">{venue.name}</h3>
        <span className={`badge badge-${venue.kind}`}>{kindLabel(venue.kind)}</span>
        {venue.aiSuggested === true ? <span className="badge badge-ai">AI suggested</span> : null}
      </div>
      <p className="venue-why">{whyText(venue.why)}</p>
      {venue.feeNote ? <p className="venue-fee">{venue.feeNote}</p> : null}
      {venue.tips.length > 0 ? (
        <details className="venue-tips">
          <summary>Posting tips</summary>
          <ul>
            {venue.tips.map((tip, i) => (
              <li key={i}>{tip}</li>
            ))}
          </ul>
        </details>
      ) : null}
      <p className="venue-links">
        <ExternalLink href={venue.url}>Open board</ExternalLink>
        {/* An AI-suggested subreddit is never searched: it gets the board link only. */}
        {venue.searchUrl && venue.aiSuggested !== true ? (
          <ExternalLink href={venue.searchUrl}>{searchLinkText(searchTerm)}</ExternalLink>
        ) : null}
      </p>
    </li>
  );
}

function PostRow({ post, nowMs, isNew }: { post: BuyerPost; nowMs: number; isNew: boolean }) {
  const href = safeHref(post.url);
  return (
    <li className="post">
      <p className="post-title">
        {isNew ? <span className="badge badge-new">New</span> : null}
        {href ? (
          <a href={href} target="_blank" rel="noopener noreferrer">
            {post.title}
          </a>
        ) : (
          post.title
        )}
      </p>
      <p className="post-meta">{postMetaText(post.subreddit, post.author, post.createdUtc, nowMs)}</p>
      <p className="post-stats">{postStatsText(post.score, post.numComments)}</p>
      {post.snippet !== '' ? <p className="post-snippet">{post.snippet}</p> : null}
    </li>
  );
}

interface BuyersProps {
  buyers: BuyersResult;
  nowMs: number;
  /** The ids of the posts not seen before, for a Run result; null for a form search. */
  newIds: Set<string> | null;
}

function BuyersBody({ buyers, nowMs, newIds }: BuyersProps) {
  switch (buyers.status) {
    case 'ok':
      return (
        <>
          {newIds ? <p className="new-count">{newCountText(newIds.size)}</p> : null}
          {buyers.posts.length > 0 ? (
            <ol className="posts">
              {buyers.posts.map((post) => (
                <PostRow key={post.id} post={post} nowMs={nowMs} isNew={newIds?.has(post.id) ?? false} />
              ))}
            </ol>
          ) : (
            <p className="buyers-message">
              No one is asking for this on Reddit in the last {buyers.windowDays} days.
            </p>
          )}
        </>
      );
    case 'unavailable':
      return <p className="buyers-message">Reddit search unavailable: {buyers.reason ?? 'unknown error'}</p>;
    case 'disabled':
      return (
        <p className="buyers-message">
          Add Reddit app keys to see live posts here. See the{' '}
          <a href={README_REDDIT_URL} target="_blank" rel="noopener noreferrer">
            README&apos;s Reddit section
          </a>
          .
        </p>
      );
  }
}

function Buyers({ buyers, nowMs, newIds }: BuyersProps) {
  const links = buyers.links.filter((link) => safeHref(link.url) !== null);
  return (
    <div className="buyers">
      <h2>People looking for it</h2>
      <p className="buyers-searched">{buyersSearchedText(buyers.term, buyers.windowDays)}</p>
      <BuyersBody buyers={buyers} nowMs={nowMs} newIds={newIds} />
      <h3 className="look-yourself">Look yourself</h3>
      {links.length > 0 ? (
        <ul className="look-links">
          {links.map((link, i) => (
            <li key={i}>
              <ExternalLink href={link.url}>{link.label}</ExternalLink>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function ListingRow({ listing }: { listing: EbayListing }) {
  const href = safeHref(listing.url);
  return (
    <li className="listing">
      <p className="listing-title">
        {href ? (
          <a href={href} target="_blank" rel="noopener noreferrer">
            {listing.title}
          </a>
        ) : (
          listing.title
        )}
      </p>
      <p className="listing-price">{money(listing.price)}</p>
      {listing.condition !== '' ? <p className="listing-condition">{listing.condition}</p> : null}
    </li>
  );
}

function EbayBody({ ebay }: { ebay: EbayResult }) {
  switch (ebay.status) {
    case 'ok':
      if (ebay.listings.length === 0) return <p className="ebay-message">{ebayNoListingsText(ebay.term)}</p>;
      return (
        <>
          <p className="ebay-range">
            {ebay.priceRange ? priceRangeText(ebay.priceRange) : 'Not enough listings for a price range.'}
          </p>
          <ol className="listings">
            {ebay.listings.map((listing) => (
              <ListingRow key={listing.id} listing={listing} />
            ))}
          </ol>
        </>
      );
    case 'unavailable':
      return <p className="ebay-message">eBay search unavailable: {ebay.reason ?? 'unknown error'}</p>;
    case 'disabled':
      return (
        <p className="ebay-message">
          Add eBay app keys to see similar listings and asking prices. See the{' '}
          <a href={README_EBAY_URL} target="_blank" rel="noopener noreferrer">
            README&apos;s eBay section
          </a>
          .
        </p>
      );
  }
}

/** "Similar listings on eBay": active fixed-price listings and their asking-price range. No images. */
function Ebay({ ebay }: { ebay: EbayResult }) {
  return (
    <div className="ebay">
      <h2>Similar listings on eBay</h2>
      <p className="ebay-searched">{ebaySearchedText(ebay.term)}</p>
      <EbayBody ebay={ebay} />
      <p className="ebay-yourself">
        <ExternalLink href={ebay.searchUrl}>Search eBay yourself</ExternalLink>
      </p>
    </div>
  );
}

interface SaveMessage {
  text: string;
  /** Bumped on every message so a repeated one re-mounts and is announced again. */
  key: number;
}

function Results({
  shown,
  onSave,
  saveMessage,
}: {
  shown: Shown;
  onSave: () => void;
  saveMessage: SaveMessage | null;
}) {
  const { result, at: nowMs, run } = shown;
  // "New" badges and the count line belong to a Run result only.
  const newIds = run ? new Set(newPostIds(result.buyers.posts, run.seenPostIds)) : null;
  return (
    <>
      <p className="understood">{understoodAs(result.plan)}</p>
      <div className="save-row">
        <button type="button" className="secondary" onClick={onSave}>
          Save search
        </button>
        {saveMessage ? (
          <p key={saveMessage.key} role="status" className="save-message">
            {saveMessage.text}
          </p>
        ) : null}
      </div>
      <h2>Where to post it</h2>
      {result.venues.length > 0 ? (
        <ol className="venues">
          {result.venues.map((venue) => (
            <VenueRow key={venue.id} venue={venue} searchTerm={result.plan.searchTerm} />
          ))}
        </ol>
      ) : (
        <p>No boards fit this delivery choice. Try another delivery option.</p>
      )}
      <Buyers buyers={result.buyers} nowMs={nowMs} newIds={newIds} />
      <Ebay ebay={result.ebay} />
    </>
  );
}

function SavedPanel({
  list,
  notice,
  nowMs,
  runDisabled,
  onRun,
  onDelete,
  headingRef,
}: {
  list: SavedSearch[];
  notice: string | null;
  nowMs: number;
  runDisabled: boolean;
  onRun: (record: SavedSearch) => void;
  onDelete: (record: SavedSearch) => void;
  headingRef: RefObject<HTMLHeadingElement | null>;
}) {
  if (list.length === 0 && notice === null) return null;
  return (
    <section className="saved" aria-labelledby="saved-heading">
      <h2 id="saved-heading" ref={headingRef} tabIndex={-1}>
        Saved searches
      </h2>
      {notice !== null ? (
        <p role="status" className="saved-notice">
          {notice}
        </p>
      ) : null}
      {list.length > 0 ? (
        <ul className="saved-list">
          {list.map((record) => (
            <li key={record.id} className="saved-row">
              <div className="saved-text">
                <p className="saved-item">{record.item}</p>
                <p className="saved-meta">
                  {deliveryLabel(record.delivery)} · last {record.window} days
                </p>
                {record.location.trim() !== '' ? <p className="saved-location">{record.location}</p> : null}
                <p className="saved-run">last run {ageText(record.lastRunAt / 1000, nowMs)}</p>
              </div>
              <div className="saved-actions">
                <button
                  type="button"
                  className="secondary"
                  aria-label={`Run "${record.item}"`}
                  disabled={runDisabled}
                  onClick={() => onRun(record)}
                >
                  Run
                </button>
                <button
                  type="button"
                  className="secondary"
                  aria-label={`Delete "${record.item}"`}
                  onClick={() => onDelete(record)}
                >
                  Delete
                </button>
              </div>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

export function App() {
  const [item, setItem] = useState('');
  const [location, setLocation] = useState(loadLocation);
  const [delivery, setDelivery] = useState<Delivery>('both');
  const [buyerWindow, setBuyerWindow] = useState<BuyerWindow>(DEFAULT_BUYER_WINDOW);
  const [chips, setChips] = useState<string[]>([]);
  const [itemError, setItemError] = useState(false);
  // Bumped on every rejected submit so the error alert re-mounts and is announced again.
  const [errorAttempt, setErrorAttempt] = useState(0);
  // Bumped on every search so a repeated, identical notice is re-rendered and re-announced.
  const [searchId, setSearchId] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [shown, setShown] = useState<Shown | null>(null);
  // The saved list is read once, on mount.
  const [boot] = useState(() => ({ ...load(browserStorage), at: Date.now() }));
  const [saved, setSaved] = useState<SavedSearch[]>(boot.list);
  // The latest list, for a Run that finishes after the list changed.
  const savedRef = useRef<SavedSearch[]>(boot.list);
  // "last run" ages are relative to the last time the list changed, so rendering stays pure.
  const [savedNow, setSavedNow] = useState(boot.at);
  // The load-time reset notice stays until reload; a failed write has its own slot.
  const storageNotice = boot.notice ?? null;
  const [writeError, setWriteError] = useState<string | null>(null);
  const [saveMessage, setSaveMessage] = useState<SaveMessage | null>(null);
  const itemRef = useRef<HTMLInputElement>(null);
  const savedHeadingRef = useRef<HTMLHeadingElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => () => abortRef.current?.abort(), []);

  // Header chips are best effort: any failure just leaves them out.
  useEffect(() => {
    const controller = new AbortController();
    void status(controller.signal).then((s) => {
      if (s && !controller.signal.aborted) setChips(statusChips(s));
    });
    return () => controller.abort();
  }, []);

  /** Shows a list that was just written; "last run" ages restart from `nowMs`. */
  function commitList(next: SavedSearch[], nowMs: number) {
    savedRef.current = next;
    setSaved(next);
    setSavedNow(nowMs);
    setWriteError(null);
  }

  /** The one search path, for the form and for Run. `run` marks a Run of a saved search. */
  async function runSearch(input: SearchInput, run?: Shown['run']) {
    setItemError(false);
    setError(null);
    setLoading(true);
    setSearchId((n) => n + 1);
    setSaveMessage(null);
    // Clear the previous notices so the status region changes and announces the new ones.
    setShown((prev) => (prev ? { ...prev, result: { ...prev.result, notices: [] } } : prev));
    if (input.location) saveLocation(input.location);

    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const data = await search(input, controller.signal);
      if (controller.signal.aborted) return;
      const at = Date.now();
      setShown({ result: data, input, at, run });
      if (run) {
        const postIds = data.buyers.posts.map((post) => post.id);
        // undefined: the record was deleted while its search ran, so nothing is written.
        const next = applyRun(savedRef.current, run.id, postIds, at);
        if (next) {
          const failed = write(browserStorage, next);
          if (failed !== null) setWriteError(failed);
          else commitList(next, at);
        }
      }
    } catch (err) {
      if (controller.signal.aborted) return;
      setShown(null);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (loading) return;
    if (item.trim() === '') {
      setItemError(true);
      setErrorAttempt((n) => n + 1);
      itemRef.current?.focus();
      return;
    }
    await runSearch(buildSearchInput(item, location, delivery, buyerWindow));
  }

  function onRun(record: SavedSearch) {
    if (loading) return;
    setItem(record.item);
    setLocation(record.location);
    setDelivery(record.delivery);
    setBuyerWindow(record.window);
    void runSearch(buildSearchInput(record.item, record.location, record.delivery, record.window), {
      id: record.id,
      seenPostIds: record.seenPostIds,
    });
  }

  function onDelete(record: SavedSearch) {
    if (!window.confirm(`Delete the saved search "${record.item}"?`)) return;
    const next = remove(savedRef.current, record.id);
    const failed = write(browserStorage, next);
    if (failed !== null) {
      setWriteError(failed);
      return;
    }
    commitList(next, Date.now());
    // The focused button is gone: keep focus in the panel, or go back to the form when it hides.
    if (next.length > 0) savedHeadingRef.current?.focus();
    else itemRef.current?.focus();
  }

  function onSave() {
    if (!shown) return;
    const show = (text: string) => setSaveMessage((prev) => ({ text, key: (prev?.key ?? 0) + 1 }));
    const now = Date.now();
    const postIds = shown.result.buyers.posts.map((post) => post.id);
    const added = add(savedRef.current, shown.input, postIds, now);
    if ('message' in added) {
      show(added.message);
      return;
    }
    const failed = write(browserStorage, added.list);
    if (failed !== null) {
      show(failed);
      return;
    }
    commitList(added.list, now);
    show(SAVED_MESSAGE);
  }

  return (
    <div className="page">
      <header className="site-header">
        <h1>sellscout</h1>
        <p className="tagline">Find the boards where your item will sell.</p>
        {chips.length > 0 ? (
          <ul className="chips" aria-label="Data sources">
            {chips.map((chip) => (
              <li key={chip} className="chip">
                {chip}
              </li>
            ))}
          </ul>
        ) : null}
      </header>

      <main>
        <form className="search-form" onSubmit={onSubmit} noValidate aria-label="Search for boards">
          <div className="field">
            <label htmlFor="item">What are you selling?</label>
            <input
              ref={itemRef}
              id="item"
              name="item"
              type="text"
              required
              maxLength={ITEM_MAX}
              autoComplete="off"
              placeholder="e.g. Sony A7 III body, low shutter count"
              value={item}
              aria-invalid={itemError ? 'true' : undefined}
              aria-describedby={itemError ? 'item-error' : undefined}
              onChange={(e) => {
                setItem(e.target.value);
                if (itemError && e.target.value.trim() !== '') setItemError(false);
              }}
            />
            {itemError ? (
              <p key={errorAttempt} id="item-error" className="field-error" role="alert">
                {ITEM_ERROR}
              </p>
            ) : null}
          </div>

          <div className="field">
            <label htmlFor="location">Location (optional)</label>
            <input
              id="location"
              name="location"
              type="text"
              maxLength={LOCATION_MAX}
              aria-describedby="location-hint"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
            />
            <p id="location-hint" className="field-hint">
              City or ZIP (US)
            </p>
          </div>

          <fieldset className="field delivery">
            <legend>Delivery</legend>
            <div className="radios">
              {DELIVERY_OPTIONS.map((opt) => (
                <label key={opt.value} className="radio">
                  <input
                    type="radio"
                    name="delivery"
                    value={opt.value}
                    checked={delivery === opt.value}
                    onChange={() => setDelivery(opt.value)}
                  />
                  {opt.label}
                </label>
              ))}
            </div>
          </fieldset>

          <div className="field">
            <label htmlFor="window">Buyer posts from the last</label>
            <select
              id="window"
              name="window"
              value={buyerWindow}
              onChange={(e) => {
                const next = BUYER_WINDOWS.find((w) => String(w) === e.target.value);
                if (next !== undefined) setBuyerWindow(next);
              }}
            >
              {BUYER_WINDOWS.map((w) => (
                <option key={w} value={w}>
                  {w} days
                </option>
              ))}
            </select>
          </div>

          <button type="submit" className="submit" disabled={loading}>
            {loading ? 'Searching...' : 'Search'}
          </button>
        </form>

        <SavedPanel
          list={saved}
          notice={[storageNotice, writeError].filter((n) => n !== null).join(' ') || null}
          nowMs={savedNow}
          runDisabled={loading}
          onRun={onRun}
          onDelete={onDelete}
          headingRef={savedHeadingRef}
        />

        <div role="alert" className="alert-region">
          {error !== null ? <p className="alert">Search failed: {error}</p> : null}
        </div>

        <section className="results" aria-label="Results" aria-busy={loading ? 'true' : 'false'}>
          <div role="status" className="notices">
            {shown && shown.result.notices.length > 0 ? (
              <ul key={searchId}>
                {shown.result.notices.map((notice, i) => (
                  <li key={i}>{notice}</li>
                ))}
              </ul>
            ) : null}
          </div>
          {shown ? <Results shown={shown} onSave={onSave} saveMessage={saveMessage} /> : null}
        </section>
      </main>
    </div>
  );
}
