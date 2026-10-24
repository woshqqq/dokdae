import "server-only";
import { io } from "next/cache";
import { cookies } from "next/headers";
import { getTestModeSecret, TEST_SESSION_COOKIE } from "./config";
import { signTestSession, verifyTestSession, type TestSession } from "./token";

/** 요청 쿠키의 테스트 세션. 테스트 모드가 꺼져 있거나 서명·만료가 맞지 않으면 null. */
export async function readTestSession(): Promise<TestSession | null> {
  const secret = getTestModeSecret();
  if (!secret) return null;
  const token = (await cookies()).get(TEST_SESSION_COOKIE)?.value;
  if (!token) return null;
  // 만료 확인에 현재 시각이 필요하다. 사전 렌더링 중에는 여기서 멈춘다.
  await io();
  return verifyTestSession(token, secret, Date.now());
}

/** Server Action 전용: 세션 쿠키를 발급·갱신한다. 만료 시각은 세션의 exp를 그대로 쓴다. */
export async function writeTestSession(session: TestSession) {
  const secret = getTestModeSecret();
  if (!secret) throw new Error("테스트 모드가 꺼져 있습니다.");
  (await cookies()).set(TEST_SESSION_COOKIE, signTestSession(session, secret), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: new Date(session.exp),
  });
}

export async function clearTestSession() {
  (await cookies()).delete(TEST_SESSION_COOKIE);
}
