import "server-only";
import { getCurrentUser } from "@/lib/auth/session";
import { getDataSource } from "@/lib/config";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createMockRepository } from "./mock/repository";
import type { DokdaeRepository } from "./repository";
import { createSupabaseRepository } from "./supabase/repository";

/** 현재 로그인 사용자에 묶인 저장소. 화면과 Server Action은 이 함수만 사용한다. */
export async function getRepository(): Promise<DokdaeRepository> {
  if (getDataSource() === "supabase") {
    // 사용자의 세션 쿠키로 요청한다. 미인증이면 DB 함수가 UNAUTHENTICATED/권한 거부로 응답한다.
    return createSupabaseRepository(await createSupabaseServerClient());
  }
  const user = await getCurrentUser();
  return createMockRepository(user?.id ?? null);
}
