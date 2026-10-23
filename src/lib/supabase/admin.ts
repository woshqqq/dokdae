import "server-only";
import { createClient } from "@supabase/supabase-js";
import { getSupabasePublicEnv } from "./env";

/**
 * RLS를 우회하는 관리자 클라이언트. 예약 정리(Cron) 같은 서버 작업에만 쓴다.
 * 비밀 키는 NEXT_PUBLIC_ 접두사 없이 서버 환경변수로만 둔다.
 */
export function createSupabaseAdminClient() {
  const { url } = getSupabasePublicEnv();
  const secret = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!secret) throw new Error("SUPABASE_SECRET_KEY(또는 SUPABASE_SERVICE_ROLE_KEY)가 설정되지 않았습니다.");
  return createClient(url, secret, { auth: { persistSession: false, autoRefreshToken: false } });
}
