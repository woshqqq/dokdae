import Link from "next/link";
import type { ComponentProps } from "react";
import { cn } from "./cn";

type Variant = "primary" | "secondary" | "ghost" | "danger" | "token";
type Size = "md" | "lg" | "sm";

const variants: Record<Variant, string> = {
  primary: "bg-brand text-white hover:bg-brand-strong disabled:bg-brand/50",
  secondary: "bg-surface text-ink border border-line hover:bg-sunken disabled:text-muted",
  ghost: "text-ink hover:bg-sunken disabled:text-muted",
  danger: "bg-danger text-white hover:bg-danger/90 disabled:bg-danger/50",
  token: "bg-token text-white hover:bg-token/90 disabled:bg-token/50",
};

const sizes: Record<Size, string> = {
  sm: "min-h-9 px-3 text-sm rounded-lg",
  md: "min-h-11 px-4 text-[15px] rounded-xl",
  lg: "min-h-13 px-5 text-base rounded-xl w-full",
};

export function buttonClass(variant: Variant = "primary", size: Size = "md", className?: string) {
  return cn(
    "inline-flex items-center justify-center gap-2 font-semibold transition-colors select-none",
    "disabled:cursor-not-allowed",
    variants[variant],
    sizes[size],
    className,
  );
}

export function Button({
  variant,
  size,
  className,
  pending,
  children,
  ...props
}: ComponentProps<"button"> & { variant?: Variant; size?: Size; pending?: boolean }) {
  return (
    <button
      type="button"
      {...props}
      disabled={props.disabled || pending}
      aria-busy={pending || undefined}
      className={buttonClass(variant, size, className)}
    >
      {pending ? <Spinner /> : null}
      {children}
    </button>
  );
}

export function LinkButton({
  variant,
  size,
  className,
  ...props
}: ComponentProps<typeof Link> & { variant?: Variant; size?: Size }) {
  return <Link {...props} className={buttonClass(variant, size, className)} />;
}

export function Spinner() {
  return (
    <span
      aria-hidden
      className="inline-block size-4 animate-spin rounded-full border-2 border-current border-r-transparent"
    />
  );
}
