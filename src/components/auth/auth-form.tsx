"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { signInWithPassword, signUpWithPassword } from "@/app/actions/auth";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cn } from "@/components/ui/cn";
import { Field, Input } from "@/components/ui/field";
import { Notice } from "@/components/ui/notice";

type Mode = "signin" | "signup";

export function AuthForm({ next }: { next: string }) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [status, setStatus] = useState<{ tone: "error" | "success"; text: string } | null>(null);
  const [pending, start] = useTransition();

  const submit = () => {
    setStatus(null);
    start(async () => {
      if (mode === "signin") {
        const r = await signInWithPassword({ email, password, next });
        if (!r.ok) return setStatus({ tone: "error", text: r.error });
        router.replace(r.data.next);
        router.refresh();
        return;
      }
      const r = await signUpWithPassword({ email, password, displayName, next });
      if (!r.ok) return setStatus({ tone: "error", text: r.error });
      if (r.data.needsEmailConfirmation) {
        setStatus({ tone: "success", text: `${email}로 확인 메일을 보냈어요. 메일의 링크를 누르면 가입이 완료됩니다.` });
        return;
      }
      router.replace(r.data.next);
      router.refresh();
    });
  };

  return (
    <Card className="space-y-4">
      <div role="tablist" aria-label="로그인 방식" className="grid grid-cols-2 rounded-xl bg-sunken p-1">
        {(["signin", "signup"] as const).map((m) => (
          <button
            key={m}
            type="button"
            role="tab"
            aria-selected={mode === m}
            onClick={() => {
              setMode(m);
              setStatus(null);
            }}
            className={cn(
              "min-h-10 rounded-lg text-sm font-semibold",
              mode === m ? "bg-surface text-ink shadow-sm" : "text-muted",
            )}
          >
            {m === "signin" ? "로그인" : "회원가입"}
          </button>
        ))}
      </div>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        {mode === "signup" ? (
          <Field label="이름" htmlFor="auth-name" hint="모임마다 닉네임은 따로 정할 수 있어요.">
            <Input id="auth-name" value={displayName} onChange={(e) => setDisplayName(e.target.value)} required maxLength={40} autoComplete="name" />
          </Field>
        ) : null}
        <Field label="이메일" htmlFor="auth-email">
          <Input id="auth-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" inputMode="email" />
        </Field>
        <Field label="비밀번호" htmlFor="auth-password" hint={mode === "signup" ? "8자 이상" : undefined}>
          <Input
            id="auth-password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={8}
            maxLength={72}
            autoComplete={mode === "signup" ? "new-password" : "current-password"}
          />
        </Field>
        {status ? <Notice tone={status.tone}>{status.text}</Notice> : null}
        <Button type="submit" size="lg" pending={pending}>
          {mode === "signin" ? "로그인" : "가입하기"}
        </Button>
      </form>
    </Card>
  );
}
