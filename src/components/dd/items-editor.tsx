"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { addItemAction, deleteItemAction, updateItemAction } from "@/app/actions/dd";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field, Textarea } from "@/components/ui/field";
import { Notice } from "@/components/ui/notice";
import type { ItemKind, MyItems, OwnerOpen } from "@/lib/dd/queries";
import { formatTime } from "@/lib/format";

export const KIND_LABEL: Record<ItemKind, string> = { tell: "알려주고 싶은 것", ask: "묻고 싶은 것" };

type Msg = { tone: "success" | "error"; text: string } | null;

function CostSelect({ id, value, min, max, onChange }: { id: string; value: number; min: number; max: number; onChange: (v: number) => void }) {
  const options = Array.from({ length: max - min + 1 }, (_, i) => min + i);
  return (
    <select
      id={id}
      value={value}
      onChange={(e) => onChange(Number(e.target.value))}
      className="min-h-11 rounded-xl border border-line bg-surface px-3 text-base focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/25"
    >
      {options.map((n) => (
        <option key={n} value={n}>
          {n}개
        </option>
      ))}
    </select>
  );
}

function KindSelect({ id, value, onChange, disabled }: { id: string; value: ItemKind; onChange: (v: ItemKind) => void; disabled?: boolean }) {
  return (
    <select
      id={id}
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value as ItemKind)}
      className="min-h-11 rounded-xl border border-line bg-surface px-3 text-base focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/25 disabled:bg-sunken"
    >
      <option value="tell">{KIND_LABEL.tell}</option>
      <option value="ask">{KIND_LABEL.ask}</option>
    </select>
  );
}

/** 소유자가 보는 열람 현황: 누가 언제 열었는지(닉네임만)와 확정된 보상. */
function OpensList({ opens, title }: { opens: OwnerOpen[]; title: string }) {
  if (opens.length === 0) return null;
  return (
    <div className="rounded-xl bg-sunken px-3 py-2 text-sm">
      <p className="font-semibold">{title}</p>
      <ul className="mt-1 space-y-0.5">
        {opens.map((o) => (
          <li key={o.unlock_id} className="text-muted">
            {o.viewer_nickname}님이 {formatTime(o.opened_at)}에 열람 (+{o.tokens_paid}) ·{" "}
            {o.reward_confirmed ? (o.reward_amount ? `보상 +${o.reward_amount} 받음` : "보상 없음으로 확정") : "보상 미확정"}
          </li>
        ))}
      </ul>
    </div>
  );
}

function ItemCard({ roomId, item, limits }: { roomId: string; item: MyItems["items"][number]; limits: { min: number; max: number } }) {
  const router = useRouter();
  const opened = item.opens.length > 0;
  const [editing, setEditing] = useState(false);
  const [kind, setKind] = useState<ItemKind>(item.kind);
  const [body, setBody] = useState(item.body);
  const [cost, setCost] = useState(item.cost);
  const [msg, setMsg] = useState<Msg>(null);
  const [pending, start] = useTransition();

  const run = (fn: () => Promise<{ ok: boolean; error?: string }>, success: string, after?: () => void) =>
    start(async () => {
      setMsg(null);
      const result = await fn();
      if (!result.ok) return setMsg({ tone: "error", text: result.error ?? "저장하지 못했어요." });
      setMsg({ tone: "success", text: success });
      after?.();
      router.refresh();
    });

  return (
    <Card className="space-y-3">
      <div className="flex items-start justify-between gap-3">
        <p className="text-xs font-bold text-brand">{KIND_LABEL[item.kind]}</p>
        <p className="shrink-0 rounded-md bg-token-soft px-2 py-0.5 text-xs font-bold text-token">열람 {item.cost}개</p>
      </div>

      {editing ? (
        <div className="space-y-3">
          <Field label="유형" htmlFor={`kind-${item.id}`}>
            <KindSelect id={`kind-${item.id}`} value={kind} onChange={setKind} disabled={opened} />
          </Field>
          <Field label="내용" htmlFor={`body-${item.id}`} hint={opened ? "이미 열람된 항목이라 내용은 바꿀 수 없어요." : undefined}>
            <Textarea id={`body-${item.id}`} value={body} onChange={(e) => setBody(e.target.value)} maxLength={500} disabled={opened} />
          </Field>
          <Field label="열람 비용" htmlFor={`cost-${item.id}`}>
            <CostSelect id={`cost-${item.id}`} value={cost} min={limits.min} max={limits.max} onChange={setCost} />
          </Field>
          <div className="flex gap-2">
            <Button
              size="sm"
              pending={pending}
              onClick={() => run(() => updateItemAction(roomId, item.id, { kind, body, cost }), "수정했어요.", () => setEditing(false))}
            >
              저장
            </Button>
            <Button size="sm" variant="ghost" onClick={() => (setKind(item.kind), setBody(item.body), setCost(item.cost), setEditing(false))}>
              취소
            </Button>
          </div>
        </div>
      ) : (
        <p className="whitespace-pre-wrap leading-relaxed">{item.body}</p>
      )}

      <OpensList opens={item.opens} title="열람 현황" />
      {msg ? <Notice tone={msg.tone}>{msg.text}</Notice> : null}

      {!editing ? (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="secondary" onClick={() => setEditing(true)}>
            수정
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="text-danger"
            pending={pending}
            onClick={() => {
              const text = opened
                ? "이 항목을 삭제할까요? 이미 연 사람은 독대가 끝나기 전까지 열람한 내용을 계속 볼 수 있고, 열람·보상 기록은 남습니다."
                : "이 항목을 삭제할까요?";
              if (window.confirm(text)) run(() => deleteItemAction(roomId, item.id), "삭제했어요.");
            }}
          >
            삭제
          </Button>
        </div>
      ) : null}
    </Card>
  );
}

