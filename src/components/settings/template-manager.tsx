"use client";

import { useState, useTransition } from "react";
import { deleteQuestionTemplateAction, moveQuestionTemplateAction, upsertQuestionTemplateAction } from "@/app/actions/admin";
import { Button } from "@/components/ui/button";
import { Card, EmptyState } from "@/components/ui/card";
import { Field, Input, NumberStepper, Switch } from "@/components/ui/field";
import { Notice } from "@/components/ui/notice";
import { TokenPill } from "@/components/ui/token";
import type { QuestionTemplate } from "@/lib/data/types";

type Props = { roomId: string; templates: QuestionTemplate[]; minCost: number; maxCost: number; defaultCost: number };

export function TemplateManager({ roomId, templates, minCost, maxCost, defaultCost }: Props) {
  const [editing, setEditing] = useState<string | "new" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const move = (id: string, dir: "up" | "down") =>
    start(async () => {
      setError(null);
      const r = await moveQuestionTemplateAction(roomId, id, dir);
      if (!r.ok) setError(r.error);
    });

  return (
    <div className="space-y-3">
      <Notice>
        참여자 프로필에 표시될 질문이에요. 숨긴 질문은 참여자 화면과 상대 화면 모두에서 보이지 않아요. 기본 비용은 새로
        참여하는 사람의 초기값이며, 기존 참여자가 정한 비용은 바뀌지 않아요.
      </Notice>
      {error ? <Notice tone="error">{error}</Notice> : null}
      {templates.length === 0 ? <EmptyState title="질문이 없어요">아래에서 첫 질문을 추가해 보세요.</EmptyState> : null}
      <ul className="space-y-2">
        {templates.map((t, i) =>
          editing === t.id ? (
            <li key={t.id}>
              <TemplateEditor roomId={roomId} template={t} minCost={minCost} maxCost={maxCost} onDone={() => setEditing(null)} />
            </li>
          ) : (
            <li key={t.id}>
              <Card className={t.isActive ? "space-y-2" : "space-y-2 bg-sunken"}>
                <div className="flex items-start justify-between gap-2">
                  <p className="font-semibold leading-snug">
                    <span className="mr-1 text-muted">{i + 1}.</span>
                    {t.label}
                  </p>
                  {!t.isActive ? (
                    <span className="shrink-0 rounded-md bg-line px-1.5 py-0.5 text-xs font-semibold text-muted">숨김</span>
                  ) : null}
                </div>
                {t.description ? <p className="text-sm text-muted">{t.description}</p> : null}
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <TokenPill amount={t.defaultCost} label="기본" />
                  <div className="flex gap-1">
                    <Button variant="ghost" size="sm" aria-label={`${t.label} 위로`} disabled={pending || i === 0} onClick={() => move(t.id, "up")}>
                      ↑
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-label={`${t.label} 아래로`}
                      disabled={pending || i === templates.length - 1}
                      onClick={() => move(t.id, "down")}
                    >
                      ↓
                    </Button>
                    <Button variant="secondary" size="sm" onClick={() => setEditing(t.id)}>
                      수정
                    </Button>
                  </div>
                </div>
              </Card>
            </li>
          ),
        )}
      </ul>
      {editing === "new" ? (
        <TemplateEditor
          roomId={roomId}
          template={{ label: "", description: "", defaultCost, isActive: true }}
          minCost={minCost}
          maxCost={maxCost}
          onDone={() => setEditing(null)}
        />
      ) : (
        <Button variant="secondary" size="lg" onClick={() => setEditing("new")}>
          질문 추가
        </Button>
      )}
    </div>
  );
}

function TemplateEditor({
  roomId,
  template,
  minCost,
  maxCost,
  onDone,
}: {
  roomId: string;
  template: Pick<QuestionTemplate, "label" | "description" | "defaultCost" | "isActive"> & { id?: string };
  minCost: number;
  maxCost: number;
  onDone: () => void;
}) {
  const [label, setLabel] = useState(template.label);
  const [description, setDescription] = useState(template.description);
  const [cost, setCost] = useState(template.defaultCost);
  const [isActive, setIsActive] = useState(template.isActive);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const key = template.id ?? "new";

  return (
    <Card className="space-y-4 border-brand/40">
      <Field label="질문" htmlFor={`t-label-${key}`}>
        <Input id={`t-label-${key}`} value={label} onChange={(e) => setLabel(e.target.value)} maxLength={100} />
      </Field>
      <Field label="설명 (선택)" htmlFor={`t-desc-${key}`}>
        <Input id={`t-desc-${key}`} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={200} />
      </Field>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold">기본 비용</span>
          <NumberStepper id={`t-cost-${key}`} label="기본 비용" value={cost} min={minCost} max={maxCost} onChange={setCost} />
        </div>
        <div className="w-36">
          <Switch id={`t-active-${key}`} label="노출" checked={isActive} onChange={setIsActive} />
        </div>
      </div>
      {error ? <Notice tone="error">{error}</Notice> : null}
      {confirmDelete ? (
        <Notice tone="error" title="이 질문을 삭제할까요?">
          <p>참여자들이 이 질문에 쓴 답변도 함께 삭제되고 되돌릴 수 없어요. 잠시 숨기려면 &lsquo;노출&rsquo;을 끄세요.</p>
          <div className="mt-2 flex gap-2">
            <Button size="sm" variant="secondary" onClick={() => setConfirmDelete(false)} disabled={pending}>
              취소
            </Button>
            <Button
              size="sm"
              variant="danger"
              pending={pending}
              onClick={() =>
                start(async () => {
                  const r = await deleteQuestionTemplateAction(roomId, template.id!);
                  if (!r.ok) return setError(r.error);
                  onDone();
                })
              }
            >
              삭제
            </Button>
          </div>
        </Notice>
      ) : null}
      <div className="flex flex-wrap justify-between gap-2">
        {template.id && !confirmDelete ? (
          <Button variant="ghost" className="text-danger" onClick={() => setConfirmDelete(true)}>
            삭제
          </Button>
        ) : (
          <span />
        )}
        <div className="flex gap-2">
          <Button variant="secondary" onClick={onDone} disabled={pending}>
            취소
          </Button>
          <Button
            pending={pending && !confirmDelete}
            disabled={!label.trim()}
            onClick={() =>
              start(async () => {
                setError(null);
                const r = await upsertQuestionTemplateAction({ roomId, id: template.id, label, description, defaultCost: cost, isActive });
                if (!r.ok) return setError(r.error);
                onDone();
              })
            }
          >
            저장
          </Button>
        </div>
      </div>
    </Card>
  );
}
