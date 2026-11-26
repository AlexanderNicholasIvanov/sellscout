import type { Metro } from '../types.ts';

// US states (and DC): a trailing abbreviation or name is ignored when matching a city.
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

/** Lower-case, drop periods ("st. louis", "d.c."), turn commas into spaces, collapse whitespace. */
export function normalizePlace(text: string): string {
  return text.toLowerCase().replace(/\./g, '').replace(/[,;]/g, ' ').replace(/\s+/g, ' ').trim();
}

/** Candidate city strings for a normalized place, most specific first. */
function candidates(place: string): string[] {
  const out = [place];
  for (const [abbr, name] of STATES) {
    for (const suffix of [name, abbr]) {
      if (!place.endsWith(` ${suffix}`)) continue;
      const base = place.slice(0, -(suffix.length + 1)).trim();
      if (!base) continue;
      // "arlington virginia" -> "arlington va" (for state-qualified aliases), then "arlington".
      out.push(`${base} ${abbr}`, base);
    }
  }
  return out;
}

export type MetroResolver = (location: string) => Metro | undefined;

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
    for (const candidate of candidates(place)) {
      const metro = byAlias.get(candidate);
      if (metro) return metro;
    }
    return undefined;
  };
}
