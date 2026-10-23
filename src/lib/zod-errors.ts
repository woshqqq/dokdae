import type { z } from "zod";

/** Zod 오류를 필드 경로별 첫 메시지로 바꾼다. 서버·클라이언트 공용. */
export function fieldErrorsOf(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.join(".");
    out[key] ??= issue.message;
  }
  return out;
}
