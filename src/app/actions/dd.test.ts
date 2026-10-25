import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { TestDb } from "../../../supabase/tests/harness";

// 독대 라이트의 서버 흐름을 실제 DB 로직(PGlite에 마이그레이션 적용)과 함께 검증한다:
// 방 생성/입장 → 참가자 토큰 쿠키 → 쿠키 검증 → 질문 구성 → 독대 → 열람 권한 → 사진·관리자 보호.
// Next 요청 API(cookies·headers)와 Supabase 클라이언트만 가짜로 바꾼다.

type Cookie = { value: string; options?: { httpOnly?: boolean; sameSite?: string; secure?: boolean; maxAge?: number } };
/** 브라우저 두 개를 흉내 낸다: 현재 활성 쿠키 항아리를 바꿔 가며 요청한다. */
const jars = new Map<string, Map<string, Cookie>>();
const state = vi.hoisted(() => ({ browser: "A", ip: "203.0.113.1", db: null as unknown }));
const jar = () => {
  if (!jars.has(state.browser)) jars.set(state.browser, new Map());
  return jars.get(state.browser)!;
};

class RedirectSignal extends Error {
  constructor(readonly url: string) {
    super(`redirect:${url}`);
  }
}

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new RedirectSignal(url);
  },
  unstable_rethrow: (e: unknown) => {
    if (e instanceof RedirectSignal) throw e;
  },
}));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (jar().has(name) ? { name, value: jar().get(name)!.value } : undefined),
    getAll: () => [...jar()].map(([name, { value }]) => ({ name, value })),
    set: (name: string, value: string, options?: Cookie["options"]) => void jar().set(name, { value, options }),
    delete: (name: string) => void jar().delete(name),
  }),
  headers: async () => new Headers({ "x-forwarded-for": state.ip }),
}));

// Supabase RPC 대신 PGlite 의 anon 역할(= Publishable Key)로 같은 함수를 호출한다. service_role 은 쓰지 않는다.
vi.mock("@/lib/dd/db", async () => {
  const { fromRpcError } = await import("@/lib/dd/errors");
  const ddRpc = async (fn: string, args: Record<string, unknown> = {}) => {
      const db = state.db as TestDb;
      const names = Object.keys(args);
      const sql = `select public.${fn}(${names.map((n, i) => `${n} => $${i + 1}`).join(", ")}) as r`;
      try {
        const rows = await db.as<{ r: unknown }>({ role: "anon" }, sql, names.map((n) => args[n]));
        return rows[0]?.r;
      } catch (error) {
        throw fromRpcError({ message: (error as Error).message, code: (error as { code?: string }).code });
      }
  };
  return {
    ddClient: () => {
      throw new Error("ddClient is not available in this test");
    },
    ddRpc,
    viewerRpc: (viewer: { roomId: string; token: string }, fn: string, args: Record<string, unknown> = {}) =>
      ddRpc(fn, { p_room: viewer.roomId, p_token: viewer.token, ...args }),
  };
});

const actions = await import("./dd");
const { getViewer } = await import("@/lib/dd/session");
const { PARTICIPANT_COOKIE_PREFIX } = await import("@/lib/dd/config");
const { hashToken } = await import("@/lib/dd/token");
const { getOverview } = await import("@/lib/dd/queries");
const queries = await import("@/lib/dd/queries");

let db: TestDb;
beforeAll(async () => {
  db = await TestDb.create();
  state.db = db;
}, 60_000);
afterAll(async () => {
  await db?.close();
});
beforeEach(() => {
  jars.clear();
  state.browser = "A";
  state.ip = `198.51.100.${Math.floor(Math.random() * 250) + 1}`;
});

const as = (browser: string) => void (state.browser = browser);

async function ok<T>(promise: Promise<{ ok: true; data: T } | { ok: false; error: string }>) {
  const result = await promise;
  if (!result.ok) throw new Error(`action failed: ${result.error}`);
  return result.data;
}

