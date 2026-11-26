export const LOCATION_KEY = 'sellscout.location.v1';
export const LOCATION_MAX = 100;

/** Returns the stored location, or '' when storage is missing, unreadable or corrupt. */
export function loadLocation(): string {
  try {
    const raw = window.localStorage.getItem(LOCATION_KEY);
    if (raw === null) return '';
    const value: unknown = JSON.parse(raw);
    if (typeof value !== 'string' || value.length > LOCATION_MAX) return '';
    return value;
  } catch {
    return '';
  }
}

/** Stores a non-blank location; storage failures are ignored. */
export function saveLocation(location: string): void {
  const value = location.trim();
  if (value === '' || value.length > LOCATION_MAX) return;
  try {
    window.localStorage.setItem(LOCATION_KEY, JSON.stringify(value));
  } catch {
    // Storage full, disabled or blocked: the location is simply not remembered.
  }
}
