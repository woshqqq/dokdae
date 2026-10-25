"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import {
  addQuestionAction,
  deleteQuestionAction,
  markReadyAction,
  saveAnswerAction,
  updateQuestionAction,
} from "@/app/actions/dd";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field, Input, Textarea } from "@/components/ui/field";
import { Notice } from "@/components/ui/notice";

export interface EditableQuestion {
  id: string;
  kind: "default" | "personal";
  title: string;
  body: string;
  hint: string;
  answer: string | null;
  /** 기본 질문의 표시 번호(01, 02…) */
  number?: string;
}

type Msg = { tone: "success" | "error"; text: string } | null;

function QuestionCard({ roomId, q }: { roomId: string; q: EditableQuestion }) {
  const router = useRouter();
  const [answer, setAnswer] = useState(q.answer ?? "");
  const [body, setBody] = useState(q.body);
  const [editing, setEditing] = useState(false);
  const [msg, setMsg] = useState<Msg>(null);
  const [pending, start] = useTransition();
  const inputId = `answer-${q.id}`;

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
      <div>
        {q.kind === "default" ? (
          <p className="text-xs font-bold text-brand">
            {q.number} · {q.title}
          </p>
        ) : (
          <p className="text-xs font-bold text-muted">나의 질문</p>
        )}
        {editing ? (
          <div className="mt-1 space-y-2">
            <Textarea aria-label="질문 수정" value={body} onChange={(e) => setBody(e.target.value)} maxLength={300} />
            <div className="flex gap-2">
              <Button
                size="sm"
                pending={pending}
                onClick={() => run(() => updateQuestionAction(roomId, q.id, body), "질문을 수정했어요.", () => setEditing(false))}
              >
                질문 저장
              </Button>
              <Button size="sm" variant="ghost" onClick={() => (setBody(q.body), setEditing(false))}>
                취소
              </Button>
            </div>
          </div>
        ) : (
          <label htmlFor={inputId} className="mt-0.5 block font-semibold leading-snug">
            {q.body}
          </label>
        )}
        {q.hint ? <p className="mt-1 text-sm text-muted">{q.hint}</p> : null}
      </div>

      <Textarea
        id={inputId}
        value={answer}
        onChange={(e) => setAnswer(e.target.value)}
        maxLength={2000}
        placeholder="답하고 싶지 않다면 비워 두세요."
      />
      {msg ? <Notice tone={msg.tone}>{msg.text}</Notice> : null}
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          pending={pending}
          disabled={answer.trim() === (q.answer ?? "")}
          onClick={() => run(() => saveAnswerAction(roomId, q.id, answer), answer.trim() ? "답변을 저장했어요." : "건너뛰기로 저장했어요.")}
        >
          답변 저장
        </Button>
        {q.kind === "personal" && !editing ? (
          <>
            <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>
              질문 수정
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="text-danger"
              pending={pending}
              onClick={() => {
                if (window.confirm("이 질문과 답변을 삭제할까요?")) run(() => deleteQuestionAction(roomId, q.id), "질문을 삭제했어요.");
              }}
            >
              삭제
            </Button>
          </>
        ) : null}
      </div>
    </Card>
  );
}

export function QuestionsEditor({
  roomId,
  questions,
  total,
  min,
  ready,
}: {
  roomId: string;
  questions: EditableQuestion[];
  total: number;
  min: number;
  ready: boolean;
}) {
  const router = useRouter();
  const [newBody, setNewBody] = useState("");
  const [msg, setMsg] = useState<Msg>(null);
  const [pending, start] = useTransition();
  const missing = Math.max(0, min - total);

  return (
    <div className="space-y-5">
      <p className="rounded-xl bg-brand-soft px-4 py-3 text-center text-sm font-semibold text-brand">
        정답은 없으며, 답하고 싶지 않은 질문은 건너뛰어도 괜찮습니다.
      </p>

      <Card className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm text-muted">내 질문 구성</p>
          <p className="text-lg font-bold tabular-nums">
            {total} / {min}개
          </p>
        </div>
        <p className="text-right text-sm text-muted">
          {missing > 0 ? `${missing}개를 더 추가해야 다음 단계로 갈 수 있어요.` : "충분히 구성했어요."}
        </p>
      </Card>

      <ul className="space-y-3">
        {questions.map((q) => (
          <li key={q.id}>
            <QuestionCard roomId={roomId} q={q} />
          </li>
        ))}
      </ul>

      <Card>
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            setMsg(null);
            start(async () => {
              const result = await addQuestionAction(roomId, newBody);
              if (!result.ok) return setMsg({ tone: "error", text: result.error });
              setNewBody("");
              setMsg({ tone: "success", text: "질문을 추가했어요." });
              router.refresh();
            });
          }}
        >
          <Field label="나만의 질문 추가" htmlFor="new-question" hint="상대에게 묻고 싶은 것이 아니라, 내가 답하고 싶은 질문을 적어요.">
            <Input id="new-question" value={newBody} onChange={(e) => setNewBody(e.target.value)} maxLength={300} />
          </Field>
          {msg ? <Notice tone={msg.tone}>{msg.text}</Notice> : null}
          <Button type="submit" variant="secondary" pending={pending} disabled={!newBody.trim()}>
            질문 추가
          </Button>
        </form>
      </Card>

      <div className="space-y-2">
        {ready ? <Notice tone="success">준비를 마쳤어요. 방에서 독대할 사람을 골라 보세요.</Notice> : null}
        <Button
          size="lg"
          disabled={missing > 0 || ready}
          pending={pending}
          onClick={() =>
            start(async () => {
              const result = await markReadyAction(roomId);
              if (!result.ok) return setMsg({ tone: "error", text: result.error });
              router.push(`/room/${roomId}`);
            })
          }
        >
          {ready ? "준비 완료" : "질문 구성 마치기"}
        </Button>
      </div>
    </div>
  );
}
