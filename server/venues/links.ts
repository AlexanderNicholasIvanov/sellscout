/** URL-encodes a search term. Lone surrogates are replaced first so encoding never throws. */
export function encodeTerm(term: string): string {
  return encodeURIComponent(term.toWellFormed());
}

/** Replaces every `{q}` in a search-URL template with the encoded term. */
export function fillTemplate(template: string, term: string): string {
  return template.split('{q}').join(encodeTerm(term));
}

export function craigslistUrls(subdomain: string, term: string): { url: string; searchUrl: string } {
  const base = `https://${subdomain}.craigslist.org/`;
  return { url: base, searchUrl: `${base}search/sss?query=${encodeTerm(term)}` };
}

export function subredditUrls(name: string, term: string): { url: string; searchUrl: string } {
  const base = `https://www.reddit.com/r/${name}/`;
  return { url: base, searchUrl: `${base}search/?q=${encodeTerm(term)}&restrict_sr=1` };
}
