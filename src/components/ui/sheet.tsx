"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";

/**
 * 모바일 하단 시트 형태의 모달. 네이티브 <dialog>로 포커스 가둠·Esc 닫기를 처리한다.
 */
export function Sheet({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onClose={onClose}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      className="m-0 mt-auto w-full max-w-none bg-transparent p-0 sm:m-auto sm:max-w-md"
    >
      <div className="rounded-t-3xl bg-surface px-5 pb-[calc(env(safe-area-inset-bottom)+1.25rem)] pt-5 text-ink sm:rounded-3xl">
        <div className="mb-4 flex items-start justify-between gap-4">
          <h2 id={titleId} className="text-lg font-bold">
            {title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="닫기"
            className="-mr-2 -mt-1 size-10 rounded-full text-xl text-muted hover:bg-sunken"
          >
            ×
          </button>
        </div>
        {open ? children : null}
      </div>
    </dialog>
  );
}
