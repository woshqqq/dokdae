import type { ComponentProps, ReactNode } from "react";
import { cn } from "./cn";

const control =
  "w-full rounded-xl border border-line bg-surface px-3.5 py-3 text-base text-ink placeholder:text-muted/70 " +
  "focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/25 aria-invalid:border-danger";

export function Field({
  label,
  htmlFor,
  hint,
  error,
  children,
  className,
}: {
  label: ReactNode;
  htmlFor: string;
  hint?: ReactNode;
  error?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("space-y-1.5", className)}>
      <label htmlFor={htmlFor} className="block text-sm font-semibold">
        {label}
      </label>
      {children}
      {error ? (
        <p id={`${htmlFor}-error`} className="text-sm text-danger">
          {error}
        </p>
      ) : hint ? (
        <p id={`${htmlFor}-hint`} className="text-sm text-muted">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

export function Input({ className, ...props }: ComponentProps<"input">) {
  return <input {...props} className={cn(control, className)} />;
}

export function Textarea({ className, ...props }: ComponentProps<"textarea">) {
  return <textarea {...props} className={cn(control, "min-h-24 resize-y leading-relaxed", className)} />;
}

/** 정수 스테퍼. 터치 영역을 넉넉히 두고 직접 입력도 허용한다. */
export function NumberStepper({
  id,
  value,
  min,
  max,
  onChange,
  label,
  disabled,
}: {
  id: string;
  value: number;
  min: number;
  max: number;
  onChange: (v: number) => void;
  label: string;
  disabled?: boolean;
}) {
  const set = (v: number) => onChange(Math.min(max, Math.max(min, Number.isFinite(v) ? Math.round(v) : min)));
  return (
    <div className="inline-flex items-center rounded-xl border border-line bg-surface">
      <button
        type="button"
        aria-label={`${label} 줄이기`}
        disabled={disabled || value <= min}
        onClick={() => set(value - 1)}
        className="size-11 text-xl font-semibold text-ink disabled:text-muted/50"
      >
        −
      </button>
      <input
        id={id}
        type="number"
        inputMode="numeric"
        aria-label={label}
        min={min}
        max={max}
        value={value}
        disabled={disabled}
        onChange={(e) => set(Number(e.target.value))}
        className="w-12 bg-transparent text-center text-base font-semibold tabular-nums [appearance:textfield] focus:outline-none [&::-webkit-inner-spin-button]:appearance-none"
      />
      <button
        type="button"
        aria-label={`${label} 늘리기`}
        disabled={disabled || value >= max}
        onClick={() => set(value + 1)}
        className="size-11 text-xl font-semibold text-ink disabled:text-muted/50"
      >
        +
      </button>
    </div>
  );
}

export function Switch({
  id,
  checked,
  onChange,
  label,
  description,
  disabled,
}: {
  id: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  label: ReactNode;
  description?: ReactNode;
  disabled?: boolean;
}) {
  return (
    <label htmlFor={id} className="flex cursor-pointer items-start justify-between gap-4 py-1">
      <span>
        <span className="block text-sm font-semibold">{label}</span>
        {description ? <span className="mt-0.5 block text-sm text-muted">{description}</span> : null}
      </span>
      <span className="relative mt-0.5 inline-flex shrink-0">
        <input
          id={id}
          type="checkbox"
          role="switch"
          checked={checked}
          disabled={disabled}
          onChange={(e) => onChange(e.target.checked)}
          className="peer sr-only"
        />
        <span className="h-7 w-12 rounded-full bg-line transition-colors peer-checked:bg-brand peer-focus-visible:outline-3 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-brand peer-disabled:opacity-50" />
        <span className="pointer-events-none absolute left-1 top-1 size-5 rounded-full bg-white shadow transition-transform peer-checked:translate-x-5" />
      </span>
    </label>
  );
}
