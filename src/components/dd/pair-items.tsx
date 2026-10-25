"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { confirmRewardAction, setRewardAction, unlockItemAction } from "@/app/actions/dd";
import { KIND_LABEL } from "@/components/dd/items-editor";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Notice } from "@/components/ui/notice";
import type { PairStatus, PeerItems } from "@/lib/dd/queries";

/** 잠긴 항목 카드: 순번과 열람 비용만 보인다. 열기 전에 현재 잔액과 결제 후 잔액을 확인시킨다. */
function BlindCard({ roomId, pairId, item, balance }: { roomId: string; pairId: string; item: PeerItems["items"][number]; balance: number }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const after = balance - item.cost;
  const short = after < 0;

  return (
    <Card className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span aria-hidden className="text-2xl">
            🔒
          </span>
          <div>
            <p className="font-semibold">항목 {item.ordinal}</p>
            <p className="text-sm text-muted">열람 비용 {item.cost}개</p>
          </div>
        </div>
        {!confirming ? (
          <Button size="sm" onClick={() => setConfirming(true)}>
            열기
          </Button>
        ) : null}
      </div>

      {confirming ? (
        <div className="space-y-2 rounded-xl bg-sunken p-3 text-sm">
          <p>
            내 토큰 <strong className="tabular-nums">{balance}개</strong> → 열람 후 <strong className="tabular-nums">{Math.max(after, 0)}개</strong>
          </p>
          {short ? <Notice tone="error">토큰이 부족해요.</Notice> : null}
          {error ? <Notice tone="error">{error}</Notice> : null}
          <div className="flex gap-2">
            <Button
              size="sm"
              pending={pending}
              disabled={short}
              onClick={() =>
                start(async () => {
                  setError(null);
                  const result = await unlockItemAction(roomId, pairId, item.id, item.cost);
                  if (!result.ok) {
                    setError(result.error);
                    return router.refresh();
                  }
                  router.refresh();
                })
              }
            >
              {item.cost}개 내고 열기
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setConfirming(false)}>
              취소
            </Button>
          </div>
        </div>
      ) : null}
    </Card>
  );
}

