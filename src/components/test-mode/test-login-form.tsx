"use client";

import { useActionState } from "react";
import { startTestSession, type TestLoginState } from "@/app/actions/test-mode";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/field";
import { Notice } from "@/components/ui/notice";

export function TestLoginForm() {
  const [state, action, pending] = useActionState<TestLoginState, FormData>(startTestSession, {});
  return (
    <Card>
      <form action={action} className="space-y-4">
        <Field label="테스트 비밀번호" htmlFor="test-password" hint="운영자에게 받은 공통 비밀번호를 입력하세요.">
          <Input id="test-password" name="password" type="password" required autoComplete="off" />
        </Field>
        <Field
          label="테스트 공간 코드 (선택)"
          htmlFor="test-sandbox"
          hint="다른 사람과 같은 공간에서 테스트하려면 그 사람 화면 상단의 공간 코드를 입력하세요. 비워 두면 새 공간을 만듭니다."
        >
          <Input id="test-sandbox" name="sandboxCode" autoComplete="off" spellCheck={false} maxLength={22} className="font-mono" />
        </Field>
        {state.error ? <Notice tone="error">{state.error}</Notice> : null}
        <Button type="submit" size="lg" pending={pending}>
          테스트 시작하기
        </Button>
      </form>
    </Card>
  );
}
