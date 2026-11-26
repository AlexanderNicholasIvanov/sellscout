import type {
  BuyerPost,
  BuyersResult,
  BuyerWindow,
  Delivery,
  EbayListing,
  EbayResult,
  ErrorResponse,
  FallbackLink,
  PriceRange,
  SearchInput,
  SearchPlan,
  SearchResult,
  SettingKey,
  SettingsResponse,
  SettingState,
  SettingsUpdate,
  StatusResponse,
  Venue,
} from '../server/types.ts';
import { SETTING_KEYS, isSecretSetting } from '../server/settings/keys.ts';

export const BUYER_WINDOWS: readonly BuyerWindow[] = [7, 30, 90];
export const DEFAULT_BUYER_WINDOW: BuyerWindow = 30;

export class SearchError extends Error {}

function isErrorResponse(value: unknown): value is ErrorResponse {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { error?: unknown }).error === 'string' &&
    (value as ErrorResponse).error !== ''
  );
}

const BUYER_STATUSES: readonly string[] = ['ok', 'unavailable', 'disabled'];

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isBuyerPost(value: unknown): value is BuyerPost {
  return (
    isObject(value) &&
    typeof value.id === 'string' &&
    typeof value.title === 'string' &&
    typeof value.subreddit === 'string' &&
    typeof value.author === 'string' &&
    typeof value.createdUtc === 'number' &&
    typeof value.score === 'number' &&
    typeof value.numComments === 'number' &&
    typeof value.snippet === 'string' &&
    typeof value.url === 'string'
  );
}

function isFallbackLink(value: unknown): value is FallbackLink {
  return isObject(value) && typeof value.label === 'string' && typeof value.url === 'string';
}

function isBuyersResult(value: unknown): value is BuyersResult {
  if (!isObject(value)) return false;
  return (
    typeof value.status === 'string' &&
    BUYER_STATUSES.includes(value.status) &&
    (value.reason === undefined || typeof value.reason === 'string') &&
    typeof value.term === 'string' &&
    typeof value.windowDays === 'number' &&
    (BUYER_WINDOWS as readonly number[]).includes(value.windowDays) &&
    Array.isArray(value.posts) &&
    value.posts.every(isBuyerPost) &&
    Array.isArray(value.links) &&
    value.links.every(isFallbackLink)
  );
}

const EBAY_STATUSES: readonly string[] = ['ok', 'unavailable', 'disabled'];

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isEbayListing(value: unknown): value is EbayListing {
  return (
    isObject(value) &&
    typeof value.id === 'string' &&
    typeof value.title === 'string' &&
    isFiniteNumber(value.price) &&
    typeof value.condition === 'string' &&
    typeof value.url === 'string'
  );
}

function isPriceRange(value: unknown): value is PriceRange {
  return (
    isObject(value) &&
    isFiniteNumber(value.count) &&
    isFiniteNumber(value.p25) &&
    isFiniteNumber(value.median) &&
    isFiniteNumber(value.p75)
  );
}

function isEbayResult(value: unknown): value is EbayResult {
  if (!isObject(value)) return false;
  return (
    typeof value.status === 'string' &&
    EBAY_STATUSES.includes(value.status) &&
    (value.reason === undefined || typeof value.reason === 'string') &&
    typeof value.term === 'string' &&
    typeof value.searchUrl === 'string' &&
    Array.isArray(value.listings) &&
    value.listings.every(isEbayListing) &&
    (value.priceRange === undefined || isPriceRange(value.priceRange)) &&
    // Fields that only go with one status: a reason only when unavailable, listings and a
    // range only when ok.
    (value.status === 'unavailable') === (typeof value.reason === 'string') &&
    (value.status === 'ok' || (value.listings.length === 0 && value.priceRange === undefined))
  );
}

const PLAN_SOURCES: readonly string[] = ['claude', 'catalog'];

function isSearchPlan(value: unknown): value is SearchPlan {
  return (
    isObject(value) &&
    typeof value.source === 'string' &&
    PLAN_SOURCES.includes(value.source) &&
    Array.isArray(value.categories) &&
    typeof value.searchTerm === 'string'
  );
}

const VENUE_KINDS: readonly string[] = ['marketplace', 'subreddit', 'forum', 'facebook', 'local-classifieds'];

const isStrings = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((entry) => typeof entry === 'string');

const isOptionalString = (value: unknown): boolean => value === undefined || typeof value === 'string';

/** Every field the venue row reads; `aiSuggested` is either absent or exactly `true`. */
function isVenue(value: unknown): value is Venue {
  return (
    isObject(value) &&
    typeof value.id === 'string' &&
    typeof value.name === 'string' &&
    typeof value.kind === 'string' &&
    VENUE_KINDS.includes(value.kind) &&
    typeof value.url === 'string' &&
    isOptionalString(value.searchUrl) &&
    isOptionalString(value.feeNote) &&
    typeof value.ships === 'boolean' &&
    typeof value.local === 'boolean' &&
    isStrings(value.tips) &&
    isStrings(value.why) &&
    isStrings(value.categoryIds) &&
    (value.aiSuggested === undefined || value.aiSuggested === true)
  );
}

