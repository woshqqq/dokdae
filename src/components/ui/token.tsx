import { cn } from "./cn";

export function TokenIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" aria-hidden className={cn("size-4 shrink-0", className)}>
      <circle cx="10" cy="10" r="8.5" fill="currentColor" opacity="0.18" />
      <circle cx="10" cy="10" r="8.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <path d="M10 5.5v9M7 8h6M7 12h6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

/** 토큰 수량 표기. 스크린 리더에는 "토큰 n개"로 읽힌다. */
export function Tokens({ amount, className }: { amount: number; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1 font-semibold tabular-nums text-token", className)}>
      <TokenIcon />
      <span>
        {amount}
        <span className="sr-only">토큰</span>
      </span>
    </span>
  );
}

export function TokenPill({ amount, label }: { amount: number; label?: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-token-soft px-2.5 py-1 text-sm">
      {label ? <span className="text-muted">{label}</span> : null}
      <Tokens amount={amount} />
    </span>
  );
}
