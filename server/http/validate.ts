import type { BuyerWindow, Delivery, SearchInput } from '../types.ts';

export const ITEM_MAX = 200;
export const LOCATION_MAX = 100;
const DELIVERIES: readonly Delivery[] = ['ship', 'local', 'both'];
const WINDOWS: readonly BuyerWindow[] = [7, 30, 90];
export const DEFAULT_WINDOW: BuyerWindow = 30;

export type Validation<T> = { ok: true; value: T } | { ok: false; error: string };

/** True for `application/json`, optionally followed by `; charset=utf-8`. */
export function isJsonContentType(header: string | undefined): boolean {
  if (header === undefined) return false;
  const [type, ...params] = header.split(';').map((part) => part.trim().toLowerCase());
  if (type !== 'application/json') return false;
  return params.every((param) => param === '' || /^charset\s*=\s*"?utf-8"?$/.test(param));
}

/** Length in characters (code points), so an emoji counts once. */
export const charLength = (s: string): number => Array.from(s).length;

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Parses and checks a POST /api/search body. Error strings are shown to the user as-is. */
export function parseSearchRequest(text: string): Validation<SearchInput> {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return { ok: false, error: 'Body must be JSON' };
  }
  if (!isRecord(data)) return { ok: false, error: 'Body must be a JSON object' };

  const { item, location, delivery, window: windowDays } = data;

  if (item === undefined) return { ok: false, error: "Describe what you're selling (item is required)" };
  if (typeof item !== 'string') return { ok: false, error: 'item must be a string' };
  const trimmedItem = item.trim();
  if (trimmedItem === '') return { ok: false, error: "Describe what you're selling (item is required)" };
  if (charLength(trimmedItem) > ITEM_MAX) return { ok: false, error: `item must be ${ITEM_MAX} characters or fewer` };

  let trimmedLocation: string | undefined;
  if (location !== undefined) {
    if (typeof location !== 'string') return { ok: false, error: 'location must be a string' };
    trimmedLocation = location.trim();
    if (charLength(trimmedLocation) > LOCATION_MAX) {
      return { ok: false, error: `location must be ${LOCATION_MAX} characters or fewer` };
    }
    if (trimmedLocation === '') trimmedLocation = undefined;
  }

  let chosenDelivery: Delivery = 'both';
  if (delivery !== undefined) {
    if (typeof delivery !== 'string' || !(DELIVERIES as readonly string[]).includes(delivery)) {
      return { ok: false, error: 'delivery must be ship, local or both' };
    }
    chosenDelivery = delivery as Delivery;
  }

  let chosenWindow: BuyerWindow = DEFAULT_WINDOW;
  if (windowDays !== undefined) {
    if (typeof windowDays !== 'number' || !(WINDOWS as readonly number[]).includes(windowDays)) {
      return { ok: false, error: 'window must be 7, 30 or 90' };
    }
    chosenWindow = windowDays as BuyerWindow;
  }

  const value: SearchInput = { item: trimmedItem, delivery: chosenDelivery, window: chosenWindow };
  if (trimmedLocation !== undefined) value.location = trimmedLocation;
  return { ok: true, value };
}
