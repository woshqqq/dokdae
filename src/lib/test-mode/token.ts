import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

// 테스트 세션 토큰: base64url(JSON) + "." + HMAC-SHA256 서명.
// 서명 키는 공통 비밀번호에서 만들므로 비밀번호를 바꾸면 기존 세션이 모두 무효가 된다.

export type TestSession = {
  /** 테스트 공간(격리된 mock DB) id */
  sid: string;
  /** 공간 안에서 고른 데모 사용자. 아직 고르지 않았으면 null */
  uid: string | null;
  /** 만료 시각(epoch ms) */
  exp: number;
};

const SANDBOX_ID_PATTERN = /^[A-Za-z0-9_-]{22}$/;

export function isSandboxId(value: string) {
  return SANDBOX_ID_PATTERN.test(value);
}

/** 추측할 수 없는 128비트 공간 id */
export function newSandboxId() {
  return randomBytes(16).toString("base64url");
}

function deriveKey(secret: string, label: string) {
  return createHmac("sha256", secret).update(label).digest();
}

function sign(body: string, secret: string) {
  return createHmac("sha256", deriveKey(secret, "dokdae-test-session-v1")).update(body).digest("base64url");
}

function safeEqual(a: Buffer, b: Buffer) {
  return a.length === b.length && timingSafeEqual(a, b);
}

/** 길이·내용과 관계없이 일정한 시간으로 비밀번호를 비교한다. */
export function passwordMatches(input: string, secret: string) {
  const key = deriveKey(secret, "dokdae-test-password-v1");
  const digest = (value: string) => createHmac("sha256", key).update(value).digest();
  return safeEqual(digest(input), digest(secret));
}

export function signTestSession(session: TestSession, secret: string) {
  const body = Buffer.from(JSON.stringify(session)).toString("base64url");
  return `${body}.${sign(body, secret)}`;
}

/** 서명·형식·만료를 모두 확인한다. 하나라도 어긋나면 null. */
export function verifyTestSession(token: string, secret: string, now: number): TestSession | null {
  const [body, signature, ...rest] = token.split(".");
  if (!body || !signature || rest.length > 0) return null;
  if (!safeEqual(Buffer.from(signature), Buffer.from(sign(body, secret)))) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const { sid, uid, exp } = parsed as Record<string, unknown>;
  if (typeof sid !== "string" || !isSandboxId(sid)) return null;
  if (uid !== null && typeof uid !== "string") return null;
  if (typeof exp !== "number" || exp <= now) return null;
  return { sid, uid, exp };
}
