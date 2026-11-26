import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import type { Delivery, SearchResult, Venue } from '../server/types.ts';
import { buildSearchInput, search } from './api.ts';
import { kindLabel, safeHref, searchLinkText, understoodAs, whyText } from './format.ts';
import { LOCATION_MAX, loadLocation, saveLocation } from './storage.ts';

const ITEM_MAX = 200;
const ITEM_ERROR = "Describe what you're selling";

const DELIVERY_OPTIONS: { value: Delivery; label: string }[] = [
  { value: 'ship', label: 'Ship it' },
  { value: 'local', label: 'Local pickup' },
  { value: 'both', label: 'Both' },
];

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
        {venue.searchUrl ? (
          <ExternalLink href={venue.searchUrl}>{searchLinkText(searchTerm)}</ExternalLink>
        ) : null}
      </p>
    </li>
  );
}

function Results({ result }: { result: SearchResult }) {
  return (
    <>
      <p className="understood">{understoodAs(result.plan)}</p>
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
    </>
  );
}

export function App() {
  const [item, setItem] = useState('');
  const [location, setLocation] = useState(loadLocation);
  const [delivery, setDelivery] = useState<Delivery>('both');
  const [itemError, setItemError] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<SearchResult | null>(null);
  const itemRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => () => abortRef.current?.abort(), []);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (loading) return;
    if (item.trim() === '') {
      setItemError(true);
      itemRef.current?.focus();
      return;
    }
    setItemError(false);
    setError(null);
    setLoading(true);
    const input = buildSearchInput(item, location, delivery);
    if (input.location) saveLocation(input.location);

    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const data = await search(input, controller.signal);
      if (controller.signal.aborted) return;
      setResult(data);
    } catch (err) {
      if (controller.signal.aborted) return;
      setResult(null);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }

  return (
    <div className="page">
      <header className="site-header">
        <h1>sellscout</h1>
        <p className="tagline">Find the boards where your item will sell.</p>
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
              <p id="item-error" className="field-error">
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

          <button type="submit" className="submit" disabled={loading}>
            {loading ? 'Searching...' : 'Search'}
          </button>
        </form>

        <div role="alert" className="alert-region">
          {error !== null ? <p className="alert">Search failed: {error}</p> : null}
        </div>

        <section className="results" aria-label="Results" aria-busy={loading ? 'true' : 'false'}>
          <div role="status" className="notices">
            {result && result.notices.length > 0 ? (
              <ul>
                {result.notices.map((notice, i) => (
                  <li key={i}>{notice}</li>
                ))}
              </ul>
            ) : null}
          </div>
          {result ? <Results result={result} /> : null}
        </section>
      </main>
    </div>
  );
}
