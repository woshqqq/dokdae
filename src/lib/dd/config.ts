// 독대 라이트 설정값. proxy·서버 어디서든 import 할 수 있도록 server-only를 붙이지 않는다(비밀값 없음).

export const PARTICIPANT_COOKIE_PREFIX = "dd_p_";
/** 참가자 쿠키 유지 기간. 쿠키를 잃으면 같은 참가자로 돌아올 수 없다(이메일 복구 수단이 없음). */
export const PARTICIPANT_COOKIE_MAX_AGE_SECONDS = 180 * 24 * 60 * 60;

export const ADMIN_COOKIE = "dd_admin";
export const ADMIN_SESSION_TTL_MS = 2 * 60 * 60 * 1000;
const ADMIN_MIN_PASSWORD_LENGTH = 8;

/** 사진은 DB(bytea)에 저장한다. DB 제약(1MiB)보다 작게 잡는다. */
export const PHOTO_MAX_BYTES = 1_000_000;
export const PHOTO_MIME_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;

/** 관리자 비밀번호. 설정되지 않았거나 너무 짧으면 null 이며 관리자 기능은 모두 차단된다. */
export function getAdminPassword(): string | null {
  const password = process.env.DOKDAE_ADMIN_PASSWORD;
  if (!password || password.length < ADMIN_MIN_PASSWORD_LENGTH) return null;
  return password;
}
