"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { cancelSessionRequestAction, respondToSessionAction } from "@/app/actions/sessions";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/notice";

export function SessionRequestActions({ sessionId, mode }: { sessionId: string; mode: "incoming" | "outgoing" }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [which, setWhich] = useState<"accept" | "reject" | "cancel" | null>(null);

  const run = (kind: "accept" | "reject" | "cancel") => {
    setError(null);
    setWhich(kind);
    start(async () => {
      const result =
        kind === "cancel" ? await cancelSessionRequestAction(sessionId) : await respondToSessionAction(sessionId, kind === "accept");
      if (!result.ok) return setError(result.error);
      if (kind === "accept") router.push(`/sessions/${sessionId}`);
    });
  };

  if (mode === "outgoing") {
    return (
      <div className="shrink-0">
        <Button variant="ghost" size="sm" pending={pending} onClick={() => run("cancel")}>
          요청 취소
        </Button>
        {error ? <p className="mt-1 text-xs text-danger">{error}</p> : null}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-2">
        <Button variant="secondary" pending={pending && which === "reject"} disabled={pending} onClick={() => run("reject")}>
          거절
        </Button>
        <Button pending={pending && which === "accept"} disabled={pending} onClick={() => run("accept")}>
          수락하고 시작
        </Button>
      </div>
      {error ? <Notice tone="error">{error}</Notice> : null}
    </div>
  );
}
