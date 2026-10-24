import { NextResponse, type NextRequest } from "next/server";
import { getDataSource } from "@/lib/config";
import { updateSupabaseSession } from "@/lib/supabase/proxy";
import { TEST_SESSION_COOKIE } from "@/lib/test-mode/config";
import { checkTestMode } from "@/lib/test-mode/proxy";

export async function proxy(request: NextRequest) {
  const test = checkTestMode(request, Date.now());
  if (test.action === "respond") return test.response;

  const response = getDataSource() === "supabase" ? await updateSupabaseSession(request) : NextResponse.next();
  if (test.clearCookie) response.cookies.delete(TEST_SESSION_COOKIE);
  return response;
}

export const config = {
  // 정적 파일·이미지는 제외한다.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
};
