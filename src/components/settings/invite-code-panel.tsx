"use client";

import { useState, useTransition } from "react";
import { regenerateInviteCodeAction } from "@/app/actions/admin";
import { InviteCodeCard } from "@/components/rooms/invite-code-card";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Notice } from "@/components/ui/notice";

export function InviteCodePanel({ roomId, disabled }: { roomId: string; disabled: boolean }) {
  const [code, setCode] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  if (code) return <InviteCodeCard code={code} />;

  return (
    <Card className="space-y-3">
      <p className="text-sm leading-relaxed text-muted">
        코드 원문은 저장하지 않아 다시 볼 수 없어요. 새 코드를 발급하면 <strong className="text-ink">이전 코드는 즉시 사용할 수 없게</strong>{" "}
        됩니다. 이미 참여한 사람에게는 영향이 없어요.
      </p>
      {error ? <Notice tone="error">{error}</Notice> : null}
      {confirming ? (
        <div className="grid grid-cols-2 gap-2">
          <Button variant="secondary" onClick={() => setConfirming(false)} disabled={pending}>
            취소
          </Button>
          <Button
            pending={pending}
            onClick={() =>
              start(async () => {
                const r = await regenerateInviteCodeAction(roomId);
                if (!r.ok) return setError(r.error);
                setCode(r.data.inviteCode);
              })
            }
          >
            새 코드 발급
          </Button>
        </div>
      ) : (
        <Button variant="secondary" disabled={disabled} onClick={() => setConfirming(true)}>
          초대 코드 재발급
        </Button>
      )}
    </Card>
  );
}
