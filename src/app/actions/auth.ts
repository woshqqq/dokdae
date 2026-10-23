"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import type { ActionResult } from "@/lib/action-result";
import { reportAuthError, resolveSiteOrigin } from "@/lib/auth/auth-errors";
import { safeNextPath } from "@/lib/auth/safe-next";
import { MOCK_SESSION_COOKIE } from "@/lib/auth/session";
import { getDataSource } from "@/lib/config";
import { MOCK_USERS } from "@/lib/data/mock/store";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/** 임시 모드 전용: 데모 사용자로 전환. 실제 인증이 아니므로 supabase 모드에서는 거부한다. */
export async function signInAsMockUser(formData: FormData) {
  if (getDataSource() !== "mock") throw new Error("임시 로그인은 mock 모드에서만 사용할 수 있습니다.");
  const userId = String(formData.get("userId") ?? "");
  if (!MOCK_USERS.some((u) => u.id === userId)) redirect("/?error=unknown_user");
  (await cookies()).set(MOCK_SESSION_COOKIE, userId, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
  });
  redirect(safeNextPath(String(formData.get("next") ?? "")));
}

export async function signOut() {
  if (getDataSource() === "mock") {
    (await cookies()).delete(MOCK_SESSION_COOKIE);
  } else {
    await (await createSupabaseServerClient()).auth.signOut();
  }
  redirect("/");
}

// ---------- Supabase 이메일·비밀번호 인증 ----------

const credentialsSchema = z.object({
  email: z.email({ error: "올바른 이메일 주소를 입력해 주세요." }).max(254),
  password: z
    .string()
    .min(8, { error: "비밀번호는 8자 이상이어야 합니다." })
    .max(72, { error: "비밀번호는 72자 이하여야 합니다." }),
});

const signUpSchema = credentialsSchema.extend({
  displayName: z.string().trim().min(1, { error: "이름을 입력해 주세요." }).max(40, { error: "이름은 40자 이하로 입력해 주세요." }),
});

function requireSupabaseMode(): ActionResult<never> | null {
  return getDataSource() === "supabase" ? null : { ok: false, error: "실제 인증은 supabase 모드에서만 사용할 수 있습니다." };
}

async function siteOrigin() {
  const h = await headers();
  return resolveSiteOrigin(process.env.NEXT_PUBLIC_SITE_URL, () => {
    const host = h.get("x-forwarded-host") ?? h.get("host");
    const proto = h.get("x-forwarded-proto") ?? (host?.startsWith("localhost") ? "http" : "https");
    return `${proto}://${host}`;
  });
}

/** 환경변수 누락 등으로 클라이언트를 만들 수 없을 때도 폼에 결과를 돌려주고 원인은 로그로 남긴다. */
async function supabaseOrError(operation: string) {
  try {
    return { ok: true, supabase: await createSupabaseServerClient() } as const;
  } catch (error) {
    return { ok: false, error: reportAuthError(operation, error) } as const;
  }
}

export async function signInWithPassword(input: { email: string; password: string; next?: string }): Promise<ActionResult<{ next: string }>> {
  const blocked = requireSupabaseMode();
  if (blocked) return blocked;
  const parsed = credentialsSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "입력값을 확인해 주세요." };
  const client = await supabaseOrError("signIn");
  if (!client.ok) return { ok: false, error: client.error };
  const { error } = await client.supabase.auth.signInWithPassword(parsed.data);
  if (error) return { ok: false, error: reportAuthError("signIn", error), code: error.code };
  return { ok: true, data: { next: safeNextPath(input.next) } };
}

export async function signUpWithPassword(input: {
  email: string;
  password: string;
  displayName: string;
  next?: string;
}): Promise<ActionResult<{ needsEmailConfirmation: boolean; next: string }>> {
  const blocked = requireSupabaseMode();
  if (blocked) return blocked;
  const parsed = signUpSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "입력값을 확인해 주세요." };
  const next = safeNextPath(input.next);
  const client = await supabaseOrError("signUp");
  if (!client.ok) return { ok: false, error: client.error };
  const origin = await siteOrigin();
  const { data, error } = await client.supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: {
      data: { display_name: parsed.data.displayName },
      emailRedirectTo: `${origin}/auth/callback?next=${encodeURIComponent(next)}`,
    },
  });
  // 리디렉션 기준 주소는 공개 값이며 Redirect URLs 설정 문제를 가리는 데 필요하다.
  if (error) return { ok: false, error: reportAuthError("signUp", error, { redirectOrigin: origin }), code: error.code };
  // 이메일 확인이 켜져 있으면 세션 없이 돌아온다(확인 링크 → /auth/callback 에서 로그인 완료).
  return { ok: true, data: { needsEmailConfirmation: !data.session, next } };
}
