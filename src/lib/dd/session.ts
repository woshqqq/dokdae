import "server-only";
import { cookies } from "next/headers";
import { PARTICIPANT_COOKIE_MAX_AGE_SECONDS, PARTICIPANT_COOKIE_PREFIX } from "./config";
import { ddRpc } from "./db";
import { DdError } from "./errors";
import { isWellFormedToken } from "./token";
import { idSchema } from "./validation";

export interface Viewer {
  id: string;
  roomId: string;
  isCreator: boolean;
  /** 쿠키의 참가자 비밀 토큰. DB 함수 호출에만 쓰고 화면·로그·응답에 내보내지 않는다. */
  token: string;
}

const cookieName = (roomId: string) => `${PARTICIPANT_COOKIE_PREFIX}${roomId}`;

/** 참가자 토큰을 HttpOnly 쿠키로 심는다. Server Action·Route Handler 에서만 호출할 수 있다. */
export async function writeParticipantCookie(roomId: string, token: string) {
  (await cookies()).set(cookieName(roomId), token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: PARTICIPANT_COOKIE_MAX_AGE_SECONDS,
  });
}

export async function clearParticipantCookie(roomId: string) {
  (await cookies()).delete(cookieName(roomId));
}

/** 이 방의 쿠키 토큰을 DB 함수로 검증한다. 쿠키가 없거나 맞지 않으면 null. */
export async function getViewer(roomId: string): Promise<Viewer | null> {
  if (!idSchema.safeParse(roomId).success) return null;
  const token = (await cookies()).get(cookieName(roomId))?.value;
  if (!token || !isWellFormedToken(token)) return null;
  const found = await ddRpc<{ id: string; room_id: string; is_creator: boolean } | null>("dd_api_authenticate", {
    p_room: roomId,
    p_token: token,
  });
  return found ? { id: found.id, roomId: found.room_id, isCreator: found.is_creator, token } : null;
}

export async function requireViewer(roomId: string): Promise<Viewer> {
  const viewer = await getViewer(roomId);
  if (!viewer) throw new DdError("UNAUTHENTICATED");
  return viewer;
}
