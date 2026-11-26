// The settings file (spec "Settings file"): `{ "version": 1, "values": { "<KEY>": "<value>" } }`.
// Reading never throws and never logs the content; writing is atomic (temp file + rename).
import { randomBytes } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import type { SettingKey } from '../types.ts';
import { SETTING_KEYS } from './keys.ts';

/** The saved values: only the 7 keys, each a non-empty trimmed string. */
export type SettingValues = Partial<Record<SettingKey, string>>;

export const SETTINGS_FILE_VERSION = 1;
export const SETTINGS_UNREADABLE_MESSAGE = 'sellscout: settings file unreadable; starting with no saved keys';

/** The fs calls the store makes (tests inject fakes). */
export interface SettingsFs {
  readFile: (path: string, encoding: 'utf8') => Promise<string>;
  writeFile: (path: string, data: string, options: { encoding: 'utf8'; mode: number; flag: 'wx' }) => Promise<void>;
  rename: (from: string, to: string) => Promise<void>;
  mkdir: (path: string, options: { recursive: true }) => Promise<unknown>;
  rm: (path: string, options: { force: true }) => Promise<void>;
}

export const nodeSettingsFs: SettingsFs = { readFile, writeFile, rename, mkdir, rm };

export interface ReadDeps {
  fs?: Pick<SettingsFs, 'readFile'>;
  /** Default: console.error. Gets SETTINGS_UNREADABLE_MESSAGE only, never the content. */
  log?: (message: string) => void;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** The 7 known keys with a non-empty string value, trimmed; anything else is dropped. */
export function pickSettingValues(values: Record<string, unknown>): SettingValues {
  const picked: SettingValues = {};
  for (const key of SETTING_KEYS) {
    const value = values[key];
    if (typeof value === 'string' && value.trim() !== '') picked[key] = value.trim();
  }
  return picked;
}

/**
 * The saved values. A missing file is `{}`. An unreadable one (read error, bad JSON, wrong shape)
 * is `{}` plus one log line that never includes the content.
 */
export async function readSettingsFile(file: string, deps: ReadDeps = {}): Promise<SettingValues> {
  const fs = deps.fs ?? nodeSettingsFs;
  const log = deps.log ?? ((message: string) => console.error(message));
  let text: string;
  try {
    text = await fs.readFile(file, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException | undefined)?.code === 'ENOENT') return {};
    log(SETTINGS_UNREADABLE_MESSAGE);
    return {};
  }
  let data: unknown;
  try {
    data = JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text); // a BOM is fine
  } catch {
    log(SETTINGS_UNREADABLE_MESSAGE);
    return {};
  }
  if (!isRecord(data) || data.version !== SETTINGS_FILE_VERSION || !isRecord(data.values)) {
    log(SETTINGS_UNREADABLE_MESSAGE);
    return {};
  }
  return pickSettingValues(data.values);
}

/** The file's text for these values (known keys only, in display order). */
export function serializeSettings(values: SettingValues): string {
  return `${JSON.stringify({ version: SETTINGS_FILE_VERSION, values: pickSettingValues(values) }, null, 2)}\n`;
}

/**
 * Writes the values atomically: the folder is created when missing, the text goes to a new temp
 * file in the same folder (mode 0o600), which is then renamed over the file. On failure the temp
 * file is removed and the error is rethrown (the old file is untouched).
 */
export async function writeSettingsFile(file: string, values: SettingValues, fs: SettingsFs = nodeSettingsFs): Promise<void> {
  const dir = dirname(file);
  await fs.mkdir(dir, { recursive: true });
  const temp = join(dir, `.${basename(file)}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`);
  try {
    await fs.writeFile(temp, serializeSettings(values), { encoding: 'utf8', mode: 0o600, flag: 'wx' });
    await fs.rename(temp, file);
  } catch (err) {
    await fs.rm(temp, { force: true }).catch(() => {});
    throw err;
  }
}
