import Link from "next/link";
import type { ReactNode } from "react";
import { LinkButton } from "./ui/button";

export function PageHeader({
  title,
  subtitle,
  back,
  action,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  back?: { href: string; label: string };
  action?: ReactNode;
}) {
  return (
    <header className="space-y-2">
      {back ? (
        <Link
          href={back.href}
          className="-ml-1 inline-flex min-h-9 items-center gap-1 rounded-lg px-1 text-sm font-medium text-muted hover:text-ink"
        >
          <span aria-hidden>‹</span> {back.label}
        </Link>
      ) : null}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold leading-tight">{title}</h1>
          {subtitle ? <p className="mt-1 text-sm text-muted">{subtitle}</p> : null}
        </div>
        {action}
      </div>
    </header>
  );
}

export function PageSkeleton() {
  return (
    <div aria-busy="true" aria-label="불러오는 중" className="animate-pulse space-y-4">
      <div className="h-8 w-2/3 rounded-lg bg-line" />
      <div className="h-24 rounded-2xl bg-line/70" />
      <div className="h-16 rounded-2xl bg-line/60" />
      <div className="h-16 rounded-2xl bg-line/50" />
      <span className="sr-only">불러오는 중…</span>
    </div>
  );
}

const DENIED_COPY: Record<string, { title: string; body: string }> = {
  NOT_MEMBER: { title: "모임 참여자만 볼 수 있어요", body: "모임 코드로 먼저 입장해 주세요." },
  FORBIDDEN: { title: "권한이 없어요", body: "모임 운영자만 이 화면을 볼 수 있습니다." },
  NOT_FOUND: { title: "찾을 수 없어요", body: "삭제되었거나 접근할 수 없는 페이지입니다." },
};

export function AccessDenied({ code, message, backHref = "/" }: { code: string; message: string; backHref?: string }) {
  const copy = DENIED_COPY[code] ?? { title: "문제가 생겼어요", body: message };
  return (
    <div className="space-y-4 py-10 text-center">
      <p className="text-4xl" aria-hidden>
        🔒
      </p>
      <h1 className="text-xl font-bold">{copy.title}</h1>
      <p className="text-muted">{copy.body}</p>
      <LinkButton href={backHref} variant="secondary">
        처음으로 돌아가기
      </LinkButton>
    </div>
  );
}