/** 방 생성자는 A 브라우저, 참가자는 B 브라우저. 둘 다 항목 3개(비용 1·2·3)를 등록한다. */
async function setupRoom() {
  as("A");
  const { roomId } = await ok(actions.createRoomAction({ name: "금요 모임", nickname: "에이" }));
  const viewerA = (await getViewer(roomId))!;
  const code = (await getOverview(viewerA)).room.invite_code!;

  as("B");
  const joined = await ok(actions.joinRoomAction({ inviteCode: code.toLowerCase().replace(/^(.{4})/, "$1-"), nickname: "비" }));
  expect(joined.roomId).toBe(roomId);
  const viewerB = (await getViewer(roomId))!;

  for (const [browser, secret] of [["A", "A의 비밀"], ["B", "B의 비밀"]] as const) {
    as(browser);
    for (let i = 0; i < 3; i++) await ok(actions.addItemAction(roomId, { kind: i % 2 ? "ask" : "tell", body: `${secret} 항목 ${i}`, cost: i + 1 }));
  }
  return { roomId, code, viewerA, viewerB };
}

describe("방 생성·입장과 참가자 토큰 쿠키", () => {
  it("방을 만들면 HttpOnly·SameSite=Lax 쿠키로 토큰이 심기고, DB에는 해시만 저장된다", async () => {
    as("A");
    const { roomId } = await ok(actions.createRoomAction({ name: "방", nickname: "에이" }));
    const cookie = jar().get(`${PARTICIPANT_COOKIE_PREFIX}${roomId}`)!;
    expect(cookie.options).toMatchObject({ httpOnly: true, sameSite: "lax" });
    expect(cookie.value).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const rows = await db.admin<{ token_hash: string }>(`select token_hash from dd_participants where room_id = $1`, [roomId]);
    expect(rows[0].token_hash).toBe(hashToken(cookie.value));
    expect(rows[0].token_hash).not.toContain(cookie.value);
    expect(await getViewer(roomId)).toMatchObject({ roomId, isCreator: true });
  });

  it("초대 코드로 입장하면 새 참가자가 되고, 틀린 코드·형식 오류는 거절된다", async () => {
    const { roomId } = await setupRoom();
    expect(roomId).toBeTruthy();
    as("C");
    expect(await actions.joinRoomAction({ inviteCode: "ZZZZ-9999", nickname: "씨" })).toMatchObject({ ok: false, code: "INVALID_CODE" });
    expect(await actions.joinRoomAction({ inviteCode: "짧음", nickname: "씨" })).toMatchObject({ ok: false, code: "INVALID_CODE" });
    expect(await actions.joinRoomAction({ inviteCode: "ABCD-EFGH", nickname: "" })).toMatchObject({ ok: false, code: "VALIDATION" });
    expect([...jar().keys()]).toEqual([]);
  });

  it("잘못된 초대 코드를 반복하면 일시적으로 차단된다", async () => {
    as("C");
    state.ip = "192.0.2.77";
    for (let i = 0; i < 10; i++) await actions.joinRoomAction({ inviteCode: "ZZZZ9999", nickname: "씨" });
    expect(await actions.joinRoomAction({ inviteCode: "ZZZZ9999", nickname: "씨" })).toMatchObject({ ok: false, code: "RATE_LIMITED" });
  });

  it("쿠키가 없거나 위조·다른 방 토큰이면 참가자로 인정되지 않는다", async () => {
    const { roomId } = await setupRoom();
    const other = await (async () => {
      as("X");
      return ok(actions.createRoomAction({ name: "다른 방", nickname: "엑스" }));
    })();

    as("Z"); // 쿠키 없음
    expect(await getViewer(roomId)).toBeNull();
    jar().set(`${PARTICIPANT_COOKIE_PREFIX}${roomId}`, { value: "a".repeat(43) });
    expect(await getViewer(roomId)).toBeNull();
    // 다른 방의 유효한 토큰을 이 방 쿠키에 넣어도 안 된다
    const xToken = jars.get("X")!.get(`${PARTICIPANT_COOKIE_PREFIX}${other.roomId}`)!.value;
    jar().set(`${PARTICIPANT_COOKIE_PREFIX}${roomId}`, { value: xToken });
    expect(await getViewer(roomId)).toBeNull();
    expect(await getViewer("not-a-uuid")).toBeNull();
  });

  it("쿠키 없이 서버 액션을 호출하면 모두 UNAUTHENTICATED 로 거절된다", async () => {
    const { roomId, viewerB } = await setupRoom();
    as("Z");
    const results = await Promise.all([
      actions.updateProfileAction(roomId, { nickname: "해커", bio: "" }),
      actions.addQuestionAction(roomId, "질문"),
      actions.markReadyAction(roomId),
      actions.addItemAction(roomId, { kind: "tell", body: "x", cost: 1 }),
      actions.unlockItemAction(roomId, "00000000-0000-4000-8000-0000000000a1", "00000000-0000-4000-8000-0000000000a2", 1),
      actions.setRewardAction(roomId, "00000000-0000-4000-8000-0000000000a1", 1),
      actions.confirmRewardAction(roomId, "00000000-0000-4000-8000-0000000000a1", 1),
      actions.requestPairAction(roomId, viewerB.id),
      actions.saveAnswerAction(roomId, "00000000-0000-4000-8000-0000000000a1", "x"),
    ]);
    for (const r of results) expect(r).toMatchObject({ ok: false, code: "UNAUTHENTICATED" });
  });
});

