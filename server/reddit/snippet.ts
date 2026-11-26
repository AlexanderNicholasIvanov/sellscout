export const SNIPPET_MAX = 200;

/**
 * A post body as plain text: `[text](url)` becomes `text`, the markup characters `* _ # > ` ~`
 * are removed, whitespace is collapsed, and the result is cut to 200 characters. '' for no body.
 */
export function snippet(body: string | undefined | null): string {
  if (typeof body !== 'string') return '';
  const plain = body
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[*_#>`~]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  let short = plain.slice(0, SNIPPET_MAX);
  // Never end on half of a surrogate pair.
  if (/[\uD800-\uDBFF]$/.test(short)) short = short.slice(0, -1);
  return short.trimEnd();
}
