export interface FailureLimiter {
  /** True when the key has used up its failures inside the window. */
  blocked: (key: string) => boolean;
  fail: (key: string) => void;
  reset: (key: string) => void;
}

/** Counts failures per key over a sliding window. In memory: a restart clears it. */
export function createFailureLimiter(options: {
  max: number;
  windowMs: number;
  now: () => number;
}): FailureLimiter {
  const failures = new Map<string, number[]>();
  const recent = (key: string): number[] => {
    const cutoff = options.now() - options.windowMs;
    const kept = (failures.get(key) ?? []).filter((at) => at > cutoff);
    failures.set(key, kept);
    return kept;
  };
  return {
    blocked: (key) => recent(key).length >= options.max,
    fail: (key) => {
      recent(key).push(options.now());
    },
    reset: (key) => {
      failures.delete(key);
    },
  };
}
