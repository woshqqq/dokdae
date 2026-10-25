import { Suspense, type ReactNode } from "react";
import { MockBanner } from "@/components/mock-banner";
import { UserMenu } from "@/components/user-menu";

/** 이전(계정·토큰 정산) 화면 전용 상단 표시. 최소 기능 흐름에서는 쓰지 않는다. */
export function LegacyChrome({ children }: { children: ReactNode }) {
  return (
    <>
      <Suspense fallback={null}>
        <MockBanner />
      </Suspense>
      <div className="mb-4 flex justify-end">
        <Suspense fallback={null}>
          <UserMenu />
        </Suspense>
      </div>
      {children}
    </>
  );
}
