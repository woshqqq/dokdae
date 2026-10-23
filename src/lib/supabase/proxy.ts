import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { getSupabasePublicEnv } from "./env";

/**
 * 요청마다 Supabase 세션을 확인하고, 토큰이 갱신되면 새 쿠키를 요청·응답 양쪽에 반영한다.
 * 권한 판단은 여기서 하지 않는다(페이지·RPC가 서버에서 다시 확인).
 */
export async function updateSupabaseSession(request: NextRequest) {
  const { url, key } = getSupabasePublicEnv();
  let response = NextResponse.next({ request });

  const supabase = createServerClient(url, key, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet, headers) {
        for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) response.cookies.set(name, value, options);
        // 인증 쿠키가 실린 응답은 CDN에 캐시되면 안 된다.
        for (const [header, value] of Object.entries(headers ?? {})) response.headers.set(header, value);
      },
    },
  });

  // 서명을 검증하고 필요하면 토큰을 갱신한다. 이 호출과 응답 사이에 다른 로직을 넣지 않는다.
  await supabase.auth.getClaims();
  return response;
}
