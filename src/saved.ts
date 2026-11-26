// Saved searches: pure logic over an injected storage, so it unit-tests without a browser.
// The list lives in localStorage under SAVED_KEY as a JSON array, newest saved first.
import type { BuyerWindow, Delivery, SearchInput } from '../server/types.ts';

export const SAVED_KEY = 'sellscout.savedSearches.v1';
export const SAVED_BACKUP_KEY = `${SAVED_KEY}.corrupt`;
export const SAVED_MAX = 50;
export const SEEN_MAX = 500;

export const RESET_NOTICE = "Saved searches couldn't be read and were reset (a backup was kept).";
export const SAVED_MESSAGE = 'Saved';
export const DUPLICATE_MESSAGE = 'Already saved';
export const FULL_MESSAGE = `Delete a saved search first (max ${SAVED_MAX})`;
export const WRITE_FAILED_MESSAGE = "Couldn't save: browser storage is full or blocked";

export interface SavedSearch {
  id: string;
  item: string;
  location: string;
  delivery: Delivery;
  window: BuyerWindow;
  savedAt: number;
  lastRunAt: number;
  seenPostIds: string[];
}

export type SavedStorage = Pick<Storage, 'getItem' | 'setItem'>;

const DELIVERIES: readonly string[] = ['ship', 'local', 'both'];
const WINDOWS: readonly number[] = [7, 30, 90];

function isSavedSearch(value: unknown): value is SavedSearch {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.id === 'string' &&
    typeof v.item === 'string' &&
    typeof v.location === 'string' &&
    typeof v.delivery === 'string' &&
    DELIVERIES.includes(v.delivery) &&
    typeof v.window === 'number' &&
    WINDOWS.includes(v.window) &&
    typeof v.savedAt === 'number' &&
    Number.isFinite(v.savedAt) &&
    typeof v.lastRunAt === 'number' &&
    Number.isFinite(v.lastRunAt) &&
    Array.isArray(v.seenPostIds) &&
    v.seenPostIds.every((id) => typeof id === 'string')
  );
}

function parseList(raw: string): SavedSearch[] | null {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!Array.isArray(value) || value.length > SAVED_MAX || !value.every(isSavedSearch)) return null;
  return value;
}

/**
 * Reads the saved list. Missing data is an empty list. Corrupt data is copied to the backup
 * key, replaced by `[]` and reported with RESET_NOTICE. Unreadable storage is an empty list
 * with no notice. Never throws.
 */
export function load(storage: SavedStorage): { list: SavedSearch[]; notice?: string } {
  let raw: string | null;
  try {
    raw = storage.getItem(SAVED_KEY);
  } catch {
    return { list: [] };
  }
  if (raw === null) return { list: [] };
  const list = parseList(raw);
  if (list) return { list };
  try {
    storage.setItem(SAVED_BACKUP_KEY, raw);
    storage.setItem(SAVED_KEY, '[]');
  } catch {
    // Storage full or blocked: the list is still treated as reset for this page.
  }
  return { list: [], notice: RESET_NOTICE };
}

/** Writes the list. Returns null on success, or WRITE_FAILED_MESSAGE when storage throws. */
export function write(storage: SavedStorage, list: readonly SavedSearch[]): string | null {
  try {
    storage.setItem(SAVED_KEY, JSON.stringify(list));
    return null;
  } catch {
    return WRITE_FAILED_MESSAGE;
  }
}

function sameSearch(record: SavedSearch, item: string, location: string, delivery: Delivery, window: BuyerWindow) {
  return (
    record.item.toLowerCase() === item.toLowerCase() &&
    record.location.toLowerCase() === location.toLowerCase() &&
    record.delivery === delivery &&
    record.window === window
  );
}

/**
 * Adds the search behind a shown result to the front of the list. `postIds` are that result's
 * buyer post ids. Returns the new list, or a message when it is a duplicate or the list is full.
 */
export function add(
  list: readonly SavedSearch[],
  input: SearchInput,
  postIds: readonly string[],
  nowMs: number,
  newId: () => string = () => crypto.randomUUID(),
): { list: SavedSearch[] } | { message: string } {
  const item = input.item.trim();
  const location = (input.location ?? '').trim();
  if (list.some((r) => sameSearch(r, item, location, input.delivery, input.window))) {
    return { message: DUPLICATE_MESSAGE };
  }
  if (list.length >= SAVED_MAX) return { message: FULL_MESSAGE };
  const record: SavedSearch = {
    id: newId(),
    item,
    location,
    delivery: input.delivery,
    window: input.window,
    savedAt: nowMs,
    lastRunAt: nowMs,
    seenPostIds: seenUnion(postIds, []),
  };
  return { list: [record, ...list] };
}

/** The list without the record with this id. */
export function remove(list: readonly SavedSearch[], id: string): SavedSearch[] {
  return list.filter((r) => r.id !== id);
}

/** This run's ids first, then the older ids not already there, without repeats, capped at SEEN_MAX. */
export function seenUnion(current: readonly string[], older: readonly string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const id of [...current, ...older]) {
    if (out.length >= SEEN_MAX) break;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

/**
 * The list after a successful Run of record `id` that returned `postIds`: that record gets the
 * seen union and `lastRunAt = nowMs`. Returns undefined (write nothing) when the id is gone.
 */
export function applyRun(
  list: readonly SavedSearch[],
  id: string,
  postIds: readonly string[],
  nowMs: number,
): SavedSearch[] | undefined {
  if (!list.some((r) => r.id === id)) return undefined;
  return list.map((r) =>
    r.id === id ? { ...r, lastRunAt: nowMs, seenPostIds: seenUnion(postIds, r.seenPostIds) } : r,
  );
}

/** The ids of the posts whose id is not in `seenPostIds`, in post order. */
export function newPostIds(posts: readonly { id: string }[], seenPostIds: readonly string[]): string[] {
  const seen = new Set(seenPostIds);
  return posts.filter((p) => !seen.has(p.id)).map((p) => p.id);
}

/** The line above a Run result's post list. */
export function newCountText(count: number): string {
  if (count === 0) return 'Nothing new since your last run';
  return `${count} new since your last run`;
}
