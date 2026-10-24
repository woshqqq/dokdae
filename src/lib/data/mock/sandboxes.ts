import "server-only";
import type { MockDb } from "./db";
import { seed } from "./store";

// 비회원 테스트 모드의 "테스트 공간". 공간마다 독립된 시드 DB를 가지므로 테스트하는 사람끼리 데이터가 섞이지 않는다.
// 개발용 공용 mock DB(getMockDb)와도 분리되어 있다.
//
// 한계: 서버 프로세스 메모리에만 있다. 서버리스(Vercel)에서는 인스턴스가 바뀌거나 재시작되면 사라지고,
// 요청이 다른 인스턴스로 가면 그 인스턴스에서 공간이 새로 시드된다(restored=true로 표시).

export type Sandbox = {
  db: MockDb;
  createdAt: number;
  lastUsedAt: number;
  /** 로그인 때가 아니라 기존 세션 요청에서 다시 만들어진 공간(이전 데이터가 이 인스턴스에 없었음) */
  restored: boolean;
};

const MAX_SANDBOXES = 100;
/** 마지막 사용 후 이 시간이 지나면 정리한다(세션 유지 시간과 같다). */
const IDLE_MS = 8 * 60 * 60 * 1000;

const globalForSandboxes = globalThis as unknown as { __dokdaeTestSandboxes?: Map<string, Sandbox> };

function sandboxes() {
  globalForSandboxes.__dokdaeTestSandboxes ??= new Map();
  return globalForSandboxes.__dokdaeTestSandboxes;
}

function prune(now: number) {
  const all = sandboxes();
  for (const [id, box] of all) if (now - box.lastUsedAt > IDLE_MS) all.delete(id);
  // Map은 삽입 순서를 지키고, 사용할 때마다 다시 넣으므로 맨 앞이 가장 오래 쓰지 않은 공간이다.
  while (all.size > MAX_SANDBOXES) all.delete(all.keys().next().value!);
}

function put(id: string, box: Sandbox) {
  const all = sandboxes();
  all.delete(id);
  all.set(id, box);
}

/** 테스트 로그인 시 새 공간을 만든다. 같은 id가 이미 있으면(공간 코드로 합류) 그대로 둔다. */
export function openSandbox(id: string, now: number): Sandbox {
  prune(now);
  const existing = sandboxes().get(id);
  const box = existing ?? { db: seed(), createdAt: now, lastUsedAt: now, restored: false };
  box.lastUsedAt = now;
  put(id, box);
  return box;
}

/** 세션의 공간을 가져온다. 이 인스턴스에 없으면 새로 시드하고 restored로 표시한다. */
export function getSandbox(id: string, now: number): Sandbox {
  const existing = sandboxes().get(id);
  if (existing) {
    existing.lastUsedAt = now;
    put(id, existing);
    return existing;
  }
  prune(now);
  const box: Sandbox = { db: seed(), createdAt: now, lastUsedAt: now, restored: true };
  put(id, box);
  return box;
}

/** 화면 표시용: 공간이 이 인스턴스에서 다시 만들어졌는지(또는 아직 없어 곧 다시 만들어질지). */
export function isSandboxRestored(id: string) {
  return sandboxes().get(id)?.restored ?? true;
}

export function resetSandboxesForTest() {
  sandboxes().clear();
}
