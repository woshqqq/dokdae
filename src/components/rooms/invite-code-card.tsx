"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";

/** 초대 코드 원문은 생성·재발급 직후 한 번만 보여준다(서버에는 해시만 저장). */
export function InviteCodeCard({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="rounded-2xl border-2 border-dashed border-brand/40 bg-brand-soft p-5 text-center">
      <p className="text-sm font-semibold text-brand">모임 코드</p>
      <p className="mt-2 select-all font-mono text-3xl font-bold tracking-widest">{code}</p>
      <p className="mt-2 text-xs text-muted">보안을 위해 코드 원문은 다시 볼 수 없어요. 잊어버리면 설정에서 재발급하세요.</p>
      <Button
        variant="secondary"
        size="sm"
        className="mt-3"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(code);
            setCopied(true);
          } catch {
            setCopied(false);
          }
        }}
      >
        {copied ? "복사했어요" : "코드 복사"}
      </Button>
      <span className="sr-only" role="status">
        {copied ? "코드를 클립보드에 복사했습니다." : ""}
      </span>
    </div>
  );
}
