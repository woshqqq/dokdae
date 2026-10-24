// 비밀번호 대입을 늦추기 위한 실패 횟수 제한. 서버 인스턴스 메모리 기준이라 인스턴스마다 따로 센다.

const WINDOW_MS = 10 * 60 * 1000;
const MAX_FAILURES = 10;
const MAX_KEYS = 5000;

type Entry = { failures: number; resetAt: number };

export function createFailureLimiter(maxFailures = MAX_FAILURES, windowMs = WINDOW_MS) {
  const entries = new Map<string, Entry>();
  const current = (key: string, now: number) => {
    const entry = entries.get(key);
    if (!entry || entry.resetAt <= now) return undefined;
    return entry;
  };
  return {
    isBlocked(key: string, now: number) {
      return (current(key, now)?.failures ?? 0) >= maxFailures;
    },
    recordFailure(key: string, now: number) {
      const entry = current(key, now) ?? { failures: 0, resetAt: now + windowMs };
      entry.failures += 1;
      entries.delete(key);
      entries.set(key, entry);
      // 오래된 키부터 정리해 메모리가 무한히 늘지 않게 한다.
      while (entries.size > MAX_KEYS) entries.delete(entries.keys().next().value!);
    },
    reset(key: string) {
      entries.delete(key);
    },
  };
}
