"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import type { DataSource } from "@/lib/config";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

// Realtime 이벤트 내용은 쓰지 않고 "서버 데이터를 다시 불러오라"는 신호로만 쓴다.
// 화면에 보이는 잔액·권한은 언제나 서버 컴포넌트가 DB에서 다시 읽은 값이다.
// wallets는 구독하지 않는다(DELETE 이벤트로 참여자 ID가 노출됨). 잔액 변경은 token_transactions 이벤트로 감지한다.
const REALTIME_TABLES = ["pair_sessions", "question_unlocks", "token_transactions"] as const;

export function LiveRefreshClient({ mode, intervalMs = 3000 }: { mode: DataSource; intervalMs?: number }) {
  const router = useRouter();

  useEffect(() => {
    let timer: number | undefined;
    // 이벤트가 몰려도 한 번만 다시 불러온다.
    const refresh = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        if (document.visibilityState === "visible") router.refresh();
      }, 250);
    };

    // supabase: Realtime이 주 신호이고, 끊김에 대비해 느린 주기로도 다시 확인한다.
    const pollMs = mode === "supabase" ? Math.max(intervalMs, 15000) : intervalMs;
    const poll = window.setInterval(refresh, pollMs);
    document.addEventListener("visibilitychange", refresh);
    window.addEventListener("online", refresh);

    let cleanupRealtime = () => {};
    if (mode === "supabase") {
      const supabase = getSupabaseBrowserClient();
      let channel = supabase.channel(`dokdae-live-${Math.random().toString(36).slice(2)}`);
      for (const table of REALTIME_TABLES) {
        channel = channel.on("postgres_changes", { event: "*", schema: "public", table }, refresh);
      }
      channel.subscribe((status) => {
        // 재연결되면 그 사이 놓친 변경을 반영하기 위해 한 번 다시 불러온다.
        if (status === "SUBSCRIBED") refresh();
      });
      cleanupRealtime = () => {
        void supabase.removeChannel(channel);
      };
    }

    return () => {
      window.clearTimeout(timer);
      window.clearInterval(poll);
      document.removeEventListener("visibilitychange", refresh);
      window.removeEventListener("online", refresh);
      cleanupRealtime();
    };
  }, [router, intervalMs, mode]);

  return null;
}
