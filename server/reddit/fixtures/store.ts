// The in-memory fixture post set for fixture mode. One store per server process: the buyer
// search reads it and POST /api/__fixtures changes it. Never touches disk; FIXTURE_POSTS is
// never mutated.
import { FIXTURE_POSTS } from './posts.ts';
import type { FixturePost } from './posts.ts';

export interface FixtureStore {
  posts(): readonly FixturePost[];
  /** Adds the post, or replaces the one with the same id; returns the post count. */
  upsert(post: FixturePost): number;
  /** Restores the built-in FIXTURE_POSTS; returns the post count. */
  reset(): number;
}

/** A new, independent store holding a copy of `initial` (default FIXTURE_POSTS). */
export function createFixtureStore(initial: readonly FixturePost[] = FIXTURE_POSTS): FixtureStore {
  const copy = (): FixturePost[] => initial.map((post) => ({ ...post }));
  let current = copy();
  return {
    posts: () => current,
    upsert(post) {
      const added = { ...post };
      const index = current.findIndex((existing) => existing.id === post.id);
      // A new array each time, so a caller holding an earlier posts() result sees no change.
      current = index === -1 ? [...current, added] : current.map((existing, i) => (i === index ? added : existing));
      return current.length;
    },
    reset() {
      current = copy();
      return current.length;
    },
  };
}
