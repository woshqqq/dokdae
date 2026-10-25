import { NextResponse, type NextRequest } from "next/server";
import { getDataSource } from "@/lib/config";
import { updateSupabaseSession } from "@/lib/supabase/proxy";
import { TEST_SESSION_COOKIE } from "@/lib/test-mode/config";
import { checkTestMode } from "@/lib/test-mode/proxy";

/** 독대 라이트(참가자 토큰 쿠키) 화면과 API. Supabase Auth 세션 갱신이 필요 없다. */
function isLiteRoute(pathname: string) {
  return (
    pathname === "/" ||
    pathname === "/admin" ||
    pathname.startsWith("/room/") ||
    pathname.startsWith("/api/dd/")
  );
}

export async function proxy(request: NextRequest) {
  const test = checkTestMode(request, Date.now());
  if (test.action === "respond") return test.response;

  const lite = isLiteRoute(request.nextUrl.pathname);
  const response = !lite && getDataSource() === "supabase" ? await updateSupabaseSession(request) : NextResponse.next();
  if (lite) {
    // 초대 코드·참가자 화면의 주소가 외부 사이트로 새지 않게 한다.
    response.headers.set("Referrer-Policy", "no-referrer");
    response.headers.set("X-Content-Type-Options", "nosniff");
  }
  if (test.clearCookie) response.cookies.delete(TEST_SESSION_COOKIE);
  return response;
}

export const config = {
  // 정적 파일·이미지는 제외한다.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
};
