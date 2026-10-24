import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { getDataSource } from "@/lib/config";
import { MOCK_USERS } from "@/lib/data/mock/store";
import type { CurrentUser } from "@/lib/data/types";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { readTestSession } from "@/lib/test-mode/session";
import type { TestSession } from "@/lib/test-mode/token";

export const MOCK_SESSION_COOKIE = "dokdae_mock_user";

/**
 * 이 요청이 어떤 인증·데이터로 처리되는지.
 * - test: 유효한 비회원 테스트 세션. 세션별 테스트 공간(mock)만 쓰고 Supabase에는 접근하지 않는다.
 * - mock / supabase: DOKDAE_DATA_SOURCE 설정 그대로.
 */
export type AuthContext = { kind: "supabase" } | { kind: "mock" } | { kind: "test"; session: TestSession };

export const getAuthContext = cache(async (): Promise<AuthContext> => {
  const session = await readTestSession();
  if (session) return { kind: "test", session };
  return { kind: getDataSource() };
});

function mockUser(id: string | null | undefined): CurrentUser | null {
  const user = MOCK_USERS.find((u) => u.id === id);
  return user ? { id: user.id, displayName: user.displayName } : null;
}

/** 현재 로그인 사용자. 요청 단위로 한 번만 읽는다. */
export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  const context = await getAuthContext();
  if (context.kind === "test") return mockUser(context.session.uid);
  if (context.kind === "supabase") {
    const supabase = await createSupabaseServerClient();
    // getClaims()는 JWT 서명을 검증한다(쿠키 내용을 그대로 믿지 않음).
    const { data, error } = await supabase.auth.getClaims();
    const sub = data?.claims?.sub;
    if (error || !sub) return null;
    const { data: profile } = await supabase.from("profiles").select("display_name").eq("id", sub).maybeSingle();
    const email = typeof data.claims.email === "string" ? data.claims.email : "";
    return { id: sub, displayName: profile?.display_name ?? (email.split("@")[0] || "사용자") };
  }
  // 임시 모드: 데모 사용자 선택 쿠키. 실제 인증이 아니다.
  return mockUser((await cookies()).get(MOCK_SESSION_COOKIE)?.value);
});

export async function requireUser(next?: string): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) redirect(next ? `/?next=${encodeURIComponent(next)}` : "/");
  return user;
}
