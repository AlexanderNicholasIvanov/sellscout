// Pure helpers for the desktop main process. No `electron` import, so vitest can test them.

/** The privileged scheme the window loads from; its one host is `app`. */
export const APP_SCHEME = 'sellscout';
export const APP_HOST = 'app';
/** What the window loads. The browser storage keeps this one origin whatever port the server gets. */
export const APP_URL = `${APP_SCHEME}://${APP_HOST}/`;
/** The window's origin, sent to the server as `Origin` on every non-GET request (u1's Origin check allows it). */
export const APP_ORIGIN = `${APP_SCHEME}://${APP_HOST}`;

function parse(url: string): URL | null {
  try {
    return new URL(url);
  } catch {
    return null;
  }
}

function isAppParsed(url: URL): boolean {
  return url.protocol === `${APP_SCHEME}:` && url.host === APP_HOST && url.username === '' && url.password === '';
}

/** True for `sellscout://app/...`, the only place the window may show. */
export function isAppUrl(url: string): boolean {
  const parsed = parse(url);
  return parsed !== null && isAppParsed(parsed);
}

/**
 * Maps `sellscout://app/<path>?<query>` to `http://127.0.0.1:<port>/<path>?<query>`. Any other
 * scheme or host (or a URL that doesn't parse) is null, which the handler answers with a 404.
 * The fragment is never sent.
 */
export function toServerUrl(requestUrl: string, port: number): string | null {
  const parsed = parse(requestUrl);
  if (parsed === null || !isAppParsed(parsed)) return null;
  if (!Number.isInteger(port) || port < 1 || port > 65535) return null;
  const path = parsed.pathname === '' ? '/' : parsed.pathname;
  return `http://127.0.0.1:${port}${path}${parsed.search}`;
}

/** Only `https:` URLs with a host open in the default browser; everything else is denied. */
export function isExternalHttps(url: string): boolean {
  const parsed = parse(url);
  return parsed !== null && parsed.protocol === 'https:' && parsed.hostname !== '';
}

/** The subset of Electron's `BrowserWindowConstructorOptions` the app sets. */
export interface WindowOptions {
  title: string;
  width: number;
  height: number;
  minWidth: number;
  minHeight: number;
  icon: string;
  webPreferences: {
    contextIsolation: boolean;
    nodeIntegration: boolean;
    sandbox: boolean;
    webSecurity: boolean;
    allowRunningInsecureContent: boolean;
  };
}

/** The main window: 1200x860, at least 400x600, sandboxed with no Node and no preload. */
export function windowOptions(iconPath: string): WindowOptions {
  return {
    title: 'sellscout',
    width: 1200,
    height: 860,
    minWidth: 400,
    minHeight: 600,
    icon: iconPath,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
    },
  };
}

/** A copy of `env` without `ELECTRON_RUN_AS_NODE` (any case), so Electron runs as Electron. */
export function withoutRunAsNode(env: Record<string, string | undefined>): Record<string, string | undefined> {
  const copy: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(env)) {
    if (key.toUpperCase() !== 'ELECTRON_RUN_AS_NODE') copy[key] = value;
  }
  return copy;
}