export function ItemsEditor({ roomId, data, balance }: { roomId: string; data: MyItems; balance: number }) {
  const router = useRouter();
  const [kind, setKind] = useState<ItemKind>("tell");
  const [body, setBody] = useState("");
  const [cost, setCost] = useState(data.cost_min);
  const [msg, setMsg] = useState<Msg>(null);
  const [pending, start] = useTransition();
  const full = data.items.length >= data.max_items;

  return (
    <div className="space-y-5">
      <Card className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm text-muted">내 토큰</p>
          <p className="text-lg font-bold tabular-nums">{balance}개</p>
        </div>
        <p className="text-right text-sm text-muted">
          항목 {data.items.length} / {data.max_items}개
        </p>
      </Card>

      <p className="rounded-xl bg-brand-soft px-4 py-3 text-sm leading-relaxed text-brand">
        상대가 토큰을 내고 열어 볼 수 있는 이야기예요. 열기 전에는 내용도, 유형도 보이지 않고 열람 비용만 보입니다.
      </p>

      <ul className="space-y-3">
        {data.items.map((item) => (
          <li key={item.id}>
            <ItemCard roomId={roomId} item={item} limits={{ min: data.cost_min, max: data.cost_max }} />
          </li>
        ))}
      </ul>

      {data.removed_opens.length > 0 ? (
        <OpensList opens={data.removed_opens} title="삭제한 항목의 열람 기록" />
      ) : null}

      <Card>
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            setMsg(null);
            start(async () => {
              const result = await addItemAction(roomId, { kind, body, cost });
              if (!result.ok) return setMsg({ tone: "error", text: result.error });
              setBody("");
              setMsg({ tone: "success", text: "항목을 추가했어요." });
              router.refresh();
            });
          }}
        >
          <p className="font-semibold">새 항목 추가</p>
          <Field label="유형" htmlFor="new-kind">
            <KindSelect id="new-kind" value={kind} onChange={setKind} />
          </Field>
          <Field label="내용" htmlFor="new-body" hint={kind === "tell" ? "상대에게 들려주고 싶은 이야기를 적어요." : "상대에게 묻고 싶은 것을 적어요."}>
            <Textarea id="new-body" value={body} onChange={(e) => setBody(e.target.value)} maxLength={500} />
          </Field>
          <Field label="열람 비용" htmlFor="new-cost" hint="상대가 이 항목을 열 때 내는 토큰이 내게 옵니다.">
            <CostSelect id="new-cost" value={cost} min={data.cost_min} max={data.cost_max} onChange={setCost} />
          </Field>
          {full ? <Notice tone="warn">항목은 최대 {data.max_items}개까지 등록할 수 있어요. 기존 항목을 삭제한 뒤 추가해 주세요.</Notice> : null}
          {msg ? <Notice tone={msg.tone}>{msg.text}</Notice> : null}
          <Button type="submit" variant="secondary" pending={pending} disabled={!body.trim() || full}>
            항목 추가
          </Button>
        </form>
      </Card>
    </div>
  );
}
