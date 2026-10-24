// 비회원 테스트 모드 설정. proxy에서도 읽으므로 server-only를 붙이지 않는다
// (NEXT_PUBLIC_ 접두사가 없으므로 브라우저 번들에는 들어가지 않는다).

export const TEST_SESSION_COOKIE = "dokdae_test_session";
/** 테스트 세션 유지 시간. 만료되면 다시 비밀번호를 입력해야 한다. */
export const TEST_SESSION_TTL_MS = 8 * 60 * 60 * 1000;
const MIN_PASSWORD_LENGTH = 8;

/**
 * 테스트 모드가 켜져 있으면 공통 비밀번호를, 아니면 null을 돌려준다.
 * DOKDAE_TEST_MODE=true 이고 DOKDAE_TEST_PASSWORD가 충분히 길 때만 켜진다(설정이 빠지면 꺼진 쪽으로 동작).
 */
export function getTestModeSecret(): string | null {
  if (process.env.DOKDAE_TEST_MODE !== "true") return null;
  const password = process.env.DOKDAE_TEST_PASSWORD;
  if (!password || password.length < MIN_PASSWORD_LENGTH) return null;
  return password;
}

export function isTestModeEnabled() {
  return getTestModeSecret() !== null;
}
