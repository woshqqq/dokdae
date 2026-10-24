import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// 비회원 테스트 모드의 서버 흐름: 비밀번호 확인 → 세션 쿠키 → 사용자 선택 → 세션별 공간 → 종료.
// Next 요청 API(cookies·headers·redirect)는 가짜로 바꾸고, 나머지(서명·공간·mock 엔진)는 실제 코드를 쓴다.

const { jar, supabaseClient } = vi.hoisted(() => ({
  jar: new Map<string, { value: string; options?: { expires?: Date; httpOnly?: boolean; sameSite?: string } }>(),
  supabaseClient: vi.fn(),
}));
let clientIp = "203.0.113.1";

class RedirectSignal extends Error {
  constructor(readonly url: string) {
    super(`redirect:${url}`);
  }
}

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ io: async () => {} }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new RedirectSignal(url);
  },
}));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (jar.has(name) ? { name, value: jar.get(name)!.value } : undefined),
    getAll: () => [...jar].map(([name, { value }]) => ({ name, value })),
    set: (name: string, value: string, options?: object) => void jar.set(name, { value, options }),
    delete: (name: string) => void jar.delete(name),
  }),
  headers: async () => new Headers({ "x-forwarded-for": clientIp }),
}));
// 테스트 세션에서는 Supabase 클라이언트가 절대 만들어지면 안 된다.
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: supabaseClient }));

const { startTestSession, endTestSession } = await import("./test-mode");
const { signInAsMockUser, signOut } = await import("./auth");
const { getAuthContext, getCurrentUser } = await import("@/lib/auth/session");
const { getRepository } = await import("@/lib/data");
const { resetSandboxesForTest } = await import("@/lib/data/mock/sandboxes");
const { TEST_SESSION_COOKIE } = await import("@/lib/test-mode/config");

const PASSWORD = "correct-horse-battery";

function form(fields: Record<string, string>) {
  const data = new FormData();
  for (const [k, v] of Object.entries(fields)) data.set(k, v);
  return data;
}

async function expectRedirect(promise: Promise<unknown>, url: string) {
  await expect(promise).rejects.toMatchObject({ url });
}

async function login(fields: Record<string, string> = {}) {
  await expectRedirect(startTestSession({}, form({ password: PASSWORD, ...fields })), "/");
}

async function pickUser(userId: string) {
  await expectRedirect(signInAsMockUser(form({ userId, next: "/" })), "/");
}

async function currentSid() {
  const context = await getAuthContext();
  if (context.kind !== "test") throw new Error("not in test session");
  return context.session.sid;
}

