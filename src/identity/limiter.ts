export interface FailureLimiter {
  /** True when the key has used up its failures inside the window. */
  blocked: (key: string) => boolean;
  fail: (key: string) => void;
  reset: (key: string) => void;
  /** How many keys are remembered right now. */
  size: () => number;
}

/** Counts failures per key over a sliding window. In memory: a restart clears it. */
export function createFailureLimiter(options: {
  max: number;
  windowMs: number;
  now: () => number;
  /** Most keys remembered at once; the oldest is forgotten first. */
  maxKeys?: number;
}): FailureLimiter {
  const maxKeys = options.maxKeys ?? 1000;
  const failures = new Map<string, number[]>();
  /** Failures still inside the window; a key with none is forgotten. */
  const recent = (key: string): number[] => {
    const cutoff = options.now() - options.windowMs;
    const kept = (failures.get(key) ?? []).filter((at) => at > cutoff);
    if (kept.length === 0) failures.delete(key);
    else failures.set(key, kept);
    return kept;
  };
  return {
    blocked: (key) => recent(key).length >= options.max,
    fail: (key) => {
      const kept = recent(key);
      kept.push(options.now());
      failures.set(key, kept);
      const oldest = failures.keys().next();
      if (failures.size > maxKeys && oldest.done !== true) failures.delete(oldest.value);
    },
    reset: (key) => {
      failures.delete(key);
    },
    size: () => failures.size,
  };
}
