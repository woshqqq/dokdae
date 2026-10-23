"use client";

import { useState, useTransition } from "react";
import { addCustomQuestionAction, deleteCustomQuestionAction, updateProfileAction } from "@/app/actions/profile";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card, Section } from "@/components/ui/card";
import { Field, Input, NumberStepper, Switch, Textarea } from "@/components/ui/field";
import { Notice } from "@/components/ui/notice";
import type { OwnQuestion, ProfileEditor } from "@/lib/data/types";

type Draft = Pick<OwnQuestion, "id" | "label" | "templateId" | "answer" | "tokenCost" | "isEnabled">;
type Status = { tone: "success" | "error"; text: string } | null;

export function ProfileForm({ editor }: { editor: ProfileEditor }) {
  const { settings, me, room } = editor;
  const [nickname, setNickname] = useState(me.nickname);
  const [drafts, setDrafts] = useState<Draft[]>(() => editor.questions.map(toDraft));
  const [status, setStatus] = useState<Status>(null);
  const [pending, start] = useTransition();

  // 서버에서 질문 목록이 바뀌면(직접 질문 추가·삭제) 입력 중인 값은 유지하고 목록만 맞춘다.
  const [sourceQuestions, setSourceQuestions] = useState(editor.questions);
  if (sourceQuestions !== editor.questions) {
    setSourceQuestions(editor.questions);
    setDrafts((prev) => editor.questions.map((q) => prev.find((d) => d.id === q.id) ?? toDraft(q)));
  }

  const update = (id: string, patch: Partial<Draft>) =>
    setDrafts((prev) => prev.map((d) => (d.id === id ? { ...d, ...patch } : d)));

  const visibleCount = drafts.filter((d) => d.isEnabled && d.answer.trim()).length;

  return (
    <form
      className="space-y-6"
      onSubmit={(e) => {
        e.preventDefault();
        setStatus(null);
        start(async () => {
          const result = await updateProfileAction({
            roomId: room.id,
            nickname,
            questions: drafts.map(({ id, answer, tokenCost, isEnabled }) => ({ id, answer, tokenCost, isEnabled })),
          });
          setStatus(result.ok ? { tone: "success", text: result.message ?? "저장했습니다." } : { tone: "error", text: result.error });
        });
      }}
    >
      <Card className="flex items-center gap-4">
        <Avatar seed={me.userId} name={nickname} size="lg" />
        <Field label="닉네임" htmlFor="nickname" className="flex-1">
          <Input id="nickname" value={nickname} onChange={(e) => setNickname(e.target.value)} required maxLength={20} />
        </Field>
      </Card>

      <Section title="질문과 답변" action={<span className="text-sm text-muted">공개 중 {visibleCount}개</span>}>
        <Notice>
          질문마다 열람 비용을 정할 수 있어요 ({settings.minQuestionCost}~{settings.maxQuestionCost} 토큰). 답변을 비워 두면
          건너뛴 질문이 되어 상대에게 보이지 않습니다.
        </Notice>
        <ul className="space-y-3">
          {drafts.map((d, i) => (
            <li key={d.id}>
              <QuestionCard
                index={i}
                draft={d}
                min={settings.minQuestionCost}
                max={settings.maxQuestionCost}
                onChange={(patch) => update(d.id, patch)}
                roomId={room.id}
              />
            </li>
          ))}
        </ul>
      </Section>

      {settings.customQuestionsEnabled ? (
        <AddCustomQuestion roomId={room.id} defaultCost={settings.defaultQuestionCost} min={settings.minQuestionCost} max={settings.maxQuestionCost} />
      ) : null}

      <div className="sticky bottom-0 -mx-4 space-y-2 border-t border-line bg-bg/95 px-4 pb-[calc(env(safe-area-inset-bottom)+0.75rem)] pt-3 backdrop-blur">
        {status ? <Notice tone={status.tone}>{status.text}</Notice> : null}
        <Button type="submit" size="lg" pending={pending}>
          프로필 저장
        </Button>
      </div>
    </form>
  );
}

function toDraft(q: OwnQuestion): Draft {
  return { id: q.id, label: q.label, templateId: q.templateId, answer: q.answer, tokenCost: q.tokenCost, isEnabled: q.isEnabled };
}

