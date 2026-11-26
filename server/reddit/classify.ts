// Which Reddit posts are from people who want to buy the item (spec "Classification").
import type { BuyerPost, BuyerWindow } from '../types.ts';
import { fold } from '../venues/text.ts';
import { snippet } from './snippet.ts';
import { significantTokens } from './term.ts';

export const MAX_POSTS = 50;

const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Folded, whitespace collapsed. */
const norm = (text: string): string => fold(text).replace(/\s+/g, ' ');

function hasWord(folded: string, token: string): boolean {
  return new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(token)}(?![\\p{L}\\p{N}])`, 'u').test(folded);
}

/**
 * The item appears in a text when at least max(1, ceil(n/2)) of the term's n significant tokens
 * occur in it as words, or inside the text with spaces removed ("a7iii" contains "a7" and "iii").
 */
export function itemAppears(term: string, text: string): boolean {
  const tokens = significantTokens(term);
  if (tokens.length === 0) return false;
  const folded = norm(text);
  const squashed = folded.replace(/\s/g, '');
  const needed = Math.max(1, Math.ceil(tokens.length / 2));
  const found = tokens.filter((token) => hasWord(folded, token) || squashed.includes(token)).length;
  return found >= needed;
}

const INTENT = /(?<![\p{L}\p{N}])(?:wtb|looking for|want to buy|wanted|in search of)(?![\p{L}\p{N}])/u;
/** Upper-case ISO in the original text, not followed by an optional space and a digit ("ISO 6400"). */
const ISO = /(?<![\p{L}\p{N}])ISO(?![\p{L}\p{N}])(?!\s?\d)/u;
const SELL_MARKER = /^\s*(?:\[fs\]|(?:wts|fs|for sale|selling)(?![\p{L}\p{N}]))/u;

export function hasBuyIntent(text: string): boolean {
  return INTENT.test(norm(text)) || ISO.test(text);
}

export function startsWithSellMarker(title: string): boolean {
  return SELL_MARKER.test(norm(title));
}

/** The `[H]` and `[W]` parts of a trade title, or undefined when it lacks either marker. */
export function tradeParts(title: string): { have: string; want: string } | undefined {
  // Positions in the original title: lower-casing can change the length ("İ" becomes 2 units).
  const h = /\[h\]/i.exec(title)?.index ?? -1;
  const w = /\[w\]/i.exec(title)?.index ?? -1;
  if (h < 0 || w < 0) return undefined;
  return h < w
    ? { have: title.slice(h + 3, w), want: title.slice(w + 3) }
    : { want: title.slice(w + 3, h), have: title.slice(h + 3) };
}

export function isBuyerPost(term: string, title: string, body: string): boolean {
  const trade = tradeParts(title);
  if (trade) return itemAppears(term, trade.want) && !itemAppears(term, trade.have);
  return (
    (hasBuyIntent(title) || hasBuyIntent(body)) &&
    (itemAppears(term, title) || itemAppears(term, body)) &&
    !startsWithSellMarker(title)
  );
}

interface RawPost {
  id: string; title: string; selftext: string; subreddit: string; author: string;
  createdUtc: number; score: number; numComments: number; permalink: string;
  over18: boolean; stickied: boolean;
}

const str = (value: unknown): string => (typeof value === 'string' ? value : '');
const num = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) ? value : 0);

/** One listing child as a post, or undefined when it is not a usable link post. */
function readChild(child: unknown): RawPost | undefined {
  if (typeof child !== 'object' || child === null) return undefined;
  const data = (child as { data?: unknown }).data;
  if (typeof data !== 'object' || data === null) return undefined;
  const d = data as Record<string, unknown>;
  if (typeof d.id !== 'string' || d.id === '' || typeof d.title !== 'string') return undefined;
  if (typeof d.permalink !== 'string' || typeof d.created_utc !== 'number' || !Number.isFinite(d.created_utc)) return undefined;
  return {
    id: d.id,
    title: d.title,
    selftext: str(d.selftext),
    subreddit: str(d.subreddit),
    author: str(d.author),
    createdUtc: d.created_utc,
    score: num(d.score),
    numComments: num(d.num_comments),
    permalink: d.permalink,
    over18: d.over_18 === true,
    stickied: d.stickied === true,
  };
}

/**
 * The buyer posts among the listing children of every successful request, in request order:
 * NSFW, stickied, deleted-author, non-/r/ permalink, duplicate and out-of-window posts are
 * dropped, the rest classified, sorted newest first, max 50.
 */
export function buyerPosts(children: unknown[], term: string, windowDays: BuyerWindow, nowMs: number): BuyerPost[] {
  const oldest = nowMs / 1000 - windowDays * 86_400;
  const seen = new Set<string>();
  const posts: BuyerPost[] = [];
  for (const child of children) {
    const post = readChild(child);
    if (!post || seen.has(post.id)) continue;
    seen.add(post.id);
    if (post.over18 || post.stickied || post.author === '[deleted]') continue;
    if (!post.permalink.startsWith('/r/') || post.createdUtc < oldest) continue;
    if (!isBuyerPost(term, post.title, post.selftext)) continue;
    posts.push({
      id: post.id,
      title: post.title,
      subreddit: post.subreddit,
      author: post.author,
      createdUtc: post.createdUtc,
      score: post.score,
      numComments: post.numComments,
      snippet: snippet(post.selftext),
      url: `https://www.reddit.com${post.permalink}`,
    });
  }
  return posts.sort((a, b) => b.createdUtc - a.createdUtc).slice(0, MAX_POSTS);
}
