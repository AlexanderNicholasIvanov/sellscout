// AC2, AC3, AC8: saved-search storage, the "New" computation and the Run record update.
import { describe, expect, it } from 'vitest';
import type { SearchInput } from '../server/types.ts';
import {
  DUPLICATE_MESSAGE,
  FULL_MESSAGE,
  RESET_NOTICE,
  SAVED_BACKUP_KEY,
  SAVED_KEY,
  SAVED_MAX,
  SEEN_MAX,
  WRITE_FAILED_MESSAGE,
  add,
  applyRun,
  load,
  newCountText,
  newPostIds,
  remove,
  write,
} from './saved.ts';
import type { SavedSearch, SavedStorage } from './saved.ts';

class FakeStorage implements SavedStorage {
  data = new Map<string, string>();
  failGet = false;
  failSet = false;
  getItem(key: string): string | null {
    if (this.failGet) throw new Error('SecurityError: denied');
    return this.data.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    if (this.failSet) throw new Error('QuotaExceededError');
    this.data.set(key, value);
  }
}

const NOW = Date.UTC(2026, 10, 25, 12);

function ids(prefix = 'id') {
  let n = 0;
  return () => `${prefix}-${++n}`;
}

const input = (item: string, extra: Partial<SearchInput> = {}): SearchInput => ({
  item,
  delivery: 'both',
  window: 30,
  ...extra,
});

function record(id: string, extra: Partial<SavedSearch> = {}): SavedSearch {
  return {
    id,
    item: `item ${id}`,
    location: '',
    delivery: 'ship',
    window: 7,
    savedAt: NOW,
    lastRunAt: NOW,
    seenPostIds: [],
    ...extra,
  };
}

function saveAll(list: SavedSearch[], items: SearchInput[], newId = ids()): SavedSearch[] {
  for (const it of items) {
    const r = add(list, it, [], NOW, newId);
    if ('message' in r) throw new Error(r.message);
    list = r.list;
  }
  return list;
}

