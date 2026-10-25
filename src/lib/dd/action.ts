import { unstable_rethrow } from "next/navigation";
import type { z } from "zod";
import { DdError } from "./errors";

export type DdResult<T = null> = { ok: true; data: T } | { ok: false; error: string; code?: string };

/** Server Action 본문을 감싸 DdError 를 사용자용 결과로 바꾼다. redirect 등 프레임워크 제어 흐름은 그대로 던진다. */
export async function ddAction<T>(fn: () => Promise<T>): Promise<DdResult<T>> {
  try {
    return { ok: true, data: await fn() };
  } catch (error) {
    unstable_rethrow(error);
    if (error instanceof DdError) return { ok: false, error: error.message, code: error.code };
    console.error("dd action failed", error instanceof Error ? error.name : "unknown");
    return { ok: false, error: new DdError("INTERNAL").message, code: "INTERNAL" };
  }
}

export function parse<S extends z.ZodType>(schema: S, input: unknown): z.infer<S> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) throw new DdError("VALIDATION", parsed.error.issues[0]?.message);
  return parsed.data;
}
