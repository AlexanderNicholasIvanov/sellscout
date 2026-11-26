/** The desktop window's origin (the `sellscout://app` scheme proxied to this server). */
export const DESKTOP_ORIGIN = 'sellscout://app';

/**
 * Local CSRF guard for state-changing routes: a request with no Origin header passes; one with an
 * Origin must come from this server's own page on loopback, or from the desktop window.
 */
export function isAllowedOrigin(origin: string | undefined, port: number): boolean {
  if (origin === undefined) return true;
  return origin === `http://127.0.0.1:${port}` || origin === `http://localhost:${port}` || origin === DESKTOP_ORIGIN;
}
