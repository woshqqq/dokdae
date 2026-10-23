import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { getDataSource } from "@/lib/config";
import { MOCK_USERS } from "@/lib/data/mock/store";
import type { CurrentUser } from "@/lib/data/types";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const MOCK_SESSION_COOKIE = "dokdae_mock_user";

/** 현재 로그인 사용자. 요청 단위로 한 번만 읽는다. */
export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  if (getDataSource() === "supabase") {
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
  const id = (await cookies()).get(MOCK_SESSION_COOKIE)?.value;
  const user = MOCK_USERS.find((u) => u.id === id);
  return user ? { id: user.id, displayName: user.displayName } : null;
});

export async function requireUser(next?: string): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) redirect(next ? `/?next=${encodeURIComponent(next)}` : "/");
  return user;
}
