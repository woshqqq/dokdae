import type { ReactNode } from "react";
import { TokenPill } from "@/components/ui/token";

/** 답변이 가려진 질문 카드. 답변 원문은 props로 받지 않는다(애초에 내려오지 않음). */
export function BlindQuestionCard({ label, cost, hint, action }: { label: string; cost: number; hint?: string; action?: ReactNode }) {
  return (
    <div className="rounded-2xl border border-line bg-surface p-4">
      <p className="font-semibold leading-snug">{label}</p>
      <div aria-hidden className="mt-3 space-y-1.5">
        <div className="h-3 w-11/12 rounded-full bg-sunken" />
        <div className="h-3 w-3/5 rounded-full bg-sunken" />
      </div>
      <p className="sr-only">답변이 가려져 있습니다.</p>
      <div className="mt-3 flex items-center justify-between gap-3">
        <span className="flex items-center gap-2 text-sm text-muted">
          <TokenPill amount={cost} />
          {hint}
        </span>
        {action}
      </div>
    </div>
  );
}
