"use client";

import { useState, useTransition } from "react";
import { requestSessionAction } from "@/app/actions/sessions";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/notice";

export function RequestSessionButton({ roomId, recipientId, nickname }: { roomId: string; recipientId: string; nickname: string }) {
  const [status, setStatus] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [pending, start] = useTransition();
  return (
    <div className="space-y-2">
      <Button
        size="lg"
        pending={pending}
        onClick={() =>
          start(async () => {
            const r = await requestSessionAction(roomId, recipientId);
            setStatus(r.ok ? { tone: "success", text: r.message ?? "요청했습니다." } : { tone: "error", text: r.error });
          })
        }
      >
        {nickname}님에게 독대 요청
      </Button>
      {status ? <Notice tone={status.tone}>{status.text}</Notice> : null}
    </div>
  );
}
