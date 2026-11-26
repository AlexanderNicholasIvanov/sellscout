// AC27: unit tests never reach the network. Any fetch to a host other than the loopback test
// servers rejects, so a test that forgets to inject `fetch` fails instead of calling Reddit.
const realFetch = globalThis.fetch;
const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]']);

function urlOf(input: Parameters<typeof fetch>[0]): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

globalThis.fetch = (input, init) => {
  const url = urlOf(input);
  let host = '';
  try {
    host = new URL(url).hostname;
  } catch {
    // Not an absolute URL: refused below.
  }
  if (!LOCAL_HOSTS.has(host)) {
    return Promise.reject(new Error(`Network access in unit tests is blocked: ${url}`));
  }
  return realFetch(input, init);
};
