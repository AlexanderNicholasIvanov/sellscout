// Where the Settings screen saves keys. `npm start` and the desktop app share the same file.
import { homedir } from 'node:os';
import { join } from 'node:path';

export const SETTINGS_FILE_NAME = 'settings.json';

/** The per-user config folder for sellscout on this platform (the desktop app's userData folder). */
export function defaultSettingsDir(
  env: Record<string, string | undefined>,
  platform: NodeJS.Platform = process.platform,
  home: string = homedir(),
): string {
  if (platform === 'win32') return join(env.APPDATA || join(home, 'AppData', 'Roaming'), 'sellscout');
  if (platform === 'darwin') return join(home, 'Library', 'Application Support', 'sellscout');
  return join(env.XDG_CONFIG_HOME || join(home, '.config'), 'sellscout');
}

/**
 * `SELLSCOUT_SETTINGS_FILE` when non-empty; otherwise null (read-only) in fixture mode or when
 * NODE_ENV is `test`, so tests never touch the user's real file; otherwise the default folder.
 */
export function resolveSettingsFile(
  env: Record<string, string | undefined>,
  platform: NodeJS.Platform = process.platform,
  home: string = homedir(),
): string | null {
  const explicit = env.SELLSCOUT_SETTINGS_FILE?.trim();
  if (explicit) return explicit;
  if (env.SELLSCOUT_FIXTURES === '1' || env.NODE_ENV === 'test') return null;
  return join(defaultSettingsDir(env, platform, home), SETTINGS_FILE_NAME);
}
