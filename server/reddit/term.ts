// The Reddit search term derived from the item (spec "Buyer term").
import { fold } from '../venues/text.ts';

export const STOP_WORDS: ReadonlySet<string> = new Set([
  'a', 'an', 'the', 'and', 'or', 'for', 'with', 'of', 'in', 'on', 'to', 'my', 'your',
  'body', 'new', 'used', 'like', 'mint', 'condition',
]);

const MAX_TOKENS = 6;
const MAX_CHARS = 80;

/** Everything before the first `,` `;` `(` `|` or ` - `. */
function cut(item: string): string {
  const match = /[,;(|]|\s-\s/.exec(item);
  return match ? item.slice(0, match.index) : item;
}

function words(text: string): string[] {
  return text.split(/\s+/).filter((word) => word !== '');
}

/** At most 6 tokens and 80 characters, joined with single spaces. */
function limit(tokens: string[]): string {
  let term = '';
  for (const token of tokens.slice(0, MAX_TOKENS)) {
    const next = term === '' ? token : `${term} ${token}`;
    if (next.length > MAX_CHARS) {
      // A single over-long first token is cut rather than dropped, so the term is never empty.
      if (term === '') term = token.slice(0, MAX_CHARS);
      break;
    }
    term = next;
  }
  return term;
}

export function buyerTerm(item: string): string {
  const head = cut(item);
  const kept = words(head).filter((word) => !STOP_WORDS.has(fold(word)));
  if (kept.length > 0) return limit(kept);
  const headWords = words(head);
  if (headWords.length > 0) return limit(headWords);
  return limit(words(item));
}

/** Strips punctuation at the edges of a token, so `"Q1!"` matches `q1`. */
function trimToken(token: string): string {
  return token.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
}

/**
 * The folded tokens the classifier looks for: those of 2+ characters that are not stop words,
 * or every token when none qualifies.
 */
export function significantTokens(term: string): string[] {
  const all = words(fold(term)).map(trimToken).filter((token) => token !== '');
  const significant = all.filter((token) => [...token].length >= 2 && !STOP_WORDS.has(token));
  return significant.length > 0 ? significant : all;
}
