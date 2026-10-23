/** 로그인 후 이동할 경로. 같은 사이트의 절대 경로만 허용한다(오픈 리다이렉트 방지). */
export function safeNextPath(next: string | null | undefined) {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) return "/";
  return next;
}
