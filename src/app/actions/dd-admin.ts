"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { adminDbProof, adminPasswordMatches } from "@/lib/dd/admin-session";
import { endAdminSession, isAdminAuthenticated, startAdminSession } from "@/lib/dd/admin";
import { ddAction, parse } from "@/lib/dd/action";
import { getAdminPassword } from "@/lib/dd/config";
import { ddRpc } from "@/lib/dd/db";
import { DdError } from "@/lib/dd/errors";
import { defaultQuestionSchema } from "@/lib/dd/validation";
import { createFailureLimiter } from "@/lib/test-mode/rate-limit";

export type AdminLoginState = { error?: string };

const globalForLimiter = globalThis as unknown as { __ddAdminLimiter?: ReturnType<typeof createFailureLimiter> };
const limiter = (globalForLimiter.__ddAdminLimiter ??= createFailureLimiter(5, 10 * 60 * 1000));

async function clientKey() {
  const h = await headers();
  return h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || "unknown";
}

/** 관리자 비밀번호를 서버에서 확인하고 만료되는 세션을 시작한다. 비밀번호가 설정되어 있지 않으면 항상 거부한다. */
export async function adminLoginAction(_prev: AdminLoginState, formData: FormData): Promise<AdminLoginState> {
  const password = getAdminPassword();
  if (!password) return { error: "관리자 기능이 꺼져 있습니다." };

  const key = await clientKey();
  const now = Date.now();
  if (limiter.isBlocked(key, now)) return { error: "시도가 너무 많습니다. 10분 뒤에 다시 시도해 주세요." };

  const input = String(formData.get("password") ?? "");
  if (!adminPasswordMatches(input, password)) {
    limiter.recordFailure(key, now);
    return { error: "비밀번호가 올바르지 않습니다." };
  }
  limiter.reset(key);
  await startAdminSession(password);
  redirect("/admin");
}

export async function adminLogoutAction() {
  await endAdminSession();
  redirect("/admin");
}

/** 기본 질문의 제목·본문·설명·순서만 수정한다. 질문 ID는 그대로라 기존 답변 연결이 유지된다. */
export async function updateDefaultQuestionAction(input: unknown) {
  return ddAction(async () => {
    if (!(await isAdminAuthenticated())) throw new DdError("UNAUTHENTICATED", "관리자 로그인이 필요합니다.");
    const q = parse(defaultQuestionSchema, input);
    const password = getAdminPassword();
    if (!password) throw new DdError("UNAUTHENTICATED", "관리자 기능이 꺼져 있습니다.");
    // 비밀번호가 아닌 파생 증명값만 DB로 보낸다. DB는 등록된 해시와 일치할 때만 수정하고 실패 횟수를 제한한다.
    const status = await ddRpc<string>("dd_api_admin_update_question", {
      p_proof: adminDbProof(password),
      p_id: q.id,
      p_title: q.title,
      p_body: q.body,
      p_hint: q.hint,
      p_position: q.position,
    });
    if (status === "locked") throw new DdError("RATE_LIMITED");
    if (status === "denied") {
      throw new DdError("UNAUTHENTICATED", "DB에 관리자 증명이 등록되지 않았거나 일치하지 않습니다. README의 'npm run admin:proof' 절차를 확인하세요.");
    }
    if (status === "not_found") throw new DdError("NOT_FOUND");
    return null;
  });
}
