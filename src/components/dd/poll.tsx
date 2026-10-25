"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/** 상대의 수락·동의·종료가 내 화면에도 반영되도록 서버 데이터를 주기적으로 다시 불러온다. 새로고침해도 같은 상태다. */
export function Poll({ intervalMs = 4000 }: { intervalMs?: number }) {
  const router = useRouter();
  useEffect(() => {
    const tick = () => {
      if (document.visibilityState === "visible") router.refresh();
    };
    const timer = window.setInterval(tick, intervalMs);
    document.addEventListener("visibilitychange", tick);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [router, intervalMs]);
  return null;
}
