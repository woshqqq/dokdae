import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

// 관리자 세션 쿠키 값: base64url(JSON {exp, n}) + "." + HMAC-SHA256.
// 서명 키는 관리자 비밀번호에서 만들므로 비밀번호를 바꾸면 기존 세션이 모두 무효가 된다.
// 비밀번호나 서명 키는 쿠키에 들어가지 않는다.

const key = (password: string) => createHmac("sha256", password).update("dokdae-admin-session-v1").digest();
const sign = (body: string, password: string) => createHmac("sha256", key(password)).update(body).digest("base64url");

export function signAdminSession(password: string, exp: number) {
  const body = Buffer.from(JSON.stringify({ exp, n: randomBytes(8).toString("hex") })).toString("base64url");
  return `${body}.${sign(body, password)}`;
}

export function verifyAdminSession(token: string | undefined, password: string | null, now: number): boolean {
  if (!token || !password) return false;
  const [body, signature, ...rest] = token.split(".");
  if (!body || !signature || rest.length > 0) return false;
  const given = Buffer.from(signature);
  const expected = Buffer.from(sign(body, password));
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return false;
  try {
    const parsed: unknown = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    const exp = (parsed as { exp?: unknown } | null)?.exp;
    return typeof exp === "number" && exp > now;
  } catch {
    return false;
  }
}

/** 길이·내용과 관계없이 일정한 시간으로 비밀번호를 비교한다. */
export function adminPasswordMatches(input: string, password: string) {
  const digest = (v: string) => createHmac("sha256", key(password)).update(v).digest();
  return timingSafeEqual(digest(input), digest(password));
}

/**
 * DB 함수에 보내는 관리자 증명값(HMAC). 비밀번호 자체는 DB로 보내지 않는다.
 * DB에는 이 값의 SHA-256 해시만 등록한다(scripts/admin-proof.mjs 가 등록용 SQL을 만든다).
 */
export function adminDbProof(password: string) {
  return createHmac("sha256", password).update("dokdae-admin-db-proof-v1").digest("hex");
}
