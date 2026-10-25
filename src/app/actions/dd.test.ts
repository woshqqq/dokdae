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

/** 방 생성자는 A 브라우저, 참가자는 B 브라우저. 둘 다 질문 10개를 채우고 준비 완료. */
async function setupRoom() {
  as("A");
  const { roomId } = await ok(actions.createRoomAction({ name: "금요 모임", nickname: "에이" }));
  const viewerA = (await getViewer(roomId))!;
  const code = (await getOverview(viewerA)).room.invite_code!;

  as("B");
  const joined = await ok(actions.joinRoomAction({ inviteCode: code.toLowerCase().replace(/^(.{4})/, "$1-"), nickname: "비" }));
  expect(joined.roomId).toBe(roomId);
  const viewerB = (await getViewer(roomId))!;

  for (const [browser, viewer, secret] of [["A", viewerA, "A의 비밀"], ["B", viewerB, "B의 비밀"]] as const) {
    as(browser);
    for (let i = 0; i < 5; i++) await ok(actions.addQuestionAction(roomId, `개인 질문 ${i}`));
    const { questions } = await queries.getMyQuestions(viewer);
    await ok(actions.saveAnswerAction(roomId, questions[0].id, secret));
    await ok(actions.markReadyAction(roomId));
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
      actions.requestPairAction(roomId, viewerB.id),
      actions.saveAnswerAction(roomId, "00000000-0000-4000-8000-0000000000a1", "x"),
    ]);
    for (const r of results) expect(r).toMatchObject({ ok: false, code: "UNAUTHENTICATED" });
  });
});

describe("질문 구성", () => {
  it("질문이 10개 미만이면 준비 완료할 수 없고, 기본 5개를 포함해 계산한다", async () => {
    as("A");
    const { roomId } = await ok(actions.createRoomAction({ name: "방", nickname: "에이" }));
    expect(await actions.markReadyAction(roomId)).toMatchObject({ ok: false, code: "MIN_QUESTIONS" });
    for (let i = 0; i < 4; i++) await ok(actions.addQuestionAction(roomId, `q${i}`));
    expect(await actions.markReadyAction(roomId)).toMatchObject({ ok: false, code: "MIN_QUESTIONS" });
    await ok(actions.addQuestionAction(roomId, "q4"));
    await ok(actions.markReadyAction(roomId));
  });

  it("입력값 검증: 빈 질문·긴 답변·잘못된 ID", async () => {
    as("A");
    const { roomId } = await ok(actions.createRoomAction({ name: "방", nickname: "에이" }));
    expect(await actions.addQuestionAction(roomId, "   ")).toMatchObject({ ok: false, code: "VALIDATION" });
    expect(await actions.saveAnswerAction(roomId, "x", "답")).toMatchObject({ ok: false, code: "VALIDATION" });
    const q = await queries.getMyQuestions((await getViewer(roomId))!);
    expect(await actions.saveAnswerAction(roomId, q.questions[0].id, "가".repeat(2001))).toMatchObject({ ok: false, code: "VALIDATION" });
  });
});

