"use client";

import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabasePublicEnv } from "./env";

let client: SupabaseClient | null = null;

/** 브라우저용 클라이언트(공개 키만 사용). 현재는 Realtime 구독에만 쓴다. 데이터 변경은 Server Action을 거친다. */
export function getSupabaseBrowserClient() {
  if (!client) {
    const { url, key } = getSupabasePublicEnv();
    client = createBrowserClient(url, key);
  }
  return client;
}
