"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { consentPairAction, endPairAction, requestPairAction, respondPairAction } from "@/app/actions/dd";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/notice";

type Result = { ok: true } | { ok: false; error: string };

/** 서버 액션을 실행하고, 실패 메시지를 보여주며, 성공하면 서버 상태를 다시 불러온다. */
function useRunner() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<Result>, after?: () => void) =>
    start(async () => {
      setError(null);
      const result = await fn();
      if (!result.ok) return setError(result.error);
      after?.();
      router.refresh();
    });
  return { run, error, pending, router };
}

export function RequestPairButton({ roomId, peerId, nickname }: { roomId: string; peerId: string; nickname: string }) {
  const { run, error, pending, router } = useRunner();
  return (
    <div className="space-y-2">
      <Button
        size="sm"
        pending={pending}
        aria-label={`${nickname}에게 독대 요청`}
        onClick={async () =>
          run(async () => {
            const result = await requestPairAction(roomId, peerId);
            if (result.ok) router.push(`/room/${roomId}/dokdae/${result.data.pairId}`);
            return result;
          })
        }
      >
        독대 요청
      </Button>
      {error ? <Notice tone="error">{error}</Notice> : null}
    </div>
  );
}

export function RespondButtons({ roomId, pairId }: { roomId: string; pairId: string }) {
  const { run, error, pending } = useRunner();
  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <Button size="lg" pending={pending} onClick={() => run(() => respondPairAction(roomId, pairId, true))}>
          수락하고 서로 확인하기
        </Button>
        <Button size="lg" variant="secondary" disabled={pending} onClick={() => run(() => respondPairAction(roomId, pairId, false))}>
          거절
        </Button>
      </div>
      {error ? <Notice tone="error">{error}</Notice> : null}
    </div>
  );
}

export function ConsentButton({ roomId, pairId, consented }: { roomId: string; pairId: string; consented: boolean }) {
  const { run, error, pending } = useRunner();
  return (
    <div className="space-y-2">
      <Button size="lg" pending={pending} disabled={consented} onClick={() => run(() => consentPairAction(roomId, pairId))}>
        {consented ? "내 동의 완료 · 상대를 기다리는 중" : "독대 시작에 동의"}
      </Button>
      {error ? <Notice tone="error">{error}</Notice> : null}
    </div>
  );
}

export function EndPairButton({
  roomId,
  pairId,
  label,
  confirmText,
}: {
  roomId: string;
  pairId: string;
  label: string;
  confirmText: string;
}) {
  const { run, error, pending } = useRunner();
  return (
    <div className="space-y-2">
      <Button
        size="lg"
        variant="secondary"
        pending={pending}
        onClick={() => {
          if (window.confirm(confirmText)) run(() => endPairAction(roomId, pairId));
        }}
      >
        {label}
      </Button>
      {error ? <Notice tone="error">{error}</Notice> : null}
    </div>
  );
}
