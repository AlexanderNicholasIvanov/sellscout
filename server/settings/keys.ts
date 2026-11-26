// The keys the Settings screen can save, in display order. Shared by the server and the UI.
import type { SettingKey } from '../types.ts';

export const SETTING_KEYS: readonly SettingKey[] = [
  'ANTHROPIC_API_KEY',
  'SELLSCOUT_CLAUDE_MODEL',
  'EBAY_CLIENT_ID',
  'EBAY_CLIENT_SECRET',
  'REDDIT_CLIENT_ID',
  'REDDIT_CLIENT_SECRET',
  'REDDIT_USERNAME',
];

/** Write-only keys: the server reports only whether they are set, never the value. */
export const SECRET_SETTING_KEYS: readonly SettingKey[] = [
  'ANTHROPIC_API_KEY',
  'EBAY_CLIENT_ID',
  'EBAY_CLIENT_SECRET',
  'REDDIT_CLIENT_ID',
  'REDDIT_CLIENT_SECRET',
];

export const isSecretSetting = (key: SettingKey): boolean => SECRET_SETTING_KEYS.includes(key);

/** The longest value PUT /api/settings accepts, after trimming. */
export const SETTING_VALUE_MAX = 500;
