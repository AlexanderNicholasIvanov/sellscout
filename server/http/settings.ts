// Body parsing for PUT /api/settings (spec "Settings API"). Error strings are shown to the user as-is.
import { SETTING_KEYS, SETTING_VALUE_MAX } from '../settings/keys.ts';
import type { SettingKey, SettingsUpdate } from '../types.ts';
import { charLength, isRecord } from './validate.ts';
import type { Validation } from './validate.ts';

/** How much of an unknown key the error message quotes. */
export const UNKNOWN_KEY_QUOTE_MAX = 40;

export const SETTINGS_ERRORS = {
  json: 'Body must be JSON',
  shape: 'Body must be {"values": {...}}',
  unknown: (key: string): string => `Unknown setting: ${Array.from(key).slice(0, UNKNOWN_KEY_QUOTE_MAX).join('')}`,
  type: (key: SettingKey): string => `${key} must be a string or null`,
  tooLong: (key: SettingKey): string => `${key} is too long (max ${SETTING_VALUE_MAX} characters)`,
  singleLine: (key: SettingKey): string => `${key} must be a single line`,
  readOnly: 'Settings are read-only here; set keys in .env or the environment',
  forbiddenOrigin: 'Forbidden origin',
  saveFailed: "Couldn't save settings",
} as const;

// eslint-disable-next-line no-control-regex
const CONTROL_CHARACTER = /[\u0000-\u001f\u007f]/;

const isSettingKey = (key: string): key is SettingKey => (SETTING_KEYS as readonly string[]).includes(key);

/**
 * Parses and checks a PUT /api/settings body. Strings come back trimmed, and '' becomes null
 * (remove); keys left out are left out. A control character anywhere in the value (even one
 * trimming would drop) is refused. The first problem, in body order, is the error.
 */
export function parseSettingsUpdate(text: string): Validation<SettingsUpdate['values']> {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return { ok: false, error: SETTINGS_ERRORS.json };
  }
  if (!isRecord(data) || !isRecord(data.values)) return { ok: false, error: SETTINGS_ERRORS.shape };

  const values: SettingsUpdate['values'] = {};
  for (const [key, value] of Object.entries(data.values)) {
    if (!isSettingKey(key)) return { ok: false, error: SETTINGS_ERRORS.unknown(key) };
    if (value === null) {
      values[key] = null;
      continue;
    }
    if (typeof value !== 'string') return { ok: false, error: SETTINGS_ERRORS.type(key) };
    const trimmed = value.trim();
    if (charLength(trimmed) > SETTING_VALUE_MAX) return { ok: false, error: SETTINGS_ERRORS.tooLong(key) };
    if (CONTROL_CHARACTER.test(value)) return { ok: false, error: SETTINGS_ERRORS.singleLine(key) };
    values[key] = trimmed === '' ? null : trimmed;
  }
  return { ok: true, value: values };
}
