import { NextResponse, type NextRequest } from "next/server";
import { getTestModeSecret, TEST_SESSION_COOKIE } from "./config";
import { verifyTestSession } from "./token";

// proxy에서 테스트 모드 접근을 정리한다. 권한 판단의 최종 책임은 페이지·Server Action에 있고
// (만료·위조 쿠키는 그쪽에서도 무시된다), 여기서는 빠르게 막고 쿠키를 치운다.

/** 로그인 또는 테스트 세션이 있어야 하는 화면 */
const PROTECTED_PREFIXES = ["/rooms", "/sessions"];

function isUnder(pathname: string, prefix: string) {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

export type TestModeDecision =
  | { action: "continue"; clearCookie: boolean }
  | { action: "respond"; response: NextResponse };

export function checkTestMode(request: NextRequest, now: number): TestModeDecision {
  const secret = getTestModeSecret();
  const { pathname } = request.nextUrl;

  // 테스트 모드가 꺼져 있으면 진입 페이지 자체가 없는 것처럼 응답한다.
  if (!secret && isUnder(pathname, "/test-login")) {
    return { action: "respond", response: new NextResponse("Not Found", { status: 404 }) };
  }

  const token = request.cookies.get(TEST_SESSION_COOKIE)?.value;
  if (!token) return { action: "continue", clearCookie: false };
  if (secret && verifyTestSession(token, secret, now)) return { action: "continue", clearCookie: false };

  // 만료·위조된 쿠키이거나 테스트 모드가 꺼진 뒤 남은 쿠키. 보호 화면이면 다시 들어가도록 안내한다.
  const isPageView = request.method === "GET" && !request.headers.has("next-action");
  if (isPageView && PROTECTED_PREFIXES.some((p) => isUnder(pathname, p))) {
    const target = new URL(secret ? "/test-login?expired=1" : "/", request.url);
    const response = NextResponse.redirect(target);
    response.cookies.delete(TEST_SESSION_COOKIE);
    return { action: "respond", response };
  }
  return { action: "continue", clearCookie: true };
}