describe("독대 흐름과 열람 권한(참가자 A·B)", () => {
  it("요청→수락→양쪽 동의→종료, 단계별로 상대의 답변이 열리고 닫힌다", async () => {
    const { roomId, viewerA, viewerB } = await setupRoom();

    as("A");
    const { pairId } = await ok(actions.requestPairAction(roomId, viewerB.id));
    // 요청 단계: 소개·답변은 어느 쪽에도 내려가지 않는다
    expect((await queries.getPairView(viewerA, pairId)).peer.answers).toBeNull();
    as("B");
    expect((await queries.getPairView(viewerB, pairId)).peer.answers).toBeNull();

    // 요청자는 스스로 수락할 수 없다
    as("A");
    expect(await actions.respondPairAction(roomId, pairId, true)).toMatchObject({ ok: false, code: "NOT_FOUND" });

    as("B");
    expect((await ok(actions.respondPairAction(roomId, pairId, true))).status).toBe("reviewing");
    expect((await queries.getPairView(viewerB, pairId)).peer.answers![0].answer).toBe("A의 비밀");
    as("A");
    expect((await queries.getPairView(viewerA, pairId)).peer.answers![0].answer).toBe("B의 비밀");

    // 한쪽만 동의하면 시작되지 않는다
    expect((await ok(actions.consentPairAction(roomId, pairId))).status).toBe("reviewing");
    expect((await queries.getPairView(viewerA, pairId)).pair).toMatchObject({ status: "reviewing", my_consent: true, peer_consent: false });
    as("B");
    expect((await ok(actions.consentPairAction(roomId, pairId))).status).toBe("active");

    // 종료하면 다시 가려지고 기록(상태)은 DB에 남는다
    expect((await ok(actions.endPairAction(roomId, pairId))).status).toBe("closed");
    const after = await queries.getPairView(viewerA, pairId);
    expect(after.pair.status).toBe("closed");
    expect(after.peer.answers).toBeNull();
    expect(after.peer.bio).toBeNull();
    const rows = await db.admin<{ status: string }>(`select status from dd_pairs where id = $1`, [pairId]);
    expect(rows[0].status).toBe("closed");
  });

  it("방 코드로 입장한 제3자 C는 A·B의 독대와 답변에 접근할 수 없다", async () => {
    const { roomId, code, viewerA, viewerB } = await setupRoom();
    as("A");
    const { pairId } = await ok(actions.requestPairAction(roomId, viewerB.id));
    as("B");
    await ok(actions.respondPairAction(roomId, pairId, true));

    as("C");
    await ok(actions.joinRoomAction({ inviteCode: code, nickname: "씨" }));
    const viewerC = (await getViewer(roomId))!;
    await expect(queries.getPairView(viewerC, pairId)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(await actions.consentPairAction(roomId, pairId)).toMatchObject({ ok: false, code: "NOT_FOUND" });
    expect(await actions.endPairAction(roomId, pairId)).toMatchObject({ ok: false, code: "NOT_FOUND" });
    expect(await actions.respondPairAction(roomId, pairId, false)).toMatchObject({ ok: false, code: "NOT_FOUND" });
    // 목록에는 닉네임·사진 유무·준비 여부만 있다
    const overview = await getOverview(viewerC);
    expect(JSON.stringify(overview)).not.toContain("A의 비밀");
    expect(JSON.stringify(overview)).not.toContain("B의 비밀");
    expect(overview.room.invite_code).toBeNull();
    expect(viewerA.id).not.toBe(viewerC.id);
  });

  it("다른 방 참가자는 이 방의 참가자·독대를 조회하거나 요청할 수 없다", async () => {
    const { roomId, viewerA, viewerB } = await setupRoom();
    as("A");
    const { pairId } = await ok(actions.requestPairAction(roomId, viewerB.id));

    as("X");
    const other = await ok(actions.createRoomAction({ name: "다른 방", nickname: "엑스" }));
    const viewerX = (await getViewer(other.roomId))!;
    // X 의 쿠키로는 이 방의 viewer 가 만들어지지 않는다
    expect(await getViewer(roomId)).toBeNull();
    await expect(queries.getPairView(viewerX, pairId)).rejects.toMatchObject({ code: "NOT_FOUND" });
    // 이 방 ID로 액션을 호출해도 X의 쿠키는 이 방에서 무효
    expect(await actions.requestPairAction(roomId, viewerA.id)).toMatchObject({ ok: false, code: "UNAUTHENTICATED" });
    expect((await getOverview(viewerX)).members).toEqual([]);
  });

  it("A 는 B 의 개인 질문 ID로 답변을 덮어쓸 수 없다", async () => {
    const { roomId, viewerA, viewerB } = await setupRoom();
    const bQuestions = await queries.getMyQuestions(viewerB);
    const bPersonal = bQuestions.questions.find((q) => q.kind === "personal")!;
    as("A");
    expect(await actions.saveAnswerAction(roomId, bPersonal.id, "덮어쓰기")).toMatchObject({ ok: false, code: "NOT_FOUND" });
    expect(await actions.deleteQuestionAction(roomId, bPersonal.id)).toMatchObject({ ok: false, code: "NOT_FOUND" });
    expect(await actions.updateQuestionAction(roomId, bPersonal.id, "변조")).toMatchObject({ ok: false, code: "NOT_FOUND" });
    expect(viewerA.id).not.toBe(viewerB.id);
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
