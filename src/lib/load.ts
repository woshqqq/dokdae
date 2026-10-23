import "server-only";
import { DataError, toUserMessage, type DataErrorCode } from "@/lib/data/errors";

export type Loaded<T> = { ok: true; data: T } | { ok: false; code: DataErrorCode | "UNKNOWN"; message: string };

/** 서버 컴포넌트에서 조회 실패를 화면 상태(권한 없음·없음 등)로 바꾼다. */
export async function load<T>(fn: () => Promise<T>): Promise<Loaded<T>> {
  try {
    return { ok: true, data: await fn() };
  } catch (error) {
    if (error instanceof DataError) return { ok: false, code: error.code, message: error.message };
    console.error(error);
    return { ok: false, code: "UNKNOWN", message: toUserMessage(error) };
  }
}
