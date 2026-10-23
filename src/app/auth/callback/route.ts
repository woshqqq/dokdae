import type { EmailOtpType } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import { reportAuthError } from "@/lib/auth/auth-errors";
import { safeNextPath } from "@/lib/auth/safe-next";
import { getDataSource } from "@/lib/config";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * 이메일 확인 링크의 도착지.
 * - PKCE 흐름: ?code=... → 세션 교환
 * - 토큰 해시 흐름(이메일 템플릿을 바꾼 경우): ?token_hash=...&type=... → OTP 검증
 */
export async function GET(request: NextRequest) {
  const url = request.nextUrl;
  const next = safeNextPath(url.searchParams.get("next"));
  const fail = NextResponse.redirect(new URL("/?error=auth_callback", url.origin));
  if (getDataSource() !== "supabase") return fail;

  const supabase = await createSupabaseServerClient();
  const code = url.searchParams.get("code");
  const tokenHash = url.searchParams.get("token_hash");
  const type = url.searchParams.get("type") as EmailOtpType | null;

  const { error } = code
    ? await supabase.auth.exchangeCodeForSession(code)
    : tokenHash && type
      ? await supabase.auth.verifyOtp({ token_hash: tokenHash, type })
      : { error: new Error("missing code") };

  if (error) {
    reportAuthError("callback", error, { flow: code ? "pkce" : tokenHash ? "token_hash" : "missing" });
    return fail;
  }
  return NextResponse.redirect(new URL(next, url.origin));
}
