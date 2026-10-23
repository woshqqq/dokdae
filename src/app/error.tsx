"use client";

import { Button, LinkButton } from "@/components/ui/button";

export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="space-y-4 py-10 text-center">
      <h1 className="text-xl font-bold">화면을 불러오지 못했어요</h1>
      <p className="text-muted">잠시 후 다시 시도해 주세요. 문제가 계속되면 새로고침해 주세요.</p>
      <div className="flex justify-center gap-2">
        <Button variant="secondary" onClick={reset}>
          다시 시도
        </Button>
        <LinkButton href="/">처음으로</LinkButton>
      </div>
    </div>
  );
}
