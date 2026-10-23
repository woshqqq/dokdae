"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { closeRoomAction } from "@/app/actions/admin";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/field";
import { Notice } from "@/components/ui/notice";

export function CloseRoomPanel({ roomId, roomName, retentionDays }: { roomId: string; roomName: string; retentionDays: number }) {
  const router = useRouter();
  const [typed, setTyped] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  return (
    <Card className="space-y-3 border-danger/40">
      <ul className="list-disc space-y-1 pl-5 text-sm leading-relaxed">
        <li>새 참여와 새 독대가 막히고, 진행 중인 독대도 종료됩니다.</li>
        <li>
          {retentionDays === 0
            ? "보관 기간이 0일이라 프로필·답변·지갑·기록이 즉시 삭제됩니다."
            : `프로필·답변·지갑·기록은 ${retentionDays}일 뒤 삭제됩니다.`}
        </li>
        <li>되돌릴 수 없어요.</li>
      </ul>
      <Field label={`확인을 위해 모임 이름 “${roomName}”을 입력하세요`} htmlFor="close-confirm">
        <Input id="close-confirm" value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" />
      </Field>
      {error ? <Notice tone="error">{error}</Notice> : null}
      <Button
        variant="danger"
        size="lg"
        disabled={typed.trim() !== roomName}
        pending={pending}
        onClick={() =>
          start(async () => {
            const r = await closeRoomAction(roomId);
            if (!r.ok) return setError(r.error);
            router.push(retentionDays === 0 ? "/" : `/rooms/${roomId}`);
          })
        }
      >
        모임 종료
      </Button>
    </Card>
  );
}
