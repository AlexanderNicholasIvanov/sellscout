/**
 * DNS-rebinding guard: the Host header must name this server on loopback, exactly
 * `127.0.0.1:<port>` or `localhost:<port>`.
 */
export function isAllowedHost(host: string | undefined, port: number): boolean {
  return host === `127.0.0.1:${port}` || host === `localhost:${port}`;
}