describe("항목 구성", () => {
  it("항목 입력 검증: 빈 내용·잘못된 유형·범위 밖 비용·잘못된 ID", async () => {
    as("A");
    const { roomId } = await ok(actions.createRoomAction({ name: "방", nickname: "에이" }));
    expect(await actions.addItemAction(roomId, { kind: "tell", body: "   ", cost: 1 })).toMatchObject({ ok: false, code: "VALIDATION" });
    expect(await actions.addItemAction(roomId, { kind: "bad", body: "내용", cost: 1 })).toMatchObject({ ok: false, code: "VALIDATION" });
    expect(await actions.addItemAction(roomId, { kind: "tell", body: "내용", cost: 0 })).toMatchObject({ ok: false, code: "VALIDATION" });
    expect(await actions.addItemAction(roomId, { kind: "tell", body: "내용", cost: 4 })).toMatchObject({ ok: false, code: "VALIDATION" }); // DB 설정 범위(1~3)
    expect(await actions.addItemAction(roomId, { kind: "tell", body: "가".repeat(501), cost: 1 })).toMatchObject({ ok: false, code: "VALIDATION" });
    expect(await actions.deleteItemAction(roomId, "x")).toMatchObject({ ok: false, code: "VALIDATION" });
    expect(await actions.setRewardAction(roomId, "x", 1)).toMatchObject({ ok: false, code: "VALIDATION" });
  });

  it("항목은 최대 10개까지이고 초기 토큰 10개가 지급되어 있다", async () => {
    as("A");
    const { roomId } = await ok(actions.createRoomAction({ name: "방", nickname: "에이" }));
    const viewer = (await getViewer(roomId))!;
    expect((await getOverview(viewer)).balance).toBe(10);
    for (let i = 0; i < 10; i++) await ok(actions.addItemAction(roomId, { kind: "tell", body: `항목 ${i}`, cost: 1 }));
    expect(await actions.addItemAction(roomId, { kind: "tell", body: "11번째", cost: 1 })).toMatchObject({ ok: false, code: "ITEM_LIMIT" });
    expect((await queries.getMyItems(viewer)).items).toHaveLength(10);
  });

  it("질문 최소 개수 규칙이 없어 항목·질문 없이도 독대를 요청할 수 있다", async () => {
    as("A");
    const { roomId } = await ok(actions.createRoomAction({ name: "방", nickname: "에이" }));
    const code = (await getOverview((await getViewer(roomId))!)).room.invite_code!;
    as("B");
    await ok(actions.joinRoomAction({ inviteCode: code, nickname: "비" }));
    const viewerB = (await getViewer(roomId))!;
    as("A");
    await ok(actions.requestPairAction(roomId, viewerB.id));
  });
});

