"use client";

import { useState, useTransition } from "react";
import { unlockQuestionAction } from "@/app/actions/sessions";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/notice";
import { Sheet } from "@/components/ui/sheet";
import { TokenPill } from "@/components/ui/token";
import type { SessionQuestion, SessionView } from "@/lib/data/types";
import { BalanceChange } from "./balance-change";
import { BlindQuestionCard } from "./blind-question-card";
import { GiftButton } from "./gift-sheet";

export function SessionQuestionCard({
  sessionId,
  question,
  balance,
  tradable,
  partnerNickname,
  gift,
}: {
  sessionId: string;
  question: SessionQuestion;
  balance: number;
  tradable: boolean;
  partnerNickname: string;
  gift: SessionView["settings"] | null;
}) {
  const { meta, unlocked, answer } = question;
  const [open, setOpen] = useState(false);

  if (unlocked && answer !== null) {
    return (
      <article className="rounded-2xl border border-brand/30 bg-surface p-4">
        <p className="font-semibold leading-snug">{meta.label}</p>
        <p className="mt-3 whitespace-pre-wrap rounded-xl bg-brand-soft px-4 py-3 leading-relaxed">{answer}</p>
        <div className="mt-3 flex items-center justify-between gap-3">
          <span className="text-sm text-muted">
            {question.tokensPaid ? `${question.tokensPaid}토큰으로 열었어요` : "무료로 열었어요"}
          </span>
          {gift ? (
            <GiftButton
              sessionId={sessionId}
              balance={balance}
              partnerNickname={partnerNickname}
              settings={gift}
              disabled={!tradable}
              compact
              context={meta.label}
            />
          ) : null}
        </div>
      </article>
    );
  }

  return (
    <>
      <BlindQuestionCard
        label={meta.label}
        cost={meta.tokenCost}
        action={
          <Button size="sm" variant="token" disabled={!tradable} onClick={() => setOpen(true)} aria-haspopup="dialog">
            열기
          </Button>
        }
      />
      <Sheet open={open} onClose={() => setOpen(false)} title="이 질문을 열까요?">
        <UnlockConfirm
          sessionId={sessionId}
          question={question}
          balance={balance}
          partnerNickname={partnerNickname}
          onDone={() => setOpen(false)}
        />
      </Sheet>
    </>
  );
}

function UnlockConfirm({
  sessionId,
  question,
  balance,
  partnerNickname,
  onDone,
}: {
  sessionId: string;
  question: SessionQuestion;
  balance: number;
  partnerNickname: string;
  onDone: () => void;
}) {
  const cost = question.meta.tokenCost;
  const short = balance < cost;
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  return (
    <div className="space-y-4">
      <p className="font-semibold leading-snug">{question.meta.label}</p>
      <BalanceChange balance={balance} delta={cost} label="열람 비용" />
      <p className="text-sm text-muted">
        토큰은 {partnerNickname}님에게 전달돼요. 이 독대가 끝날 때까지 다시 볼 수 있고, 같은 질문을 다시 열어도 추가로
        차감되지 않아요.
      </p>
      {short ? <Notice tone="error">토큰이 {cost - balance}개 부족해요. 상대에게 토큰을 받으면 열 수 있어요.</Notice> : null}
      {error ? <Notice tone="error">{error}</Notice> : null}
      <Button
        size="lg"
        variant="token"
        disabled={short}
        pending={pending}
        onClick={() => {
          setError(null);
          start(async () => {
            const r = await unlockQuestionAction(sessionId, question.meta.id, cost);
            if (!r.ok) return setError(r.error);
            onDone();
          });
        }}
      >
        {cost === 0 ? "무료로 열기" : `${cost}토큰 내고 열기`}
      </Button>
      <p className="flex justify-center">
        <TokenPill amount={cost} label="결제 금액" />
      </p>
    </div>
  );
}
