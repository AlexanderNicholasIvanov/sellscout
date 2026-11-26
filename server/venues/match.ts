import type { Category } from '../types.ts';

// A letter or digit in any script: the "word" characters for keyword boundaries.
const WORD_CHAR = '[\\p{L}\\p{N}]';

interface CompiledKeyword {
  keyword: string;
  pattern: RegExp;
}

export interface CompiledCategory {
  category: Category;
  index: number;
  keywords: CompiledKeyword[];
}

export interface CategoryMatch {
  category: Category;
  index: number;
  score: number;
  keywords: string[];
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Builds a case-insensitive pattern for one keyword: words of a multi-word keyword match as a
 * phrase (any whitespace between them), the last word may take a simple plural ("s" / "es"),
 * and the match must not touch another letter or digit on either side (word boundary).
 */
export function keywordPattern(keyword: string): RegExp | undefined {
  const words = keyword.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return undefined;
  const body = words.map(escapeRegExp).join('\\s+');
  return new RegExp(`(?<!${WORD_CHAR})${body}(?:e?s)?(?!${WORD_CHAR})`, 'iu');
}

export function compileCategories(categories: Category[]): CompiledCategory[] {
  return categories.map((category, index) => {
    const seen = new Set<string>();
    const keywords: CompiledKeyword[] = [];
    for (const raw of category.keywords) {
      const keyword = raw.trim().toLowerCase().replace(/\s+/g, ' ');
      if (seen.has(keyword)) continue;
      const pattern = keywordPattern(keyword);
      if (!pattern) continue;
      seen.add(keyword);
      keywords.push({ keyword, pattern });
    }
    return { category, index, keywords };
  });
}

/** Matched categories, best first: score (distinct keywords matched) desc, then catalog order. */
export function matchCategories(text: string, compiled: CompiledCategory[]): CategoryMatch[] {
  const matches: CategoryMatch[] = [];
  for (const { category, index, keywords } of compiled) {
    const hits = keywords.filter(({ pattern }) => pattern.test(text)).map(({ keyword }) => keyword);
    if (hits.length > 0) matches.push({ category, index, score: hits.length, keywords: hits });
  }
  return matches.sort((a, b) => b.score - a.score || a.index - b.index);
}
