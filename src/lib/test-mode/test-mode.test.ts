import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getTestModeSecret, isTestModeEnabled, TEST_SESSION_COOKIE } from "./config";
import { checkTestMode } from "./proxy";
import { createFailureLimiter } from "./rate-limit";
import { isSandboxId, newSandboxId, passwordMatches, signTestSession, verifyTestSession, type TestSession } from "./token";

const SECRET = "correct-horse-battery";
const NOW = 1_800_000_000_000;
const session = (over: Partial<TestSession> = {}): TestSession => ({ sid: newSandboxId(), uid: null, exp: NOW + 60_000, ...over });

afterEach(() => vi.unstubAllEnvs());

describe("테스트 모드 설정", () => {
  it("DOKDAE_TEST_MODE=true 이고 비밀번호가 8자 이상일 때만 켜진다", () => {
    vi.stubEnv("DOKDAE_TEST_MODE", "true");
    vi.stubEnv("DOKDAE_TEST_PASSWORD", SECRET);
    expect(getTestModeSecret()).toBe(SECRET);
    expect(isTestModeEnabled()).toBe(true);
  });

  it.each([
    ["false", SECRET],
    ["TRUE", SECRET],
    ["", SECRET],
    ["true", ""],
    ["true", "short"],
  ])("DOKDAE_TEST_MODE=%j, 비밀번호=%j 이면 꺼진다", (mode, password) => {
    vi.stubEnv("DOKDAE_TEST_MODE", mode);
    vi.stubEnv("DOKDAE_TEST_PASSWORD", password);
    expect(isTestModeEnabled()).toBe(false);
  });
});

describe("테스트 세션 토큰", () => {
  it("서명한 세션을 그대로 복원한다", () => {
    const s = session({ uid: "mock-user-minji" });
    expect(verifyTestSession(signTestSession(s, SECRET), SECRET, NOW)).toEqual(s);
  });

  it("만료된 세션은 거부한다", () => {
    const token = signTestSession(session({ exp: NOW }), SECRET);
    expect(verifyTestSession(token, SECRET, NOW)).toBeNull();
  });

  it("비밀번호가 바뀌면 기존 세션은 무효가 된다", () => {
    expect(verifyTestSession(signTestSession(session(), SECRET), "another-password", NOW)).toBeNull();
  });

  it("내용을 바꾸면(사용자·만료 위조) 서명 검증에 실패한다", () => {
    const token = signTestSession(session(), SECRET);
    const [, signature] = token.split(".");
    const forged = Buffer.from(JSON.stringify(session({ uid: "mock-user-junho", exp: NOW + 10 ** 12 }))).toString("base64url");
    expect(verifyTestSession(`${forged}.${signature}`, SECRET, NOW)).toBeNull();
    expect(verifyTestSession(`${token}x`, SECRET, NOW)).toBeNull();
    expect(verifyTestSession("garbage", SECRET, NOW)).toBeNull();
    expect(verifyTestSession(`${token}.extra`, SECRET, NOW)).toBeNull();
  });

  it("공간 id 형식이 잘못된 세션은 서명이 맞아도 거부한다", () => {
    expect(verifyTestSession(signTestSession(session({ sid: "../etc" }), SECRET), SECRET, NOW)).toBeNull();
  });

  it("공간 id는 22자 base64url이고 매번 다르다", () => {
    const a = newSandboxId();
    expect(isSandboxId(a)).toBe(true);
    expect(newSandboxId()).not.toBe(a);
    expect(isSandboxId("short")).toBe(false);
  });
});

describe("passwordMatches", () => {
  it("정확히 같은 비밀번호만 통과한다", () => {
    expect(passwordMatches(SECRET, SECRET)).toBe(true);
    expect(passwordMatches(`${SECRET} `, SECRET)).toBe(false);
    expect(passwordMatches("", SECRET)).toBe(false);
    expect(passwordMatches("x".repeat(1000), SECRET)).toBe(false);
  });
});

describe("createFailureLimiter", () => {
  it("실패가 한도에 이르면 막고, 시간이 지나면 풀린다", () => {
    const limiter = createFailureLimiter(3, 1000);
    for (let i = 0; i < 3; i++) limiter.recordFailure("ip", NOW);
    expect(limiter.isBlocked("ip", NOW)).toBe(true);
    expect(limiter.isBlocked("other", NOW)).toBe(false);
    expect(limiter.isBlocked("ip", NOW + 1000)).toBe(false);
  });

  it("성공하면 초기화한다", () => {
    const limiter = createFailureLimiter(2, 1000);
    limiter.recordFailure("ip", NOW);
    limiter.reset("ip");
    limiter.recordFailure("ip", NOW);
    expect(limiter.isBlocked("ip", NOW)).toBe(false);
  });
});

describe("checkTestMode (proxy)", () => {
  const request = (path: string, token?: string, init?: { method?: string; headers?: Record<string, string> }) => {
    const req = new NextRequest(`https://ntdokdae.vercel.app${path}`, init);
    if (token) req.cookies.set(TEST_SESSION_COOKIE, token);
    return req;
  };
  const enable = () => {
    vi.stubEnv("DOKDAE_TEST_MODE", "true");
    vi.stubEnv("DOKDAE_TEST_PASSWORD", SECRET);
  };

  it("테스트 모드가 꺼져 있으면 /test-login은 404", () => {
    vi.stubEnv("DOKDAE_TEST_MODE", "false");
    const decision = checkTestMode(request("/test-login"), NOW);
    expect(decision.action === "respond" && decision.response.status).toBe(404);
  });

  it("테스트 모드가 켜져 있으면 /test-login을 그대로 통과시킨다", () => {
    enable();
    expect(checkTestMode(request("/test-login"), NOW)).toEqual({ action: "continue", clearCookie: false });
  });

  it("유효한 세션은 통과시킨다", () => {
    enable();
    const token = signTestSession(session(), SECRET);
    expect(checkTestMode(request("/rooms/abc", token), NOW)).toEqual({ action: "continue", clearCookie: false });
  });

  it("만료된 세션으로 보호 화면에 오면 쿠키를 지우고 /test-login?expired=1로 보낸다", () => {
    enable();
    const token = signTestSession(session({ exp: NOW - 1 }), SECRET);
    const decision = checkTestMode(request("/sessions/xyz", token), NOW);
    expect(decision.action).toBe("respond");
    if (decision.action !== "respond") return;
    expect(decision.response.headers.get("location")).toBe("https://ntdokdae.vercel.app/test-login?expired=1");
    expect(decision.response.cookies.get(TEST_SESSION_COOKIE)?.value).toBe("");
  });

  it("테스트 모드를 끈 뒤 남은 쿠키는 보호 화면에서 홈으로 보내고 지운다", () => {
    const token = signTestSession(session(), SECRET);
    vi.stubEnv("DOKDAE_TEST_MODE", "false");
    const decision = checkTestMode(request("/rooms/abc", token), NOW);
    expect(decision.action === "respond" && decision.response.headers.get("location")).toBe("https://ntdokdae.vercel.app/");
  });

  it("보호 화면이 아니거나 Server Action 요청이면 리디렉션 없이 쿠키만 지운다", () => {
    enable();
    const token = signTestSession(session(), "old-password-value");
    expect(checkTestMode(request("/", token), NOW)).toEqual({ action: "continue", clearCookie: true });
    expect(
      checkTestMode(request("/rooms/abc", token, { method: "POST", headers: { "next-action": "abc" } }), NOW),
    ).toEqual({ action: "continue", clearCookie: true });
  });
});
