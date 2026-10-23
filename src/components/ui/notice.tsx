import type { ReactNode } from "react";
import { cn } from "./cn";

type Tone = "info" | "success" | "error" | "warn";

const tones: Record<Tone, string> = {
  info: "bg-sunken text-ink",
  success: "bg-success-soft text-success",
  error: "bg-danger-soft text-danger",
  warn: "bg-warn-soft text-ink",
};

export function Notice({
  tone = "info",
  title,
  children,
  className,
}: {
  tone?: Tone;
  title?: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      className={cn("rounded-xl px-4 py-3 text-sm leading-relaxed", tones[tone], className)}
    >
      {title ? <p className="font-semibold">{title}</p> : null}
      {children ? <div className={title ? "mt-0.5" : undefined}>{children}</div> : null}
    </div>
  );
}
