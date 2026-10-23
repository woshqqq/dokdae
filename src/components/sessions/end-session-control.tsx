"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { cancelEndVoteAction, voteEndSessionAction } from "@/app/actions/sessions";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Notice } from "@/components/ui/notice";
import { Sheet } from "@/components/ui/sheet";
import type { EndVoteState } from "@/lib/data/types";

/**
 * 종료는 양쪽 동의가 필요하다.
 * - 아무도 요청 안 함: 하단 "독대 종료" → 확인 시트 → 종료 요청
 * - 내가 요청함: 대기 배너 + 요청 취소
 * - 상대가 요청함: 눈에 띄는 확인 카드(종료 확인 / 계속하기)
 * 종료 요청이 있는 동안 서버는 새 토큰 거래를 거절한다.
 */
export function EndSessionControl({
  sessionId,
  roomId,
  partnerNickname,
  endVote,
}: {
  sessionId: string;
  roomId: string;
  partnerNickname: string;
  endVote: EndVoteState;
}) {
  const router = useRouter();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [which, setWhich] = useState<"vote" | "cancel" | null>(null);

  const vote = () => {
    setError(null);
    setWhich("vote");
    start(async () => {
      const r = await voteEndSessionAction(sessionId);
      if (!r.ok) return setError(r.error);
      setConfirmOpen(false);
      if (r.data.closed) router.push(`/rooms/${roomId}?ended=1`);
    });
  };
  const cancel = () => {
    setError(null);
    setWhich("cancel");
    start(async () => {
      const r = await cancelEndVoteAction(sessionId);
      if (!r.ok) setError(r.error);
    });
  };

  if (endVote.kind === "requested_by_partner") {
    return (
      <Card className="space-y-3 border-2 border-brand bg-brand-soft" role="alertdialog" aria-labelledby="end-req-title">
        <p id="end-req-title" className="text-lg font-bold">
          {partnerNickname}님이 독대 종료를 요청했어요
        </p>
        <p className="text-sm leading-relaxed">
          종료를 확인하면 이 독대에서 연 답변을 더 이상 볼 수 없어요. 확인 전까지는 토큰 거래가 멈춰 있습니다.
        </p>
        {error ? <Notice tone="error">{error}</Notice> : null}
        <div className="grid grid-cols-2 gap-2">
          <Button variant="secondary" pending={pending && which === "cancel"} disabled={pending} onClick={cancel}>
            계속하기
          </Button>
          <Button pending={pending && which === "vote"} disabled={pending} onClick={vote}>
            종료 확인
          </Button>
        </div>
      </Card>
    );
  }

  if (endVote.kind === "requested_by_me") {
    return (
      <Notice tone="warn" title={`${partnerNickname}님의 종료 확인을 기다리는 중`}>
        <p>상대가 확인하면 독대가 끝나요. 그 전까지 질문 열기와 토큰 보내기는 멈춥니다.</p>
        {error ? <p className="mt-1 text-danger">{error}</p> : null}
        <Button variant="secondary" size="sm" className="mt-2" pending={pending} onClick={cancel}>
          종료 요청 취소
        </Button>
      </Notice>
    );
  }

  return (
    <>
      <div className="fixed inset-x-0 bottom-0 z-10 border-t border-line bg-bg/95 pb-[calc(env(safe-area-inset-bottom)+0.75rem)] pt-3 backdrop-blur">
        <div className="mx-auto max-w-lg px-4">
          <Button variant="secondary" size="lg" onClick={() => setConfirmOpen(true)} aria-haspopup="dialog">
            독대 종료
          </Button>
        </div>
      </div>
      <Sheet open={confirmOpen} onClose={() => setConfirmOpen(false)} title="독대를 마칠까요?">
        <div className="space-y-4">
          <ul className="list-disc space-y-1.5 pl-5 text-sm leading-relaxed">
            <li>{partnerNickname}님에게 종료 확인 요청이 표시돼요.</li>
            <li>양쪽이 모두 동의해야 독대가 끝납니다.</li>
            <li>요청한 뒤에는 질문 열기와 토큰 보내기가 멈춰요.</li>
            <li>종료되면 서로 열람한 답변은 다시 볼 수 없어요. 토큰 잔액은 그대로 남습니다.</li>
          </ul>
          {error ? <Notice tone="error">{error}</Notice> : null}
          <Button size="lg" pending={pending} onClick={vote}>
            종료 요청하기
          </Button>
        </div>
      </Sheet>
    </>
  );
}