function QuestionCard({
  index,
  draft,
  min,
  max,
  onChange,
  roomId,
}: {
  index: number;
  draft: Draft;
  min: number;
  max: number;
  onChange: (patch: Partial<Draft>) => void;
  roomId: string;
}) {
  const answered = draft.answer.trim().length > 0;
  const state = !draft.isEnabled ? "비공개" : answered ? "공개" : "건너뜀";
  const [deleting, startDelete] = useTransition();
  const [deleteError, setDeleteError] = useState<string | null>(null);

  return (
    <Card className={draft.isEnabled ? undefined : "bg-sunken"}>
      <div className="flex items-start justify-between gap-3">
        <label htmlFor={`answer-${draft.id}`} className="font-semibold leading-snug">
          <span className="mr-1 text-muted">Q{index + 1}.</span>
          {draft.label}
        </label>
        <span
          className={
            state === "공개"
              ? "shrink-0 rounded-md bg-success-soft px-1.5 py-0.5 text-xs font-semibold text-success"
              : "shrink-0 rounded-md bg-line px-1.5 py-0.5 text-xs font-semibold text-muted"
          }
        >
          {state}
        </span>
      </div>
      <Textarea
        id={`answer-${draft.id}`}
        className="mt-3"
        value={draft.answer}
        onChange={(e) => onChange({ answer: e.target.value })}
        maxLength={1000}
        placeholder="답하지 않으려면 비워 두세요."
      />
      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold">열람 비용</span>
          <NumberStepper
            id={`cost-${draft.id}`}
            label={`Q${index + 1} 열람 비용`}
            value={draft.tokenCost}
            min={min}
            max={max}
            onChange={(v) => onChange({ tokenCost: v })}
          />
        </div>
        <div className="w-36">
          <Switch id={`enabled-${draft.id}`} label="공개" checked={draft.isEnabled} onChange={(v) => onChange({ isEnabled: v })} />
        </div>
      </div>
      {draft.templateId === null ? (
        <div className="mt-2 border-t border-line pt-2 text-right">
          <Button
            variant="ghost"
            size="sm"
            className="text-danger"
            pending={deleting}
            onClick={() =>
              startDelete(async () => {
                const r = await deleteCustomQuestionAction(roomId, draft.id);
                if (!r.ok) setDeleteError(r.error);
              })
            }
          >
            이 질문 삭제
          </Button>
          {deleteError ? <p className="text-sm text-danger">{deleteError}</p> : null}
        </div>
      ) : null}
    </Card>
  );
}

function AddCustomQuestion({ roomId, defaultCost, min, max }: { roomId: string; defaultCost: number; min: number; max: number }) {
  const [label, setLabel] = useState("");
  const [cost, setCost] = useState(defaultCost);
  const [status, setStatus] = useState<Status>(null);
  const [pending, start] = useTransition();

  // 바깥 form 안에 form을 중첩할 수 없으므로 버튼 클릭으로 처리한다.
  const submit = () => {
    setStatus(null);
    start(async () => {
      const r = await addCustomQuestionAction({ roomId, label, tokenCost: cost });
      if (!r.ok) return setStatus({ tone: "error", text: r.error });
      setLabel("");
      setCost(defaultCost);
      setStatus({ tone: "success", text: "질문을 추가했어요. 답변을 쓰고 프로필을 저장해 주세요." });
    });
  };

  return (
    <Section title="직접 질문 추가">
      <Card className="space-y-3">
        <Field label="질문" htmlFor="custom-label" hint="나를 더 잘 보여줄 질문을 직접 만들 수 있어요.">
          <Input
            id="custom-label"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            maxLength={100}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                submit();
              }
            }}
          />
        </Field>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold">열람 비용</span>
            <NumberStepper id="custom-cost" label="새 질문 열람 비용" value={cost} min={min} max={max} onChange={setCost} />
          </div>
          <Button variant="secondary" pending={pending} disabled={!label.trim()} onClick={submit}>
            추가
          </Button>
        </div>
        {status ? <Notice tone={status.tone}>{status.text}</Notice> : null}
      </Card>
    </Section>
  );
}
