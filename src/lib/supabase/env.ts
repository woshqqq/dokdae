// 브라우저에 노출되어도 되는 공개 값만 다룬다. 비밀 키는 admin.ts(server-only)에서만 읽는다.

export function getSupabasePublicEnv() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) {
    throw new Error(
      "Supabase 환경변수가 없습니다. .env.local에 NEXT_PUBLIC_SUPABASE_URL과 NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY를 설정하세요.",
    );
  }
  return { url, key };
}
