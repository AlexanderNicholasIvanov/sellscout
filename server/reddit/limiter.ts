// One Reddit request at a time, at least 500 ms apart, with a cool-down from the rate headers.
// One limiter per signed-in client, so it lasts for the whole server process.

export const MIN_GAP_MS = 500;
export const DEFAULT_COOL_DOWN_S = 60;

/** A rate header as a float; undefined when missing or not a number. */
export function parseRateHeader(value: string | null): number | undefined {
  if (value === null) return undefined;
  const text = value.trim();
  if (text === '') return undefined;
  const n = Number(text);
  return Number.isFinite(n) ? n : undefined;
}

export interface Limiter {
  /** Milliseconds left in the cool-down; 0 when there is none. */
  coolDownLeftMs(): number;
  /** Runs `task` after every earlier task, and at least 500 ms after the previous one ended. */
  run<T>(task: () => Promise<T>): Promise<T>;
  /**
   * Reads `X-Ratelimit-Remaining` / `X-Ratelimit-Reset` (seconds from now) after a response.
   * Returns true when the rest of this search must be skipped (Remaining < 1, or a 429).
   */
  observe(status: number, headers: Headers): boolean;
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export function createLimiter(minGapMs = MIN_GAP_MS): Limiter {
  let tail: Promise<unknown> = Promise.resolve();
  let lastEnd: number | undefined;
  let coolDownUntil = 0;

  const startCoolDown = (seconds: number | undefined): void => {
    const until = Date.now() + Math.max(0, seconds ?? DEFAULT_COOL_DOWN_S) * 1000;
    coolDownUntil = Math.max(coolDownUntil, until);
  };

  return {
    coolDownLeftMs: () => Math.max(0, coolDownUntil - Date.now()),
    run<T>(task: () => Promise<T>): Promise<T> {
      const result = tail.then(async () => {
        if (lastEnd !== undefined) {
          const wait = lastEnd + minGapMs - Date.now();
          if (wait > 0) await sleep(wait);
        }
        try {
          return await task();
        } finally {
          lastEnd = Date.now();
        }
      });
      tail = result.catch(() => undefined);
      return result;
    },
    observe(status, headers) {
      const remaining = parseRateHeader(headers.get('x-ratelimit-remaining'));
      const reset = parseRateHeader(headers.get('x-ratelimit-reset'));
      if (status === 429) {
        startCoolDown(reset);
        return true;
      }
      if (remaining !== undefined && remaining < 1) {
        startCoolDown(reset);
        return true;
      }
      return false;
    },
  };
}
