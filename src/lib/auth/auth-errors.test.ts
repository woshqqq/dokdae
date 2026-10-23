import { AuthApiError, AuthRetryableFetchError, AuthUnknownError } from "@supabase/supabase-js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { describeAuthError, GENERIC_AUTH_ERROR, redactAuthMessage, reportAuthError, resolveSiteOrigin } from "./auth-errors";

afterEach(() => vi.restoreAllMocks());

describe("describeAuthError", () => {
  it.each([
    ["email_address_invalid", "사용할 수 없는 이메일 주소"],
    ["email_address_not_authorized", "인증 메일을 보낼 수 없습니다"],
    ["over_email_send_rate_limit", "메일 발송 한도"],
    ["email_exists", "이미 가입된 이메일"],
    ["signup_disabled", "회원가입을 받지 않습니다"],
  ])("알려진 코드 %s는 구체적인 문구로 바꾼다", (code, expected) => {
    const { userMessage, log } = describeAuthError(new AuthApiError("boom", 400, code));
    expect(userMessage).toContain(expected);
    expect(log).toMatchObject({ code, status: 400 });
  });

  it("unexpected_failure(메일 발송·DB 트리거 실패 등)는 내부 정보 없이 일반 문구로 보여 주고 로그에는 원문을 남긴다", () => {
    const { userMessage, log } = describeAuthError(new AuthApiError("Error sending confirmation email", 500, "unexpected_failure"));
    expect(userMessage).toBe(GENERIC_AUTH_ERROR);
    expect(log).toEqual({ name: "AuthApiError", code: "unexpected_failure", status: 500, message: "Error sending confirmation email" });
  });

  it("네트워크 실패(잘못된 Supabase URL 등)는 연결 문제로 안내한다", () => {
    const { userMessage, log } = describeAuthError(new AuthRetryableFetchError("fetch failed", 0));
    expect(userMessage).toContain("연결하지 못했습니다");
    expect(log.name).toBe("AuthRetryableFetchError");
  });

  it("코드 없는 429는 요청 제한으로 안내한다", () => {
    expect(describeAuthError(new AuthApiError("Too many", 429, undefined)).userMessage).toContain("요청이 너무 많습니다");
  });

  it("인증 오류가 아닌 예외(환경변수 누락 등)는 일반 문구로 바꾼다", () => {
    const { userMessage, log } = describeAuthError(new Error("Supabase 환경변수가 없습니다."));
    expect(userMessage).toBe(GENERIC_AUTH_ERROR);
    expect(log).toEqual({ name: "Error", message: "Supabase 환경변수가 없습니다." });
  });

  it("알 수 없는 오류 객체도 처리한다", () => {
    expect(describeAuthError(new AuthUnknownError("weird", null)).userMessage).toBe(GENERIC_AUTH_ERROR);
  });
});

describe("redactAuthMessage", () => {
  it("메시지 안의 이메일 주소를 가린다", () => {
    expect(redactAuthMessage('Email address "kim.min+test@gmail.com" is invalid')).toBe('Email address "[email]" is invalid');
  });
  it("긴 메시지는 자른다", () => {
    expect(redactAuthMessage("x".repeat(500))).toHaveLength(300);
  });
});

describe("reportAuthError", () => {
  it("코드·상태·메시지와 추가 정보만 로그에 남기고 사용자 문구를 돌려준다", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const message = reportAuthError("signUp", new AuthApiError("Email address \"a@b.co\" is invalid", 400, "email_address_invalid"), {
      redirectOrigin: "https://ntdokdae.vercel.app",
    });
    expect(message).toContain("사용할 수 없는 이메일 주소");
    expect(spy).toHaveBeenCalledWith("[auth] signUp failed", {
      name: "AuthApiError",
      code: "email_address_invalid",
      status: 400,
      message: 'Email address "[email]" is invalid',
      redirectOrigin: "https://ntdokdae.vercel.app",
    });
  });
});

describe("resolveSiteOrigin", () => {
  const fallback = () => "https://from-request.example";

  it("올바른 주소는 origin만 쓴다(끝 슬래시·경로 제거)", () => {
    expect(resolveSiteOrigin("https://ntdokdae.vercel.app/", fallback)).toBe("https://ntdokdae.vercel.app");
    expect(resolveSiteOrigin("https://ntdokdae.vercel.app/some/path", fallback)).toBe("https://ntdokdae.vercel.app");
  });

  it("프로토콜이 빠진 값은 경고 후 요청 호스트를 쓴다", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(resolveSiteOrigin("ntdokdae.vercel.app", fallback)).toBe("https://from-request.example");
    expect(warn).toHaveBeenCalledOnce();
  });

  it("값이 없으면 요청 호스트를 쓴다", () => {
    expect(resolveSiteOrigin(undefined, fallback)).toBe("https://from-request.example");
    expect(resolveSiteOrigin("", fallback)).toBe("https://from-request.example");
  });
});
