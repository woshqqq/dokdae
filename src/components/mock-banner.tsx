import { getDataSource } from "@/lib/config";

/** 임시 데이터 모드에서는 모든 화면에 항상 표시한다. 실제 기능처럼 보이지 않게 하기 위함. */
export function MockBanner() {
  if (getDataSource() !== "mock") return null;
  return (
    <div role="note" className="bg-ink px-4 py-2 text-center text-xs leading-relaxed text-white">
      <strong className="font-bold">임시 데이터 모드</strong> · 실제 로그인·DB 저장·정산이 아닙니다. 서버를 재시작하면
      초기화됩니다.
    </div>
  );
}
