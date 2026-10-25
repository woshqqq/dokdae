import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { DdError, fromRpcError } from "./errors";

/**
 * Publishable key(anon 역할) 클라이언트. 서버 비밀키(service_role)는 쓰지 않는다.
 * 데이터는 dd_api_* 함수로만 접근하며, 각 함수가 방 ID + 참가자 비밀 토큰을 DB 안에서 검증한다.
 */
let client: SupabaseClient | null = null;
export function ddClient() {
  if (client) return client;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) throw new DdError("NOT_CONFIGURED");
  client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  return client;
}

export async function ddRpc<T>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await ddClient().rpc(fn, args);
  if (error) throw fromRpcError(error);
  return data as T;
}

/** 쿠키 토큰으로 확인된 참가자 자격으로 dd_api_* 함수를 호출한다. */
export function viewerRpc<T>(viewer: { roomId: string; token: string }, fn: string, args: Record<string, unknown> = {}) {
  return ddRpc<T>(fn, { p_room: viewer.roomId, p_token: viewer.token, ...args });
}
