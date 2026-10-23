"use client";

import { useState, useTransition } from "react";
import { sendGiftAction } from "@/app/actions/sessions";
import { Button } from "@/components/ui/button";
import { NumberStepper } from "@/components/ui/field";
import { Notice } from "@/components/ui/notice";
import { Sheet } from "@/components/ui/sheet";
import type { SessionView } from "@/lib/data/types";
import { BalanceChange } from "./balance-change";

type GiftSettings = Pick<SessionView["settings"], "giftDefaultAmount" | "giftMinAmount" | "giftMaxAmount">;

export function GiftButton({
  sessionId,
  balance,
  partnerNickname,
  settings,
  disabled,
  compact,
  context,
}: {
  sessionId: string;
  balance: number;
  partnerNickname: string;
  settings: GiftSettings;
  disabled?: boolean;
  compact?: boolean;
  /** 특정 답변에 대한 감사일 때 질문 제목 */
  context?: string;
}) {
  const [open, setOpen] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  return (
    <span className="inline-flex flex-col items-end gap-1">
      <Button
        variant={compact ? "secondary" : "token"}
        size={compact ? "sm" : "md"}
        disabled={disabled}
        onClick={() => {
          setDone(null);
          setOpen(true);
        }}
        aria-haspopup="dialog"
      >
        토큰 보내기
      </Button>
      <span role="status" className="text-xs font-semibold text-success">
        {done ?? ""}
      </span>
      <Sheet open={open} onClose={() => setOpen(false)} title={`${partnerNickname}님에게 토큰 보내기`}>
        <GiftForm
          sessionId={sessionId}
          balance={balance}
          settings={settings}
          context={context}
          onDone={(message) => {
            setDone(message);
            setOpen(false);
          }}
        />
      </Sheet>
    </span>
  );
}

function newRequestId() {
  return crypto.randomUUID();
}

function GiftForm({
  sessionId,
  balance,
  settings,
  context,
  onDone,
}: {
  sessionId: string;
  balance: number;
  settings: GiftSettings;
  context?: string;
  onDone: (message: string) => void;
}) {
  const [amount, setAmount] = useState(settings.giftDefaultAmount);
  // 시트를 열 때 한 번 만든 요청 ID를 재시도에도 그대로 써서, 연속 클릭·네트워크 재시도를 한 번으로 처리한다.
  const [requestId, setRequestId] = useState(newRequestId);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const short = balance < amount;

  return (
    <div className="space-y-4">
      {context ? <p className="text-sm text-muted">“{context}” 답변에 고마움을 전해요.</p> : null}
      <div className="flex items-center justify-between">
        <span className="font-semibold">보낼 토큰</span>
        <NumberStepper
          id="gift-amount"
          label="보낼 토큰 수"
          value={amount}
          min={settings.giftMinAmount}
          max={settings.giftMaxAmount}
          disabled={pending}
          onChange={(v) => {
            setAmount(v);
            setRequestId(newRequestId()); // 수량이 바뀌면 다른 요청이다.
          }}
        />
      </div>
      <p className="text-xs text-muted">
        한 번에 {settings.giftMinAmount}~{settings.giftMaxAmount}개까지 보낼 수 있어요.
      </p>
      <BalanceChange balance={balance} delta={amount} label="보낼 토큰" />
      {short ? <Notice tone="error">토큰이 부족해요. 현재 {balance}개 있어요.</Notice> : null}
      {error ? <Notice tone="error">{error}</Notice> : null}
      <Button
        size="lg"
        variant="token"
        disabled={short}
        pending={pending}
        onClick={() => {
          setError(null);
          start(async () => {
            const r = await sendGiftAction({ sessionId, amount, requestId });
            if (!r.ok) return setError(r.error);
            setRequestId(newRequestId());
            onDone(r.data.duplicate ? "이미 처리된 요청이에요. 중복으로 보내지 않았습니다." : `토큰 ${amount}개를 보냈어요.`);
          });
        }}
      >
        {amount}토큰 보내기
      </Button>
    </div>
  );
}
