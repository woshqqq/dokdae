import { describe, expect, it } from "vitest";
import { adminPasswordMatches, signAdminSession, verifyAdminSession } from "./admin-session";
import { fromRpcError } from "./errors";
import { sniffImage, validatePhoto } from "./photo";
import { generateInviteCode, hashToken, isWellFormedToken, newParticipantToken, normalizeInviteCode, formatInviteCode } from "./token";
import { defaultQuestionSchema, profileSchema } from "./validation";

describe("참가자 토큰·초대 코드", () => {
  it("토큰은 충분히 길고 매번 다르며, 해시는 원문을 드러내지 않는다", () => {
    const a = newParticipantToken();
    const b = newParticipantToken();
    expect(a).not.toBe(b);
    expect(isWellFormedToken(a)).toBe(true);
    expect(isWellFormedToken("short")).toBe(false);
    expect(hashToken(a)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashToken(a)).not.toContain(a);
    expect(hashToken(a)).toBe(hashToken(a));
  });

  it("초대 코드는 8자이며 헷갈리는 글자가 없고, 입력은 정규화된다", () => {
    for (let i = 0; i < 50; i++) expect(generateInviteCode()).toMatch(/^[A-HJKMNP-Z2-9]{8}$/);
    expect(normalizeInviteCode(" abcd-efgh ")).toBe("ABCDEFGH");
    expect(normalizeInviteCode("abc")).toBeNull();
    expect(normalizeInviteCode("ABCD-EFG!")).toBeNull();
    expect(formatInviteCode("ABCDEFGH")).toBe("ABCD-EFGH");
  });
});

describe("사진 검증", () => {
  const jpeg = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 0]);
  const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);
  const webp = Uint8Array.from([...Buffer.from("RIFF"), 0, 0, 0, 0, ...Buffer.from("WEBP")]);

  it("실제 파일 형식과 선언된 MIME 이 모두 맞아야 통과한다", () => {
    expect(validatePhoto("image/jpeg", jpeg)?.ext).toBe("jpg");
    expect(validatePhoto("image/png", png)?.ext).toBe("png");
    expect(validatePhoto("image/webp", webp)?.ext).toBe("webp");
    expect(validatePhoto("image/png", jpeg)).toBeNull(); // 확장자·MIME 위장
    expect(validatePhoto("image/gif", jpeg)).toBeNull();
    expect(validatePhoto("text/html", Buffer.from("<script>alert(1)</script>"))).toBeNull();
    expect(sniffImage(Buffer.from("<svg onload=alert(1)>"))).toBeNull();
  });

  it("빈 파일과 1MB 초과 파일은 거절한다", () => {
    expect(validatePhoto("image/jpeg", new Uint8Array())).toBeNull();
    const big = new Uint8Array(1_000_001);
    big.set(jpeg);
    expect(validatePhoto("image/jpeg", big)).toBeNull();
    const limit = new Uint8Array(1_000_000);
    limit.set(jpeg);
    expect(validatePhoto("image/jpeg", limit)).not.toBeNull();
  });
});

describe("관리자 세션", () => {
  const password = "correct-horse-battery";
  const now = 1_000_000;

  it("서명과 만료를 확인한다", () => {
    const token = signAdminSession(password, now + 1000);
    expect(verifyAdminSession(token, password, now)).toBe(true);
    expect(verifyAdminSession(token, password, now + 1000)).toBe(false); // 만료
    expect(verifyAdminSession(token, "another-password", now)).toBe(false); // 비밀번호 변경
    expect(verifyAdminSession(token, null, now)).toBe(false); // 관리자 기능 꺼짐
    expect(verifyAdminSession(undefined, password, now)).toBe(false);
  });

  it("위조·변조된 토큰은 거절하고, 토큰에 비밀번호가 들어 있지 않다", () => {
    const token = signAdminSession(password, now + 1000);
    const [body, sig] = token.split(".");
    const forgedBody = Buffer.from(JSON.stringify({ exp: now + 10 ** 9, n: "x" })).toString("base64url");
    expect(verifyAdminSession(`${forgedBody}.${sig}`, password, now)).toBe(false);
    expect(verifyAdminSession(`${body}.`, password, now)).toBe(false);
    expect(verifyAdminSession("garbage", password, now)).toBe(false);
    expect(Buffer.from(body, "base64url").toString()).not.toContain(password);
  });

  it("비밀번호 비교", () => {
    expect(adminPasswordMatches(password, password)).toBe(true);
    expect(adminPasswordMatches("wrong", password)).toBe(false);
    expect(adminPasswordMatches("", password)).toBe(false);
  });
});

describe("검증·오류 매핑", () => {
  it("프로필·기본 질문 입력을 검증한다", () => {
    expect(profileSchema.safeParse({ nickname: " 에이 ", bio: "" }).data).toEqual({ nickname: "에이", bio: "" });
    expect(profileSchema.safeParse({ nickname: "", bio: "" }).success).toBe(false);
    expect(profileSchema.safeParse({ nickname: "a".repeat(21), bio: "" }).success).toBe(false);
    expect(profileSchema.safeParse({ nickname: "a", bio: "b".repeat(301) }).success).toBe(false);
    const q = { id: "00000000-0000-4000-8000-0000000000a1", title: "제목", body: "본문", hint: "", position: 2 };
    expect(defaultQuestionSchema.safeParse(q).success).toBe(true);
    expect(defaultQuestionSchema.safeParse({ ...q, id: "x" }).success).toBe(false);
    expect(defaultQuestionSchema.safeParse({ ...q, body: " " }).success).toBe(false);
    expect(defaultQuestionSchema.safeParse({ ...q, position: 1.5 }).success).toBe(false);
  });

  it("DB 오류 코드는 사용자용 메시지로 바뀌고 알 수 없는 오류의 내부 정보는 숨긴다", () => {
    expect(fromRpcError({ message: "NICKNAME_TAKEN" }).code).toBe("NICKNAME_TAKEN");
    expect(fromRpcError({ message: "relation x", code: "42P01" }).code).toBe("BACKEND_NOT_READY");
    const unknown = fromRpcError({ message: 'secret detail "dd_participants"', code: "XX000" });
    expect(unknown.code).toBe("INTERNAL");
    expect(unknown.message).not.toContain("dd_participants");
  });
});