export function isSearchResult(value: unknown): value is SearchResult {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Partial<SearchResult>;
  return (
    isSearchPlan(v.plan) &&
    Array.isArray(v.venues) &&
    v.venues.every(isVenue) &&
    isBuyersResult(v.buyers) &&
    isEbayResult(v.ebay) &&
    Array.isArray(v.notices)
  );
}

/** Builds the request body; a blank location is omitted. */
export function buildSearchInput(
  item: string,
  location: string,
  delivery: Delivery,
  window: BuyerWindow = DEFAULT_BUYER_WINDOW,
): SearchInput {
  const input: SearchInput = { item: item.trim(), delivery, window };
  const loc = location.trim();
  if (loc !== '') input.location = loc;
  return input;
}

/** POSTs to /api/search. Throws SearchError with a user-facing message on any failure. */
export async function search(input: SearchInput, signal?: AbortSignal): Promise<SearchResult> {
  let res: Response;
  try {
    res = await fetch('/api/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
      signal,
    });
  } catch (err) {
    throw new SearchError(err instanceof Error && err.message ? err.message : 'Network error');
  }

  let body: unknown = undefined;
  try {
    body = await res.json();
  } catch {
    // Not JSON; handled below.
  }

  if (!res.ok) {
    if (isErrorResponse(body)) throw new SearchError(body.error);
    throw new SearchError(res.statusText || `HTTP ${res.status}`);
  }
  if (!isSearchResult(body)) throw new SearchError('Unexpected response from server');
  return body;
}

/** A status body; `claude` may be missing (a server older than run 4) but not another type. */
function isStatusResponse(value: unknown): value is Omit<StatusResponse, 'claude'> & { claude?: boolean } {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Partial<StatusResponse>;
  return (
    typeof v.version === 'string' &&
    typeof v.redditAuth === 'boolean' &&
    typeof v.fixtures === 'boolean' &&
    typeof v.ebay === 'boolean' &&
    (v.claude === undefined || typeof v.claude === 'boolean')
  );
}

/**
 * GETs /api/status. Resolves to null on any failure or a malformed body; never throws. A body
 * without `claude` reads as `claude: false`.
 */
export async function status(signal?: AbortSignal): Promise<StatusResponse | null> {
  try {
    const res = await fetch('/api/status', { signal });
    if (!res.ok) return null;
    const body: unknown = await res.json();
    return isStatusResponse(body) ? { ...body, claude: body.claude === true } : null;
  } catch {
    return null;
  }
}

// Settings screen (run 5): GET / PUT /api/settings.

export class SettingsError extends Error {}

/** The message for a save that got no usable answer: a network failure, bad JSON or a bad body. */
export const NO_ANSWER = 'no answer from the server';

const SETTING_SOURCES: readonly string[] = ['environment', 'settings', 'none'];

/** One key's state. A secret key never carries a value: a body that has one is rejected. */
function isSettingState(key: SettingKey, value: unknown): value is SettingState {
  return (
    isObject(value) &&
    typeof value.source === 'string' &&
    SETTING_SOURCES.includes(value.source) &&
    typeof value.secret === 'boolean' &&
    isOptionalString(value.value) &&
    !((value.secret || isSecretSetting(key)) && value.value !== undefined)
  );
}

/** All 7 keys present and valid; `file` is a string exactly when the settings are editable. */
export function isSettingsResponse(value: unknown): value is SettingsResponse {
  if (!isObject(value)) return false;
  const { editable, file, settings } = value;
  return (
    typeof editable === 'boolean' &&
    (file === null || typeof file === 'string') &&
    editable === (file !== null) &&
    isObject(settings) &&
    SETTING_KEYS.every((key) => isSettingState(key, settings[key]))
  );
}

/** GETs /api/settings. Throws SettingsError on any failure or a malformed body. */
export async function getSettings(signal?: AbortSignal): Promise<SettingsResponse> {
  let body: unknown;
  try {
    const res = await fetch('/api/settings', { signal });
    if (!res.ok) throw new SettingsError(`HTTP ${res.status}`);
    body = await res.json();
  } catch (err) {
    if (err instanceof SettingsError) throw err;
    throw new SettingsError(NO_ANSWER);
  }
  if (!isSettingsResponse(body)) throw new SettingsError('Unexpected response from server');
  return body;
}

/**
 * PUTs the changed values to /api/settings and resolves to the new settings. Throws SettingsError
 * with the server's `error`, or with NO_ANSWER on a network failure or an unreadable answer.
 */
export async function saveSettings(values: SettingsUpdate['values']): Promise<SettingsResponse> {
  const update: SettingsUpdate = { values };
  let res: Response;
  let body: unknown;
  try {
    res = await fetch('/api/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(update),
    });
    body = await res.json();
  } catch {
    throw new SettingsError(NO_ANSWER);
  }
  if (!res.ok) throw new SettingsError(isErrorResponse(body) ? body.error : NO_ANSWER);
  if (!isSettingsResponse(body)) throw new SettingsError(NO_ANSWER);
  return body;
}
