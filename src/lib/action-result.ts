import { unstable_rethrow } from "next/navigation";
import type { z } from "zod";
import { DataError, toUserMessage } from "@/lib/data/errors";

export type ActionResult<T = null> =
  | { ok: true; data: T; message?: string }
  | { ok: false; error: string; code?: string; fieldErrors?: Record<string, string> };

/** Server Action 본문을 감싸 DataError를 사용자용 결과로 바꾼다. redirect 등 프레임워크 제어 흐름은 그대로 던진다. */
export async function runAction<T>(fn: () => Promise<T>, message?: string): Promise<ActionResult<T>> {
  try {
    return { ok: true, data: await fn(), message };
  } catch (error) {
    unstable_rethrow(error);
    if (!(error instanceof DataError)) console.error(error);
    return { ok: false, error: toUserMessage(error), code: error instanceof DataError ? error.code : undefined };
  }
}

export function parseInput<S extends z.ZodType>(schema: S, input: unknown): z.infer<S> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) throw new DataError("VALIDATION", parsed.error.issues[0]?.message);
  return parsed.data;
}