/** 열람한 항목: 열람 당시 내용과 보상(선택 → 대화 후 확정). 독대가 끝난 뒤에도 보상은 확정할 수 있다. */
function OpenedCard({
  roomId,
  entry,
  index,
  rewardMax,
  balance,
}: {
  roomId: string;
  entry: PeerItems["opened"][number];
  index: number;
  rewardMax: number;
  balance: number;
}) {
  const router = useRouter();
  const [amount, setAmount] = useState<number | null>(entry.reward_selected);
  const [msg, setMsg] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [pending, start] = useTransition();
  const options = Array.from({ length: rewardMax + 1 }, (_, i) => i);
  const saved = entry.reward_selected;

  const run = (fn: () => Promise<{ ok: boolean; error?: string }>, success: string) =>
    start(async () => {
      setMsg(null);
      const result = await fn();
      if (!result.ok) return setMsg({ tone: "error", text: result.error ?? "처리하지 못했어요." });
      setMsg({ tone: "success", text: success });
      router.refresh();
    });

  return (
    <Card className="space-y-3">
      <div className="flex items-start justify-between gap-3">
        <p className="text-xs font-bold text-brand">{entry.kind ? KIND_LABEL[entry.kind] : `열람한 항목 ${index + 1}`}</p>
        <p className="shrink-0 text-xs text-muted">{entry.tokens_paid}개 지불</p>
      </div>
      {entry.body !== null ? (
        <p className="whitespace-pre-wrap leading-relaxed">{entry.body}</p>
      ) : (
        <p className="text-sm text-muted">독대가 끝나 내용은 더 이상 보이지 않아요.</p>
      )}

      <div className="space-y-2 border-t border-line pt-3">
        <p className="text-sm font-semibold">보상 토큰</p>
        <p className="text-xs leading-relaxed text-muted">
          이 보상은 앱에 답을 적은 대가가 아니라, 직접 이야기를 나눈 것에 대한 자발적인 마음이에요. 선택만으로는 토큰이 빠져나가지 않고,
          &lsquo;지급 확정&rsquo;을 눌러야 이전됩니다. 한 번 확정하면 바꿀 수 없어요.
        </p>
        {entry.reward_confirmed ? (
          <Notice tone="success">{entry.reward_amount ? `보상 ${entry.reward_amount}개를 지급했어요.` : "보상 없이 확정했어요."}</Notice>
        ) : (
          <>
            <div role="radiogroup" aria-label="보상 수량" className="flex flex-wrap gap-2">
              {options.map((n) => (
                <button
                  key={n}
                  type="button"
                  role="radio"
                  aria-checked={amount === n}
                  onClick={() => setAmount(n)}
                  className={`min-h-11 min-w-11 rounded-xl border px-3 text-base font-semibold ${
                    amount === n ? "border-brand bg-brand text-white" : "border-line bg-surface"
                  }`}
                >
                  {n}
                </button>
              ))}
            </div>
            {amount !== null && amount > balance ? <Notice tone="warn">현재 토큰({balance}개)보다 많아요. 확정할 때 부족하면 거절돼요.</Notice> : null}
            {msg ? <Notice tone={msg.tone}>{msg.text}</Notice> : null}
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="secondary"
                pending={pending}
                disabled={amount === null || amount === saved}
                onClick={() => run(() => setRewardAction(roomId, entry.unlock_id, amount!), "수량을 저장했어요. 대화 후 지급을 확정하세요.")}
              >
                수량 저장
              </Button>
              <Button
                size="sm"
                pending={pending}
                disabled={saved === null || amount !== saved}
                onClick={() => {
                  if (saved === null) return;
                  const text = saved === 0 ? "보상 없이 확정할까요? 다시 바꿀 수 없어요." : `보상 ${saved}개를 지급할까요? 다시 바꿀 수 없어요.`;
                  if (window.confirm(text)) run(() => confirmRewardAction(roomId, entry.unlock_id, saved), "확정했어요.");
                }}
              >
                대화 후 지급 확정
              </Button>
            </div>
          </>
        )}
      </div>
    </Card>
  );
}

export function PairItems({
  roomId,
  pairId,
  status,
  data,
}: {
  roomId: string;
  pairId: string;
  status: PairStatus;
  data: PeerItems;
}) {
  const locked = data.items.filter((i) => !i.unlocked);
  const active = status === "active";

  return (
    <div className="space-y-5">
      {active || data.opened.length > 0 ? (
        <p className="text-right text-sm text-muted">
          내 토큰 <strong className="tabular-nums text-ink">{data.balance}개</strong>
        </p>
      ) : null}

      {active ? (
        <section aria-labelledby="locked-title" className="space-y-3">
          <h2 id="locked-title" className="text-base font-bold">
            잠겨 있는 항목
          </h2>
          {data.items.length === 0 ? (
            <Notice tone="info">상대가 등록한 항목이 아직 없어요.</Notice>
          ) : locked.length === 0 ? (
            <Notice tone="info">모든 항목을 열었어요.</Notice>
          ) : (
            <ul className="space-y-3">
              {locked.map((item) => (
                <li key={item.id}>
                  <BlindCard roomId={roomId} pairId={pairId} item={item} balance={data.balance} />
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}

      {data.opened.length > 0 ? (
        <section aria-labelledby="opened-title" className="space-y-3">
          <h2 id="opened-title" className="text-base font-bold">
            열어 본 항목
          </h2>
          <ul className="space-y-3">
            {data.opened.map((entry, i) => (
              <li key={entry.unlock_id}>
                <OpenedCard roomId={roomId} entry={entry} index={i} rewardMax={data.reward_max} balance={data.balance} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