describe("독대·열람·보상 흐름(참가자 A·B)", () => {
  async function activePair() {
    const t = await setupRoom();
    as("A");
    const { pairId } = await ok(actions.requestPairAction(t.roomId, t.viewerB.id));
    as("B");
    await ok(actions.respondPairAction(t.roomId, pairId, true));
    as("A");
    await ok(actions.consentPairAction(t.roomId, pairId));
    as("B");
    await ok(actions.consentPairAction(t.roomId, pairId));
    return { ...t, pairId };
  }

  it("요청→수락→양쪽 동의 전에는 항목 목록·열람이 막히고, 소개글만 열린다", async () => {
    const t = await setupRoom();
    as("A");
    const { pairId } = await ok(actions.requestPairAction(t.roomId, t.viewerB.id));
    expect((await queries.getPairView(t.viewerA, pairId)).peer.answers).toBeNull();
    as("B");
    expect((await queries.getPeerItems(t.viewerB, pairId)).items).toEqual([]);
    expect((await ok(actions.respondPairAction(t.roomId, pairId, true))).status).toBe("reviewing");
    const reviewing = await queries.getPeerItems(t.viewerB, pairId);
    expect(reviewing.items).toEqual([]);
    const aItems = await queries.getMyItems(t.viewerA);
    expect(await actions.unlockItemAction(t.roomId, pairId, aItems.items[0].id, 1)).toMatchObject({ ok: false, code: "INVALID_STATE" });
  });

  it("열람 전 응답에는 항목 개수와 비용만 있고, 열람하면 소유자에게 토큰이 이전된다", async () => {
    const t = await activePair();
    as("B");
    const blind = await queries.getPeerItems(t.viewerB, t.pairId);
    expect(blind.items).toHaveLength(3);
    expect(Object.keys(blind.items[0]).sort()).toEqual(["cost", "id", "ordinal", "unlocked"]);
    expect(JSON.stringify(blind)).not.toMatch(/A의 비밀|"body"|"kind"/);
    expect(blind.opened).toEqual([]);

    const target = blind.items.find((i) => i.cost === 2)!;
    expect(await actions.unlockItemAction(t.roomId, t.pairId, target.id, 3)).toMatchObject({ ok: false, code: "PRICE_CHANGED" });
    const r = await ok(actions.unlockItemAction(t.roomId, t.pairId, target.id, 2));
    expect(r).toMatchObject({ already_unlocked: false, balance: 8 });
    const again = await ok(actions.unlockItemAction(t.roomId, t.pairId, target.id, 2)); // 새로고침·재시도
    expect(again).toMatchObject({ already_unlocked: true, balance: 8 });
    const after = await queries.getPeerItems(t.viewerB, t.pairId);
    expect(after.balance).toBe(8);
    expect(after.opened).toHaveLength(1);
    expect(after.opened[0].body).toMatch(/^A의 비밀 항목/);
    as("A");
    expect((await getOverview(t.viewerA)).balance).toBe(12);
  });

  it("보상은 선택해도 잔액이 변하지 않고, 확정 때 한 번만 이전된다(종료 후에도 가능)", async () => {
    const t = await activePair();
    as("B");
    const item = (await queries.getPeerItems(t.viewerB, t.pairId)).items[0];
    const { unlock_id: unlockId } = await ok(actions.unlockItemAction(t.roomId, t.pairId, item.id, item.cost));

    expect(await actions.confirmRewardAction(t.roomId, unlockId, 2)).toMatchObject({ ok: false, code: "REWARD_NOT_SELECTED" });
    expect(await actions.setRewardAction(t.roomId, unlockId, 6)).toMatchObject({ ok: false, code: "VALIDATION" });
    const before = (await getOverview(t.viewerB)).balance;
    await ok(actions.setRewardAction(t.roomId, unlockId, 2));
    expect((await getOverview(t.viewerB)).balance).toBe(before);
    expect(await actions.confirmRewardAction(t.roomId, unlockId, 3)).toMatchObject({ ok: false, code: "REWARD_CHANGED" });

    as("A");
    expect(await actions.setRewardAction(t.roomId, unlockId, 5)).toMatchObject({ ok: false, code: "NOT_FOUND" }); // 소유자는 선택·확정할 수 없다
    expect(await actions.endPairAction(t.roomId, t.pairId)).toMatchObject({ ok: true });

    as("B");
    const closed = await queries.getPeerItems(t.viewerB, t.pairId);
    expect(closed.items).toEqual([]);
    expect(closed.opened[0]).toMatchObject({ body: null, kind: null });
    expect(await ok(actions.confirmRewardAction(t.roomId, unlockId, 2))).toMatchObject({ duplicate: false, reward_amount: 2 });
    expect(await ok(actions.confirmRewardAction(t.roomId, unlockId, 2))).toMatchObject({ duplicate: true });
    expect(await actions.setRewardAction(t.roomId, unlockId, 1)).toMatchObject({ ok: false, code: "REWARD_DONE" });
    expect((await getOverview(t.viewerB)).balance).toBe(before - 2);
    // 방 전체 토큰 합계는 그대로다(초기 지급 20개)
    const sum = await db.admin<{ s: number }>(`select sum(balance)::int s from dd_wallets w join dd_participants p on p.id = w.participant_id where p.room_id = $1`, [t.roomId]);
    expect(sum[0].s).toBe(20);
  });

  it("잔액이 부족하면 열람이 거절되고 잔액은 음수가 되지 않는다", async () => {
    const t = await activePair();
    as("B");
    const items = (await queries.getPeerItems(t.viewerB, t.pairId)).items;
    for (const it of items) await ok(actions.unlockItemAction(t.roomId, t.pairId, it.id, it.cost)); // 1+2+3 = 6
    expect((await getOverview(t.viewerB)).balance).toBe(4);
    // B 가 A 에게 더 열 항목을 만들어 달라고 할 수는 없으므로, A 항목을 비용 3으로 더 추가해 잔액(4)을 소진시킨다
    as("A");
    for (let i = 0; i < 3; i++) await ok(actions.addItemAction(t.roomId, { kind: "tell", body: `추가 ${i}`, cost: 3 }));
    as("B");
    const locked = (await queries.getPeerItems(t.viewerB, t.pairId)).items.filter((i) => !i.unlocked);
    await ok(actions.unlockItemAction(t.roomId, t.pairId, locked[0].id, 3));
    expect(await actions.unlockItemAction(t.roomId, t.pairId, locked[1].id, 3)).toMatchObject({ ok: false, code: "INSUFFICIENT_BALANCE" });
    expect((await getOverview(t.viewerB)).balance).toBe(1);
  });

  it("방 코드로 입장한 제3자 C는 A·B의 독대, 항목, 열람 내용에 접근할 수 없다", async () => {
    const t = await activePair();
    as("B");
    const target = (await queries.getPeerItems(t.viewerB, t.pairId)).items[0];
    await ok(actions.unlockItemAction(t.roomId, t.pairId, target.id, target.cost));

    as("C");
    await ok(actions.joinRoomAction({ inviteCode: t.code, nickname: "씨" }));
    const viewerC = (await getViewer(t.roomId))!;
    await expect(queries.getPairView(viewerC, t.pairId)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(queries.getPeerItems(viewerC, t.pairId)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(await actions.unlockItemAction(t.roomId, t.pairId, target.id, target.cost)).toMatchObject({ ok: false, code: "NOT_FOUND" });
    expect(await actions.consentPairAction(t.roomId, t.pairId)).toMatchObject({ ok: false, code: "NOT_FOUND" });
    expect(await actions.endPairAction(t.roomId, t.pairId)).toMatchObject({ ok: false, code: "NOT_FOUND" });
    const overview = await getOverview(viewerC);
    expect(JSON.stringify(overview)).not.toMatch(/A의 비밀|B의 비밀/);
    expect(overview.balance).toBe(10);
    expect(overview.room.invite_code).toBeNull();
  });

  it("A가 열람 후 삭제한 항목도 B는 독대가 끝나기 전까지 볼 수 있고, 끝나면 내용이 사라진다", async () => {
    const t = await activePair();
    as("B");
    const target = (await queries.getPeerItems(t.viewerB, t.pairId)).items[0];
    await ok(actions.unlockItemAction(t.roomId, t.pairId, target.id, target.cost));
    as("A");
    expect(await actions.updateItemAction(t.roomId, target.id, { kind: "tell", body: "바꾸기", cost: target.cost })).toMatchObject({ ok: false, code: "ITEM_LOCKED" });
    await ok(actions.deleteItemAction(t.roomId, target.id));
    const mine = await queries.getMyItems(t.viewerA);
    expect(mine.removed_opens).toHaveLength(1);
    expect(mine.removed_opens[0]).toMatchObject({ viewer_nickname: "비", reward_confirmed: false });
    expect(JSON.stringify(mine.removed_opens)).not.toContain("A의 비밀");
    as("B");
    const opened = (await queries.getPeerItems(t.viewerB, t.pairId)).opened[0];
    expect(opened).toMatchObject({ item_deleted: true });
    expect(opened.body).toMatch(/^A의 비밀 항목/);
    as("A");
    await ok(actions.endPairAction(t.roomId, t.pairId));
    as("B");
    expect((await queries.getPeerItems(t.viewerB, t.pairId)).opened[0].body).toBeNull();
  });

  it("다른 방 참가자는 이 방의 참가자·독대를 조회하거나 요청할 수 없다", async () => {
    const { roomId, viewerA, viewerB } = await setupRoom();
    as("A");
    const { pairId } = await ok(actions.requestPairAction(roomId, viewerB.id));

    as("X");
    const other = await ok(actions.createRoomAction({ name: "다른 방", nickname: "엑스" }));
    const viewerX = (await getViewer(other.roomId))!;
    expect(await getViewer(roomId)).toBeNull();
    await expect(queries.getPairView(viewerX, pairId)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(await actions.requestPairAction(roomId, viewerA.id)).toMatchObject({ ok: false, code: "UNAUTHENTICATED" });
    expect((await getOverview(viewerX)).members).toEqual([]);
  });

  it("A 는 B 의 항목을 수정·삭제할 수 없다", async () => {
    const { roomId, viewerB } = await setupRoom();
    const bItem = (await queries.getMyItems(viewerB)).items[0];
    as("A");
    expect(await actions.updateItemAction(roomId, bItem.id, { kind: "tell", body: "변조", cost: 1 })).toMatchObject({ ok: false, code: "NOT_FOUND" });
    expect(await actions.deleteItemAction(roomId, bItem.id)).toMatchObject({ ok: false, code: "NOT_FOUND" });
  });

  it("같은 두 사람의 중복 요청은 거절된다", async () => {
    const { roomId, viewerA, viewerB } = await setupRoom();
    as("A");
    await ok(actions.requestPairAction(roomId, viewerB.id));
    expect(await actions.requestPairAction(roomId, viewerB.id)).toMatchObject({ ok: false, code: "PAIR_EXISTS" });
    as("B");
    expect(await actions.requestPairAction(roomId, viewerA.id)).toMatchObject({ ok: false, code: "PAIR_EXISTS" });
  });
});

describe("관리자", () => {
  it("관리자 비밀번호가 없으면 로그인은 항상 거부된다", async () => {
    const { adminLoginAction } = await import("./dd-admin");
    vi.stubEnv("DOKDAE_ADMIN_PASSWORD", "");
    const data = new FormData();
    data.set("password", "anything");
    expect(await adminLoginAction({}, data)).toEqual({ error: "관리자 기능이 꺼져 있습니다." });
    expect(jars.get(state.browser)?.size ?? 0).toBe(0);
    vi.unstubAllEnvs();
  });

  it("올바른 비밀번호에서만 만료되는 HttpOnly 세션이 만들어지고, 틀리면 반복 시 차단된다", async () => {
    const { adminLoginAction } = await import("./dd-admin");
    const { isAdminAuthenticated } = await import("@/lib/dd/admin");
    vi.stubEnv("DOKDAE_ADMIN_PASSWORD", "correct-horse-battery");
    state.ip = "192.0.2.200";
    const form = (password: string) => {
      const d = new FormData();
      d.set("password", password);
      return d;
    };

    expect(await adminLoginAction({}, form("wrong-password"))).toEqual({ error: "비밀번호가 올바르지 않습니다." });
    expect(await isAdminAuthenticated()).toBe(false);

    await expect(adminLoginAction({}, form("correct-horse-battery"))).rejects.toMatchObject({ url: "/admin" });
    const cookie = jar().get("dd_admin")!;
    expect(cookie.options).toMatchObject({ httpOnly: true, sameSite: "strict" });
    expect(cookie.options?.maxAge).toBeGreaterThan(0);
    expect(cookie.value).not.toContain("correct-horse-battery");
    expect(await isAdminAuthenticated()).toBe(true);

    // 비밀번호를 바꾸면 기존 세션은 무효가 된다
    vi.stubEnv("DOKDAE_ADMIN_PASSWORD", "another-password-123");
    expect(await isAdminAuthenticated()).toBe(false);
    vi.unstubAllEnvs();
  });

  it("로그인하지 않은 상태에서는 기본 질문을 수정할 수 없다", async () => {
    const { updateDefaultQuestionAction } = await import("./dd-admin");
    vi.stubEnv("DOKDAE_ADMIN_PASSWORD", "correct-horse-battery");
    const result = await updateDefaultQuestionAction({
      id: "00000000-0000-4000-8000-0000000000a1",
      title: "해킹",
      body: "해킹",
      hint: "",
      position: 1,
    });
    expect(result).toMatchObject({ ok: false, code: "UNAUTHENTICATED" });
    vi.unstubAllEnvs();
  });
});
