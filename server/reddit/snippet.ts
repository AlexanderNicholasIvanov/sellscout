export const SNIPPET_MAX = 200;
/** Only the start of a body is read, so no regex ever runs over a huge body. */
export const BODY_SCAN_MAX = 2000;

/**
 * A post body as plain text: `[text](url)` becomes `text`, the markup characters `* _ # > ` ~`
 * are removed, whitespace is collapsed, and the result is cut to 200 characters. '' for no body.
 */
export function snippet(body: string | undefined | null): string {
  if (typeof body !== 'string') return '';
  // Linear patterns only: neither part may contain its own delimiters, so a run of "[" fails fast.
  const plain = body
    .slice(0, BODY_SCAN_MAX)
    .replace(/\[([^[\]]*)\]\([^()]*\)/g, '$1')
    .replace(/[*_#>`~]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  let short = plain.slice(0, SNIPPET_MAX);
  // Never end on half of a surrogate pair.
  if (/[\uD800-\uDBFF]$/.test(short)) short = short.slice(0, -1);
  return short.trimEnd();
}
