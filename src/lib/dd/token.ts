import { createHash, randomBytes, randomInt } from "node:crypto";

// 참가자 비밀 토큰: 256비트 난수(base64url). DB에는 SHA-256 해시만 저장한다.
// 토큰 자체가 고엔트로피라 느린 해시(bcrypt 등)는 필요 없다.

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export function newParticipantToken() {
  return randomBytes(32).toString("base64url");
}

export function isWellFormedToken(value: string) {
  return TOKEN_PATTERN.test(value);
}

export function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

// 초대 코드: 헷갈리는 글자(0/O, 1/I/L)를 뺀 31자 중 8자. 화면에는 ABCD-EFGH 로 보여준다.
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const CODE_LENGTH = 8;

export function generateInviteCode() {
  let out = "";
  for (let i = 0; i < CODE_LENGTH; i++) out += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  return out;
}

/** 입력값에서 공백·하이픈을 없애고 대문자로 맞춘다. 형식이 맞지 않으면 null. */
export function normalizeInviteCode(input: string): string | null {
  const code = input.replace(/[\s-]/g, "").toUpperCase();
  return /^[A-Z0-9]{8}$/.test(code) ? code : null;
}

export function formatInviteCode(code: string) {
  return `${code.slice(0, 4)}-${code.slice(4)}`;
}
