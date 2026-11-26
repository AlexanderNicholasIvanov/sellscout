// Pure merging of the environment and the saved values (spec "Which value wins").
import { DEFAULT_CLAUDE_MODEL } from '../config.ts';
import type { AppConfig } from '../config.ts';
import type { SettingKey, SettingsResponse, SettingState, SettingsUpdate } from '../types.ts';
import { isSecretSetting, SETTING_KEYS } from './keys.ts';
import type { SettingValues } from './store.ts';

type Env = Record<string, string | undefined>;

const envValue = (env: Env, key: SettingKey): string => (typeof env[key] === 'string' ? env[key].trim() : '');

/**
 * The environment `readConfig` reads: the environment as given, plus each saved value whose key
 * has no non-empty value in the environment. Only the 7 keys come from the file; fixture mode,
 * PORT and the rest stay as the environment says, with SELLSCOUT_FIXTURES forced to exactly '1'
 * or '' (as prepareConfig does).
 */
export function mergedEnv(env: Env, values: SettingValues): Env {
  const merged: Env = { ...env, SELLSCOUT_FIXTURES: env.SELLSCOUT_FIXTURES === '1' ? '1' : '' };
  for (const key of SETTING_KEYS) {
    const saved = values[key];
    if (envValue(env, key) === '' && saved !== undefined && saved !== '') merged[key] = saved;
  }
  return merged;
}

function state(key: SettingKey, source: SettingState['source'], value: string): SettingState {
  const secret = isSecretSetting(key);
  return source !== 'none' && !secret ? { source, secret, value } : { source, secret };
}

/** GET /api/settings when the server has a settings file (or null): the environment wins. */
export function settingsResponse(env: Env, values: SettingValues, file: string | null): SettingsResponse {
  const settings = {} as Record<SettingKey, SettingState>;
  for (const key of SETTING_KEYS) {
    const fromEnv = envValue(env, key);
    const saved = values[key] ?? '';
    if (fromEnv !== '') settings[key] = state(key, 'environment', fromEnv);
    else if (saved !== '') settings[key] = state(key, 'settings', saved);
    else settings[key] = state(key, 'none', '');
  }
  return { editable: file !== null, file, settings };
}

/** Each key's value in an injected config ('' when unset; the default model counts as unset). */
function configValue(config: AppConfig, key: SettingKey): string {
  switch (key) {
    case 'ANTHROPIC_API_KEY':
      return config.claude.apiKey;
    case 'SELLSCOUT_CLAUDE_MODEL':
      return config.claude.model === DEFAULT_CLAUDE_MODEL ? '' : config.claude.model;
    case 'EBAY_CLIENT_ID':
      return config.ebay.clientId;
    case 'EBAY_CLIENT_SECRET':
      return config.ebay.clientSecret;
    case 'REDDIT_CLIENT_ID':
      return config.reddit.clientId;
    case 'REDDIT_CLIENT_SECRET':
      return config.reddit.clientSecret;
    case 'REDDIT_USERNAME':
      return config.reddit.username;
  }
}

/** GET /api/settings for a server started without `settings`: read-only, sources from the config. */
export function readOnlySettingsResponse(config: AppConfig): SettingsResponse {
  const settings = {} as Record<SettingKey, SettingState>;
  for (const key of SETTING_KEYS) {
    const value = configValue(config, key).trim();
    settings[key] = state(key, value === '' ? 'none' : 'environment', value);
  }
  return { editable: false, file: null, settings };
}

/**
 * The saved values after a validated update: a non-empty string (already trimmed) saves it,
 * null or '' removes it, and a key left out keeps its value.
 */
export function applySettingsUpdate(values: SettingValues, update: SettingsUpdate['values']): SettingValues {
  const next: SettingValues = { ...values };
  for (const key of SETTING_KEYS) {
    if (!Object.hasOwn(update, key)) continue;
    const value = update[key];
    if (typeof value === 'string' && value.trim() !== '') next[key] = value.trim();
    else delete next[key];
  }
  return next;
}
