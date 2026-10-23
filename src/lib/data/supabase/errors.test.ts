import { afterEach, describe, expect, it, vi } from "vitest";
import { safeNextPath } from "@/lib/auth/safe-next";
import { getDataSource } from "@/lib/config";
import { DataError } from "../errors";
import { toDataError } from "./errors";

describe("toDataError", () => {
  it("RPC가 던진 앱 오류 코드와 상세 문구를 그대로 옮긴다", () => {
    const e = toDataError({ message: "VALIDATION", code: "P0001", details: "닉네임은 1~20자로 입력해 주세요." });
    expect(e).toBeInstanceOf(DataError);
    expect(e?.code).toBe("VALIDATION");
    expect(e?.message).toBe("닉네임은 1~20자로 입력해 주세요.");
  });

  it("상세 문구가 없으면 기본 한국어 메시지를 쓴다", () => {
    expect(toDataError({ message: "INSUFFICIENT_BALANCE", code: "P0001", details: "" })?.message).toBe("토큰이 부족합니다.");
  });

  it("Postgres·PostgREST 오류 코드를 앱 오류로 바꾼다", () => {
    expect(toDataError({ message: "new row violates check constraint", code: "23514" })?.code).toBe("VALIDATION");
    expect(toDataError({ message: "invalid input syntax for type uuid", code: "22P02" })?.code).toBe("NOT_FOUND");
    expect(toDataError({ message: "permission denied for function", code: "42501" })?.code).toBe("FORBIDDEN");
    expect(toDataError({ message: "JWT expired", code: "PGRST301" })?.code).toBe("UNAUTHENTICATED");
    expect(toDataError({ message: "Could not find the function", code: "PGRST202" })?.code).toBe("BACKEND_NOT_READY");
  });

  it("알 수 없는 오류는 변환하지 않는다(내부 메시지를 화면에 노출하지 않기 위함)", () => {
    expect(toDataError({ message: "connection reset", code: "08006" })).toBeNull();
    expect(toDataError({ message: "toString" })).toBeNull();
  });
});

describe("safeNextPath", () => {
  it("같은 사이트의 절대 경로만 허용한다", () => {
    expect(safeNextPath("/rooms/abc")).toBe("/rooms/abc");
    expect(safeNextPath("https://evil.example")).toBe("/");
    expect(safeNextPath("//evil.example")).toBe("/");
    expect(safeNextPath("/\\evil.example")).toBe("/");
    expect(safeNextPath(null)).toBe("/");
  });
});

describe("getDataSource", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("명시한 값을 따른다", () => {
    vi.stubEnv("DOKDAE_DATA_SOURCE", "supabase");
    expect(getDataSource()).toBe("supabase");
    vi.stubEnv("DOKDAE_DATA_SOURCE", "mock");
    vi.stubEnv("NODE_ENV", "production");
    expect(getDataSource()).toBe("mock");
  });

  it("값이 없으면 프로덕션에서는 데모 모드가 켜지지 않는다", () => {
    vi.stubEnv("DOKDAE_DATA_SOURCE", "");
    vi.stubEnv("NODE_ENV", "production");
    expect(getDataSource()).toBe("supabase");
    vi.stubEnv("NODE_ENV", "development");
    expect(getDataSource()).toBe("mock");
  });
});
