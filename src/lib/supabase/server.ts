import "server-only";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { getSupabasePublicEnv } from "./env";

/**
 * 서버 컴포넌트·Server Action·Route Handler용 클라이언트. 요청마다 새로 만든다.
 * 로그인 사용자의 세션(쿠키)으로 요청하므로 DB에서는 RLS와 auth.uid()가 그대로 적용된다.
 */
export async function createSupabaseServerClient() {
  const { url, key } = getSupabasePublicEnv();
  const cookieStore = await cookies();
  return createServerClient(url, key, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) cookieStore.set(name, value, options);
        } catch {
          // 서버 컴포넌트에서는 쿠키를 쓸 수 없다. 세션 갱신은 src/proxy.ts가 담당한다.
        }
      },
    },
  });
}
