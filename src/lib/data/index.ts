import "server-only";
import { getAuthContext, getCurrentUser } from "@/lib/auth/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createMockRepository } from "./mock/repository";
import { getSandbox } from "./mock/sandboxes";
import type { DokdaeRepository } from "./repository";
import { createSupabaseRepository } from "./supabase/repository";

/** 현재 로그인 사용자에 묶인 저장소. 화면과 Server Action은 이 함수만 사용한다. */
export async function getRepository(): Promise<DokdaeRepository> {
  const context = await getAuthContext();
  if (context.kind === "test") {
    // 테스트 세션은 Supabase 클라이언트를 만들지 않는다. 운영 데이터와 완전히 분리된 세션별 공간만 쓴다.
    const { sid, uid } = context.session;
    return createMockRepository(uid, () => getSandbox(sid, Date.now()).db);
  }
  if (context.kind === "supabase") {
    // 사용자의 세션 쿠키로 요청한다. 미인증이면 DB 함수가 UNAUTHENTICATED/권한 거부로 응답한다.
    return createSupabaseRepository(await createSupabaseServerClient());
  }
  const user = await getCurrentUser();
  return createMockRepository(user?.id ?? null);
}
