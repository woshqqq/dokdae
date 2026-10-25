import "server-only";
import { cookies } from "next/headers";
import { ADMIN_COOKIE, ADMIN_SESSION_TTL_MS, getAdminPassword } from "./config";
import { signAdminSession, verifyAdminSession } from "./admin-session";

/** 관리자 비밀번호가 설정되어 있어야 관리자 기능이 켜진다. */
export function isAdminEnabled() {
  return getAdminPassword() !== null;
}

/** 서명·만료를 서버에서 확인한다. 비밀번호 미설정이면 항상 false. */
export async function isAdminAuthenticated() {
  return verifyAdminSession((await cookies()).get(ADMIN_COOKIE)?.value, getAdminPassword(), Date.now());
}

export async function startAdminSession(password: string) {
  const now = Date.now();
  (await cookies()).set(ADMIN_COOKIE, signAdminSession(password, now + ADMIN_SESSION_TTL_MS), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    maxAge: Math.floor(ADMIN_SESSION_TTL_MS / 1000),
  });
}

export async function endAdminSession() {
  (await cookies()).delete(ADMIN_COOKIE);
}