describe('saved searches: load and save', () => {
  it('round-trips through storage', () => {
    const storage = new FakeStorage();
    const r = add([], input('  RTX 3080 ', { location: ' Seattle ', delivery: 'local', window: 90 }), ['a', 'b'], NOW, ids());
    if ('message' in r) throw new Error(r.message);
    expect(r.list).toEqual([
      {
        id: 'id-1',
        item: 'RTX 3080',
        location: 'Seattle',
        delivery: 'local',
        window: 90,
        savedAt: NOW,
        lastRunAt: NOW,
        seenPostIds: ['a', 'b'],
      },
    ]);
    expect(write(storage, r.list)).toBeNull();
    expect(JSON.parse(storage.data.get(SAVED_KEY) ?? 'null')).toEqual(r.list);
    expect(load(storage)).toEqual({ list: r.list });
  });

  it('a missing value is an empty list with no notice', () => {
    expect(load(new FakeStorage())).toEqual({ list: [] });
  });

  it('a blank location is stored as ""', () => {
    const r = add([], input('desk'), [], NOW, ids());
    expect('list' in r && r.list[0].location).toBe('');
  });

  it('uses crypto.randomUUID for ids by default', () => {
    const r = add([], input('desk'), [], NOW);
    expect('list' in r && r.list[0].id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('keeps the newest saved first', () => {
    const list = saveAll([], [input('first'), input('second'), input('third')]);
    expect(list.map((r) => r.item)).toEqual(['third', 'second', 'first']);
  });

  it('a duplicate (item and location case-insensitive, same delivery and window) gives "Already saved"', () => {
    const list = saveAll([], [input('RTX 3080', { location: 'Seattle' })]);
    const dup = add(list, input('rtx 3080', { location: 'SEATTLE' }), [], NOW, ids('x'));
    expect(dup).toEqual({ message: DUPLICATE_MESSAGE });
    expect(DUPLICATE_MESSAGE).toBe('Already saved');
    // Another delivery, window or location is not a duplicate.
    expect('list' in add(list, input('RTX 3080', { location: 'Seattle', delivery: 'ship' }), [], NOW)).toBe(true);
    expect('list' in add(list, input('RTX 3080', { location: 'Seattle', window: 7 }), [], NOW)).toBe(true);
    expect('list' in add(list, input('RTX 3080'), [], NOW)).toBe(true);
  });

  it('refuses the 51st save with the max-50 message', () => {
    const list = saveAll(
      [],
      Array.from({ length: SAVED_MAX }, (_, i) => input(`item ${i}`)),
    );
    expect(list).toHaveLength(50);
    expect(add(list, input('one more'), [], NOW)).toEqual({ message: FULL_MESSAGE });
    expect(FULL_MESSAGE).toBe('Delete a saved search first (max 50)');
  });

  it('caps the seen ids of a new record at 500', () => {
    const many = Array.from({ length: 600 }, (_, i) => `p${i}`);
    const r = add([], input('desk'), many, NOW, ids());
    expect('list' in r && r.list[0].seenPostIds).toEqual(many.slice(0, SEEN_MAX));
  });

  it('delete removes only that id', () => {
    const list = [record('a'), record('b'), record('c')];
    expect(remove(list, 'b').map((r) => r.id)).toEqual(['a', 'c']);
    expect(remove(list, 'zzz')).toEqual(list);
    expect(list).toHaveLength(3);
  });
});

describe('saved searches: corrupt data', () => {
  const good = record('good');
  const cases: [string, string][] = [
    ['not JSON', '{oops'],
    ['not an array', JSON.stringify({ list: [good] })],
    ['a bad entry (missing field)', JSON.stringify([good, { ...good, id: undefined }])],
    ['a bad entry (wrong type)', JSON.stringify([{ ...good, lastRunAt: '1' }])],
    ['a bad entry (seen ids not strings)', JSON.stringify([{ ...good, seenPostIds: [1] }])],
    ['a bad entry (null)', JSON.stringify([null])],
    ['a bad window', JSON.stringify([{ ...good, window: 14 }])],
    ['a bad delivery', JSON.stringify([{ ...good, delivery: 'courier' }])],
    ['51 entries', JSON.stringify(Array.from({ length: 51 }, (_, i) => record(`r${i}`)))],
  ];

  it.each(cases)('%s: writes the backup, stores [] and returns the reset notice', (_label, raw) => {
    const storage = new FakeStorage();
    storage.data.set(SAVED_KEY, raw);
    storage.data.set(SAVED_BACKUP_KEY, 'an older backup');
    expect(load(storage)).toEqual({ list: [], notice: RESET_NOTICE });
    expect(storage.data.get(SAVED_BACKUP_KEY)).toBe(raw);
    expect(storage.data.get(SAVED_KEY)).toBe('[]');
    expect(SAVED_BACKUP_KEY).toBe('sellscout.savedSearches.v1.corrupt');
    expect(RESET_NOTICE).toBe("Saved searches couldn't be read and were reset (a backup was kept).");
  });

  it('50 valid entries are not corrupt', () => {
    const storage = new FakeStorage();
    const list = Array.from({ length: 50 }, (_, i) => record(`r${i}`));
    storage.data.set(SAVED_KEY, JSON.stringify(list));
    expect(load(storage)).toEqual({ list });
  });

  it('never throws when the reset cannot be written', () => {
    const storage = new FakeStorage();
    storage.data.set(SAVED_KEY, '{oops');
    storage.failSet = true;
    expect(load(storage)).toEqual({ list: [], notice: RESET_NOTICE });
  });
});

describe('saved searches: storage failures', () => {
  it('a throwing getItem gives an empty list and no notice', () => {
    const storage = new FakeStorage();
    storage.data.set(SAVED_KEY, '{oops');
    storage.failGet = true;
    expect(load(storage)).toEqual({ list: [] });
    expect(storage.data.has(SAVED_BACKUP_KEY)).toBe(false);
  });

  it('a throwing setItem gives the "Couldn\'t save" message and leaves the stored list unchanged', () => {
    const storage = new FakeStorage();
    const before = [record('a')];
    expect(write(storage, before)).toBeNull();
    storage.failSet = true;
    const next = [record('b'), ...before];
    expect(write(storage, next)).toBe(WRITE_FAILED_MESSAGE);
    expect(WRITE_FAILED_MESSAGE).toBe("Couldn't save: browser storage is full or blocked");
    storage.failSet = false;
    expect(load(storage)).toEqual({ list: before });
  });
});

describe('saved searches: Run update (AC8)', () => {
  it('puts this run\'s ids first, then older ids not already there, and sets lastRunAt', () => {
    const list = [record('a', { seenPostIds: ['p2', 'p1'] }), record('b', { seenPostIds: ['q'] })];
    const next = applyRun(list, 'a', ['p3', 'p2'], NOW + 5000);
    expect(next).toEqual([
      record('a', { seenPostIds: ['p3', 'p2', 'p1'], lastRunAt: NOW + 5000 }),
      record('b', { seenPostIds: ['q'] }),
    ]);
    // The input list is not mutated.
    expect(list[0].seenPostIds).toEqual(['p2', 'p1']);
    expect(list[0].lastRunAt).toBe(NOW);
  });

  it('caps the seen union at 500, keeping this run\'s ids', () => {
    const older = Array.from({ length: 500 }, (_, i) => `old${i}`);
    const current = Array.from({ length: 10 }, (_, i) => `new${i}`);
    const next = applyRun([record('a', { seenPostIds: older })], 'a', current, NOW);
    const seen = next?.[0].seenPostIds ?? [];
    expect(seen).toHaveLength(SEEN_MAX);
    expect(seen.slice(0, 10)).toEqual(current);
    expect(seen.slice(10)).toEqual(older.slice(0, 490));
  });

  it('a deleted id gives undefined, so nothing is written', () => {
    expect(applyRun([record('b')], 'a', ['p1'], NOW)).toBeUndefined();
    expect(applyRun([], 'a', [], NOW)).toBeUndefined();
  });
});

describe('"New" posts (AC3)', () => {
  const posts = [{ id: 'p1' }, { id: 'p2' }, { id: 'p3' }];

  it('returns the posts whose id is not in seenPostIds, in order', () => {
    expect(newPostIds(posts, ['p2'])).toEqual(['p1', 'p3']);
    expect(newPostIds(posts, ['p1', 'p2', 'p3'])).toEqual([]);
    expect(newPostIds(posts, [])).toEqual(['p1', 'p2', 'p3']);
    expect(newPostIds([], ['p1'])).toEqual([]);
  });

  it('gives the count text for 0, 1 and n', () => {
    expect(newCountText(0)).toBe('Nothing new since your last run');
    expect(newCountText(1)).toBe('1 new since your last run');
    expect(newCountText(3)).toBe('3 new since your last run');
  });
});
