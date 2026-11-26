// Body parsing for POST /api/__fixtures (fixture mode only): add/replace a fixture post, or reset.
import type { FixturePost } from '../reddit/fixtures/posts.ts';
import { charLength, isRecord } from './validate.ts';
import type { Validation } from './validate.ts';

export const FIXTURE_TITLE_MAX = 300;
export const FIXTURE_SELFTEXT_MAX = 2000;
export const FIXTURE_AGE_HOURS_MAX = 2160;

export const FIXTURE_ERRORS = {
  json: 'Body must be JSON',
  shape: 'Body must be {"post": {...}} or {"reset": true}',
  id: 'id must match ^[a-z0-9_]{1,20}$',
  title: `title must be a string, 1-${FIXTURE_TITLE_MAX} characters after trim`,
  subreddit: 'subreddit must match ^[A-Za-z0-9_]{3,21}$',
  selftext: `selftext, if given, must be a string of at most ${FIXTURE_SELFTEXT_MAX} characters`,
  ageHours: `ageHours, if given, must be a finite number from 0 to ${FIXTURE_AGE_HOURS_MAX}`,
} as const;

export type FixtureRequest = { kind: 'post'; post: FixturePost } | { kind: 'reset' };

const ID_PATTERN = /^[a-z0-9_]{1,20}$/;
const SUBREDDIT_PATTERN = /^[A-Za-z0-9_]{3,21}$/;
const POST_KEYS: ReadonlySet<string> = new Set(['id', 'title', 'subreddit', 'selftext', 'ageHours']);

const fail = (error: string): Validation<never> => ({ ok: false, error });

function parsePost(data: Record<string, unknown>): Validation<FixturePost> {
  if (Object.keys(data).some((key) => !POST_KEYS.has(key))) return fail(FIXTURE_ERRORS.shape);
  const { id, title, subreddit, selftext, ageHours } = data;

  if (typeof id !== 'string' || !ID_PATTERN.test(id)) return fail(FIXTURE_ERRORS.id);
  if (typeof title !== 'string') return fail(FIXTURE_ERRORS.title);
  const trimmedTitle = title.trim();
  const titleLength = charLength(trimmedTitle);
  if (titleLength < 1 || titleLength > FIXTURE_TITLE_MAX) return fail(FIXTURE_ERRORS.title);
  if (typeof subreddit !== 'string' || !SUBREDDIT_PATTERN.test(subreddit)) return fail(FIXTURE_ERRORS.subreddit);
  if (selftext !== undefined && (typeof selftext !== 'string' || charLength(selftext) > FIXTURE_SELFTEXT_MAX)) {
    return fail(FIXTURE_ERRORS.selftext);
  }
  if (
    ageHours !== undefined &&
    (typeof ageHours !== 'number' || !Number.isFinite(ageHours) || ageHours < 0 || ageHours > FIXTURE_AGE_HOURS_MAX)
  ) {
    return fail(FIXTURE_ERRORS.ageHours);
  }

  return {
    ok: true,
    value: {
      id,
      title: trimmedTitle,
      subreddit,
      author: 'fixture_user',
      ageHours: ageHours ?? 1,
      score: 1,
      numComments: 0,
      selftext: selftext ?? '',
    },
  };
}

/** Parses and checks a POST /api/__fixtures body: `{"post": {...}}` or `{"reset": true}`. */
export function parseFixtureRequest(text: string): Validation<FixtureRequest> {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return fail(FIXTURE_ERRORS.json);
  }
  if (!isRecord(data)) return fail(FIXTURE_ERRORS.shape);
  const keys = Object.keys(data);
  if (keys.length !== 1) return fail(FIXTURE_ERRORS.shape);
  if (keys[0] === 'reset') return data.reset === true ? { ok: true, value: { kind: 'reset' } } : fail(FIXTURE_ERRORS.shape);
  if (keys[0] === 'post') {
    if (!isRecord(data.post)) return fail(FIXTURE_ERRORS.shape);
    const post = parsePost(data.post);
    return post.ok ? { ok: true, value: { kind: 'post', post: post.value } } : post;
  }
  return fail(FIXTURE_ERRORS.shape);
}