beforeEach(() => {
  jar.clear();
  resetSandboxesForTest();
  supabaseClient.mockClear();
  clientIp = `203.0.113.${Math.floor(Math.random() * 250)}`;
  vi.stubEnv("DOKDAE_DATA_SOURCE", "supabase");
  vi.stubEnv("DOKDAE_TEST_MODE", "true");
  vi.stubEnv("DOKDAE_TEST_PASSWORD", PASSWORD);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe("startTestSession", () => {
  it("올바른 비밀번호면 만료 시각이 있는 httpOnly 쿠키를 발급하고 홈으로 보낸다", async () => {
    await login();
    const cookie = jar.get(TEST_SESSION_COOKIE);
    expect(cookie?.options).toMatchObject({ httpOnly: true, sameSite: "lax" });
    const hours = (cookie!.options!.expires!.getTime() - Date.now()) / 3_600_000;
    expect(hours).toBeGreaterThan(7.9);
    expect(hours).toBeLessThanOrEqual(8);
    expect((await getAuthContext()).kind).toBe("test");
    // 쿠키에 비밀번호가 들어가지 않는다.
    expect(Buffer.from(cookie!.value.split(".")[0], "base64url").toString()).not.toContain(PASSWORD);
  });

  it("틀린 비밀번호는 거부하고 쿠키를 만들지 않는다", async () => {
    expect(await startTestSession({}, form({ password: "wrong-password" }))).toEqual({ error: "테스트 비밀번호가 올바르지 않습니다." });
    expect(jar.has(TEST_SESSION_COOKIE)).toBe(false);
  });

  it("같은 IP에서 10번 틀리면 올바른 비밀번호도 잠시 막는다", async () => {
    for (let i = 0; i < 10; i++) await startTestSession({}, form({ password: `wrong-${i}` }));
    expect((await startTestSession({}, form({ password: PASSWORD }))).error).toContain("시도가 너무 많습니다");
  });

  it("테스트 모드가 꺼져 있으면 비밀번호가 맞아도 거부한다", async () => {
    vi.stubEnv("DOKDAE_TEST_MODE", "false");
    expect(await startTestSession({}, form({ password: PASSWORD }))).toEqual({ error: "테스트 모드가 꺼져 있습니다." });
    expect(jar.has(TEST_SESSION_COOKIE)).toBe(false);
  });

  it("공간 코드 형식이 틀리면 거부한다", async () => {
    expect((await startTestSession({}, form({ password: PASSWORD, sandboxCode: "not-a-code" }))).error).toContain("형식");
  });
});

describe("테스트 세션 상태", () => {
  it("테스트 모드를 끄면 남은 쿠키는 무시된다", async () => {
    await login();
    vi.stubEnv("DOKDAE_TEST_MODE", "false");
    expect((await getAuthContext()).kind).toBe("supabase");
  });

  it("만료되면 테스트 세션으로 인정하지 않는다", async () => {
    await login();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.now() + 8 * 3_600_000 + 1);
    expect((await getAuthContext()).kind).toBe("supabase");
  });

  it("데모 사용자를 고르고, 사용자 전환하면 세션은 유지한 채 선택만 해제한다", async () => {
    await login();
    expect(await getCurrentUser()).toBeNull();
    await pickUser("mock-user-junho");
    expect(await getCurrentUser()).toEqual({ id: "mock-user-junho", displayName: "준호" });
    await expectRedirect(signOut(), "/");
    expect(await getCurrentUser()).toBeNull();
    expect((await getAuthContext()).kind).toBe("test");
  });

  it("테스트 종료는 쿠키를 지우고 /test-login으로 보낸다", async () => {
    await login();
    await expectRedirect(endTestSession(), "/test-login?ended=1");
    expect(jar.has(TEST_SESSION_COOKIE)).toBe(false);
    expect((await getAuthContext()).kind).toBe("supabase");
  });
});

describe("데이터 격리", () => {
  it("테스트 세션은 Supabase(운영 DB)에 접근하지 않고 시드된 테스트 공간을 쓴다", async () => {
    await login();
    await pickUser("mock-user-minji");
    const repo = await getRepository();
    const rooms = await repo.listMyRooms();
    expect(rooms.map((r) => r.room.name)).toEqual(["가을 독서 모임"]);
    await repo.createRoom({ name: "테스트 모임", description: "", nickname: "민지" });
    expect(supabaseClient).not.toHaveBeenCalled();
  });

  it("서로 다른 테스트 세션의 데이터는 섞이지 않는다", async () => {
    await login();
    await pickUser("mock-user-minji");
    await (await getRepository()).createRoom({ name: "A의 모임", description: "", nickname: "민지" });

    jar.clear(); // 다른 브라우저
    await login();
    await pickUser("mock-user-minji");
    const names = (await (await getRepository()).listMyRooms()).map((r) => r.room.name);
    expect(names).not.toContain("A의 모임");
  });

  it("공간 코드로 합류하면 같은 데이터를 본다", async () => {
    await login();
    await pickUser("mock-user-minji");
    const sid = await currentSid();
    await (await getRepository()).createRoom({ name: "함께 쓰는 모임", description: "", nickname: "민지" });

    jar.clear();
    await login({ sandboxCode: sid });
    await pickUser("mock-user-minji");
    expect(await currentSid()).toBe(sid);
    const names = (await (await getRepository()).listMyRooms()).map((r) => r.room.name);
    expect(names).toContain("함께 쓰는 모임");
  });

  it("테스트 세션 없이 supabase 모드면 기존처럼 Supabase 저장소를 쓴다", async () => {
    supabaseClient.mockResolvedValueOnce({ rpc: vi.fn() });
    await getRepository();
    expect(supabaseClient).toHaveBeenCalledOnce();
  });
});
