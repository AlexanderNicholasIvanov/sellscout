import type { Metro } from '../types.ts';
import { fold } from './text.ts';

// US states (and DC): a trailing abbreviation or name names the state the user means.
const STATES: ReadonlyArray<readonly [string, string]> = [
  ['al', 'alabama'], ['ak', 'alaska'], ['az', 'arizona'], ['ar', 'arkansas'], ['ca', 'california'],
  ['co', 'colorado'], ['ct', 'connecticut'], ['de', 'delaware'], ['dc', 'district of columbia'],
  ['fl', 'florida'], ['ga', 'georgia'], ['hi', 'hawaii'], ['id', 'idaho'], ['il', 'illinois'],
  ['in', 'indiana'], ['ia', 'iowa'], ['ks', 'kansas'], ['ky', 'kentucky'], ['la', 'louisiana'],
  ['me', 'maine'], ['md', 'maryland'], ['ma', 'massachusetts'], ['mi', 'michigan'], ['mn', 'minnesota'],
  ['ms', 'mississippi'], ['mo', 'missouri'], ['mt', 'montana'], ['ne', 'nebraska'], ['nv', 'nevada'],
  ['nh', 'new hampshire'], ['nj', 'new jersey'], ['nm', 'new mexico'], ['ny', 'new york'],
  ['nc', 'north carolina'], ['nd', 'north dakota'], ['oh', 'ohio'], ['ok', 'oklahoma'], ['or', 'oregon'],
  ['pa', 'pennsylvania'], ['ri', 'rhode island'], ['sc', 'south carolina'], ['sd', 'south dakota'],
  ['tn', 'tennessee'], ['tx', 'texas'], ['ut', 'utah'], ['vt', 'vermont'], ['va', 'virginia'],
  ['wa', 'washington'], ['wv', 'west virginia'], ['wi', 'wisconsin'], ['wy', 'wyoming'],
];

const ZIP = /^(\d{3})\d{2}(?:-\d{4})?$/;

/**
 * Lower-case, fold diacritics, drop periods ("st. louis", "d.c."), turn commas into spaces and
 * collapse whitespace.
 */
export function normalizePlace(text: string): string {
  return fold(text).replace(/\./g, '').replace(/[,;]/g, ' ').replace(/\s+/g, ' ').trim();
}

/** Ways to read a trailing state: the city part and the 2-letter code ("seattle wa" -> seattle, wa). */
function trailingStates(place: string): { base: string; state: string }[] {
  const out: { base: string; state: string }[] = [];
  for (const [abbr, name] of STATES) {
    for (const suffix of [name, abbr]) {
      if (!place.endsWith(` ${suffix}`)) continue;
      const base = place.slice(0, -(suffix.length + 1)).trim();
      if (base) out.push({ base, state: abbr });
    }
  }
  return out;
}

export type MetroResolver = (location: string) => Metro | undefined;

/**
 * Resolves a US city or ZIP to a metro.
 * - A 5-digit ZIP (or ZIP+4) matches on its first 3 digits.
 * - A city matching an alias exactly matches (aliases may carry a state, e.g. "arlington va").
 * - A city followed by a state ("Seattle, WA", "Seattle Washington") matches the state-qualified
 *   alias if there is one; otherwise the bare city, but only when the metro's state is that state.
 *   "Portland, ME" therefore does not match Portland, OR.
 */
export function createMetroResolver(metros: Metro[]): MetroResolver {
  const byAlias = new Map<string, Metro>();
  const byZip = new Map<string, Metro>();
  for (const metro of metros) {
    for (const alias of [...metro.aliases, metro.name]) {
      const key = normalizePlace(alias);
      if (key && !byAlias.has(key)) byAlias.set(key, metro);
    }
    for (const prefix of metro.zipPrefixes) {
      if (!byZip.has(prefix)) byZip.set(prefix, metro);
    }
  }

  return (location) => {
    const trimmed = location.trim();
    const zip = ZIP.exec(trimmed);
    if (zip) return byZip.get(zip[1]);
    const place = normalizePlace(trimmed);
    if (!place) return undefined;
    const exact = byAlias.get(place);
    if (exact) return exact;
    for (const { base, state } of trailingStates(place)) {
      const qualified = byAlias.get(`${base} ${state}`);
      if (qualified) return qualified;
      const bare = byAlias.get(base);
      if (bare && bare.state.toLowerCase() === state) return bare;
    }
    return undefined;
  };
}
