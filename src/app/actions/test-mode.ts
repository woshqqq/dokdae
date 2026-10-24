"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { openSandbox } from "@/lib/data/mock/sandboxes";
import { getTestModeSecret, TEST_SESSION_TTL_MS } from "@/lib/test-mode/config";
import { createFailureLimiter } from "@/lib/test-mode/rate-limit";
import { clearTestSession, writeTestSession } from "@/lib/test-mode/session";
import { isSandboxId, newSandboxId, passwordMatches } from "@/lib/test-mode/token";

export type TestLoginState = { error?: string };

const globalForLimiter = globalThis as unknown as { __dokdaeTestLoginLimiter?: ReturnType<typeof createFailureLimiter> };
const limiter = (globalForLimiter.__dokdaeTestLoginLimiter ??= createFailureLimiter());

async function clientKey() {
  const h = await headers();
  return h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || "unknown";
}

/** 공통 비밀번호를 서버에서 확인하고 테스트 세션을 시작한다. 공간 코드를 넣으면 그 공간에 합류한다. */
export async function startTestSession(_prev: TestLoginState, formData: FormData): Promise<TestLoginState> {
  const secret = getTestModeSecret();
  if (!secret) return { error: "테스트 모드가 꺼져 있습니다." };

  const key = await clientKey();
  const now = Date.now();
  if (limiter.isBlocked(key, now)) return { error: "시도가 너무 많습니다. 10분 뒤에 다시 시도해 주세요." };

  const password = String(formData.get("password") ?? "");
  if (!passwordMatches(password, secret)) {
    limiter.recordFailure(key, now);
    return { error: "테스트 비밀번호가 올바르지 않습니다." };
  }
  limiter.reset(key);

  const code = String(formData.get("sandboxCode") ?? "").trim();
  if (code && !isSandboxId(code)) return { error: "테스트 공간 코드 형식이 올바르지 않습니다." };
  const sid = code || newSandboxId();
  openSandbox(sid, now);
  await writeTestSession({ sid, uid: null, exp: now + TEST_SESSION_TTL_MS });
  redirect("/");
}

/** 테스트 세션 쿠키를 지운다. 공간은 다른 참여자가 쓰고 있을 수 있으므로 유휴 정리에 맡긴다. */
export async function endTestSession() {
  await clearTestSession();
  redirect(getTestModeSecret() ? "/test-login?ended=1" : "/");
}
