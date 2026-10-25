"use client";

import { useRouter } from "next/navigation";
import { useActionState, useState, useTransition } from "react";
import { adminLoginAction, adminLogoutAction, updateDefaultQuestionAction, type AdminLoginState } from "@/app/actions/dd-admin";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field, Input, Textarea } from "@/components/ui/field";
import { Notice } from "@/components/ui/notice";

export function AdminLoginForm() {
  const [state, action, pending] = useActionState<AdminLoginState, FormData>(adminLoginAction, {});
  return (
    <form action={action} className="space-y-4">
      <Field label="관리자 비밀번호" htmlFor="admin-password">
        <Input id="admin-password" name="password" type="password" autoComplete="current-password" required />
      </Field>
      {state.error ? <Notice tone="error">{state.error}</Notice> : null}
      <Button type="submit" size="lg" pending={pending}>
        로그인
      </Button>
    </form>
  );
}

export function AdminLogoutButton() {
  return (
    <form action={adminLogoutAction}>
      <Button type="submit" size="sm" variant="ghost">
        로그아웃
      </Button>
    </form>
  );
}

export interface AdminQuestion {
  id: string;
  title: string;
  body: string;
  hint: string;
  position: number;
}

export function DefaultQuestionForm({ q }: { q: AdminQuestion }) {
  const router = useRouter();
  const [title, setTitle] = useState(q.title);
  const [body, setBody] = useState(q.body);
  const [hint, setHint] = useState(q.hint);
  const [position, setPosition] = useState(String(q.position));
  const [msg, setMsg] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [pending, start] = useTransition();

  return (
    <Card>
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          setMsg(null);
          start(async () => {
            const result = await updateDefaultQuestionAction({ id: q.id, title, body, hint, position: Number(position) });
            if (!result.ok) return setMsg({ tone: "error", text: result.error });
            setMsg({ tone: "success", text: "저장했어요." });
            router.refresh();
          });
        }}
      >
        <Field label="표시 순서" htmlFor={`pos-${q.id}`} hint="작은 숫자가 먼저 나와요.">
          <Input
            id={`pos-${q.id}`}
            type="number"
            inputMode="numeric"
            min={0}
            max={1000}
            value={position}
            onChange={(e) => setPosition(e.target.value)}
            className="w-28"
            required
          />
        </Field>
        <Field label="제목" htmlFor={`title-${q.id}`}>
          <Input id={`title-${q.id}`} value={title} onChange={(e) => setTitle(e.target.value)} maxLength={60} required />
        </Field>
        <Field label="질문 본문" htmlFor={`body-${q.id}`}>
          <Textarea id={`body-${q.id}`} value={body} onChange={(e) => setBody(e.target.value)} maxLength={300} required />
        </Field>
        <Field label="설명" htmlFor={`hint-${q.id}`}>
          <Textarea id={`hint-${q.id}`} value={hint} onChange={(e) => setHint(e.target.value)} maxLength={300} />
        </Field>
        {msg ? <Notice tone={msg.tone}>{msg.text}</Notice> : null}
        <Button type="submit" pending={pending}>
          저장
        </Button>
      </form>
    </Card>
  );
}
